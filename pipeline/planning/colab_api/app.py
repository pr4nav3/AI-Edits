from __future__ import annotations

import threading
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, HTTPException

from pipeline.planning.colab_api.engine import build_engine_from_env
from pipeline.planning.colab_api.models import (
    PlanJobStatusResponse,
    PlanJobSubmitResponse,
    PlanRequest,
    PlanResponse,
)

app = FastAPI(title="AI-Edits Colab Planner API", version="0.1.0")
engine = build_engine_from_env()
jobs: dict[str, PlanJobStatusResponse] = {}
jobs_lock = threading.Lock()


def _now() -> datetime:
    return datetime.utcnow()


def _validate_video_path(request: PlanRequest) -> None:
    if request.vision_input.type != "video_path":
        return
    video_path = request.vision_input.video_path
    if not video_path:
        raise HTTPException(status_code=400, detail="vision_input.video_path is required for video_path mode")
    if not Path(video_path).exists():
        raise HTTPException(status_code=400, detail=f"Colab cannot find video path: {video_path}")


def _run_plan_job(job_id: str, request: PlanRequest) -> None:
    with jobs_lock:
        current = jobs[job_id]
        current.status = "running"
        current.updated_at = _now()
        jobs[job_id] = current

    try:
        (
            pass1_raw_response,
            timeline_events,
            pass2_raw_response,
            model_plan_raw,
            final_edit_plan,
            warnings,
        ) = engine.generate(request)
        result = PlanResponse(
            run_id=request.run_id,
            pass1_raw_response=pass1_raw_response,
            timeline_events=timeline_events,
            pass2_raw_response=pass2_raw_response,
            model_plan_raw=model_plan_raw,
            final_edit_plan=final_edit_plan,
            warnings=warnings,
        )
        with jobs_lock:
            current = jobs[job_id]
            current.status = "completed"
            current.updated_at = _now()
            current.result = result
            jobs[job_id] = current
    except Exception as exc:
        with jobs_lock:
            current = jobs[job_id]
            current.status = "failed"
            current.updated_at = _now()
            current.error = str(exc)
            jobs[job_id] = current


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/model-status")
def model_status() -> dict:
    return engine.model_cache_status()


@app.post("/warmup")
def warmup() -> dict:
    try:
        return engine.warmup()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/jobs/plan", response_model=PlanJobSubmitResponse)
def submit_plan_job(request: PlanRequest) -> PlanJobSubmitResponse:
    _validate_video_path(request)

    now = _now()
    job_id = uuid4().hex
    with jobs_lock:
        jobs[job_id] = PlanJobStatusResponse(
            job_id=job_id,
            status="queued",
            created_at=now,
            updated_at=now,
        )

    worker = threading.Thread(target=_run_plan_job, args=(job_id, request), daemon=True)
    worker.start()

    return PlanJobSubmitResponse(job_id=job_id, status="queued", created_at=now)


@app.get("/jobs/{job_id}", response_model=PlanJobStatusResponse)
def get_plan_job(job_id: str) -> PlanJobStatusResponse:
    with jobs_lock:
        job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job_id: {job_id}")
    return job

