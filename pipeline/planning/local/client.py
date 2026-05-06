from __future__ import annotations

import time
from typing import Any

import requests


def _request_json(method: str, endpoint: str, timeout_s: int, **kwargs: Any) -> dict[str, Any]:
    response = requests.request(method, endpoint, timeout=timeout_s, **kwargs)
    if not response.ok:
        body = response.text.strip()
        raise RuntimeError(
            f"Request failed ({response.status_code}) at {endpoint}: {body}"
        )
    return response.json()


def request_plan(
    colab_base_url: str,
    payload: dict[str, Any],
    *,
    timeout_s: int = 30,
    poll_interval_s: float = 3.0,
    heartbeat_interval_s: float = 30.0,
    max_wait_s: int = 3600,
) -> dict[str, Any]:
    base = colab_base_url.rstrip("/")
    submit_endpoint = f"{base}/jobs/plan"
    submit_resp = _request_json("POST", submit_endpoint, timeout_s, json=payload)
    job_id = submit_resp["job_id"]
    print(f"[API] submitted job_id={job_id}")

    start = time.monotonic()
    last_heartbeat = start
    status_endpoint = f"{base}/jobs/{job_id}"
    last_status: str | None = None
    while True:
        status_resp = _request_json("GET", status_endpoint, timeout_s)
        status = status_resp.get("status")
        elapsed = time.monotonic() - start
        if status != last_status:
            print(f"[API] job_id={job_id} status={status} elapsed={elapsed:.1f}s")
            last_status = status
            last_heartbeat = time.monotonic()
        elif elapsed >= heartbeat_interval_s and time.monotonic() - last_heartbeat >= heartbeat_interval_s:
            print(f"[API] job_id={job_id} heartbeat status={status} elapsed={elapsed:.1f}s")
            last_heartbeat = time.monotonic()
        if status == "completed":
            result = status_resp.get("result")
            if result is None:
                raise RuntimeError(f"Job {job_id} completed without result payload")
            return result
        if status == "failed":
            raise RuntimeError(f"Job {job_id} failed: {status_resp.get('error', 'unknown error')}")
        if status == "cancelled":
            raise RuntimeError(f"Job {job_id} cancelled: {status_resp.get('error', 'cancelled')}")
        if time.monotonic() - start > max_wait_s:
            raise TimeoutError(f"Job {job_id} exceeded max_wait_s={max_wait_s}")
        time.sleep(poll_interval_s)

