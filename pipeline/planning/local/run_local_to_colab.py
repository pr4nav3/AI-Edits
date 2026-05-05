from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from pipeline.planning.local.client import request_plan
from pipeline.planning.local.preprocess import (
    encode_frames_base64,
    preprocess_video,
    sample_frames,
    write_run_artifacts,
)
from pipeline.render.render import render
from pipeline.render.validate_plan import validate_plan


def _print_plan_metrics(
    response: dict[str, Any],
    final_plan: dict[str, Any],
    source_meta: dict[str, Any],
) -> None:
    segments = final_plan.get("segments", [])
    keep_duration = 0.0
    cut_duration = 0.0
    keep_count = 0
    cut_count = 0
    for seg in segments:
        start_s = float(seg.get("start_s", 0.0))
        end_s = float(seg.get("end_s", 0.0))
        dur = max(0.0, end_s - start_s)
        if seg.get("action") == "cut":
            cut_count += 1
            cut_duration += dur
        else:
            keep_count += 1
            keep_duration += dur

    coverage_end = float(segments[-1]["end_s"]) if segments else 0.0
    duration_s = float(source_meta["duration_s"])
    coverage_delta = coverage_end - duration_s
    warnings = response.get("warnings", [])
    print("\n=== Planning Metrics ===")
    print(f"pass1_events={len(response.get('timeline_events', []))}")
    print(f"segments_total={len(segments)} keep={keep_count} cut={cut_count}")
    print(f"duration_keep_s={keep_duration:.3f} duration_cut_s={cut_duration:.3f}")
    print(f"coverage_end_s={coverage_end:.3f} source_duration_s={duration_s:.3f} delta_s={coverage_delta:+.3f}")
    print(
        f"zooms={len(final_plan.get('zooms', []))} overlays={len(final_plan.get('overlays', []))} "
        f"text_overlays={len(final_plan.get('text_overlays', []))}"
    )
    print(f"caption_words={len(final_plan.get('captions', {}).get('words', []))}")
    if warnings:
        print(f"warnings={warnings}")
    else:
        print("warnings=[]")
    print("========================\n")


def build_request_payload(
    *,
    run_id: str,
    source_meta: dict[str, Any],
    transcript_words: list[dict[str, Any]],
    user_prompt: str,
    mode: str,
    use_frame_array: bool,
    video_path: Path,
    colab_video_path: str | None,
    frame_payload: list[dict[str, Any]] | None,
    sample_fps: float,
    max_frames: int,
) -> dict[str, Any]:
    vision_input: dict[str, Any]
    if use_frame_array:
        vision_input = {
            "type": "frame_array",
            "frames": frame_payload or [],
        }
    else:
        # Colab must be able to read this path (typically mounted Drive path).
        vision_input = {
            "type": "video_path",
            "video_path": colab_video_path or str(video_path),
        }

    return {
        "run_id": run_id,
        "source_meta": source_meta,
        "transcript_words": transcript_words,
        "vision_input": vision_input,
        "user_prompt": user_prompt,
        "mode": mode,
        "generation": {
            "sample_fps": sample_fps,
            "max_frames": max_frames,
            "max_new_tokens_timeline": 1200,
            "max_new_tokens_plan": 2400,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Local preprocess -> Colab plan generation -> local validate/render."
    )
    parser.add_argument("--video", required=True, type=Path, help="Source video path on local machine.")
    parser.add_argument("--colab-url", required=True, help="Base URL for Colab FastAPI service.")
    parser.add_argument("--prompt", required=True, help="Editing request passed to planner.")
    parser.add_argument("--mode", default="style", help="Prompt mode (style, targeted, etc).")
    parser.add_argument(
        "--run-dir",
        type=Path,
        default=Path("pipeline/planning/runs"),
        help="Directory for run artifacts.",
    )
    parser.add_argument(
        "--output-plan",
        type=Path,
        default=Path("edit_plans/generated_from_colab.json"),
        help="Where to save validated final edit plan JSON.",
    )
    parser.add_argument(
        "--render-out",
        type=Path,
        default=None,
        help="Optional output video path. If set, runs local Remotion render.",
    )
    parser.add_argument(
        "--use-frame-array",
        action="store_true",
        help="Send sampled frames to Colab instead of video_path (ablation mode).",
    )
    parser.add_argument("--sample-fps", type=float, default=2.0)
    parser.add_argument("--max-frames", type=int, default=120)
    parser.add_argument(
        "--colab-video-path",
        default=None,
        help="Path visible from Colab runtime (required when not using --use-frame-array).",
    )
    parser.add_argument("--run-whisper", action="store_true", help="Run Whisper locally.")
    parser.add_argument("--whisper-model", default="base", help="Whisper model name.")
    parser.add_argument("--whisper-language", default=None, help="Optional Whisper language code.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.use_frame_array and not args.colab_video_path:
        raise SystemExit(
            "When local and Colab are separate machines, pass --colab-video-path "
            "or use --use-frame-array."
        )

    run_id = uuid4().hex[:10]
    run_dir = args.run_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    source_meta, transcript_words = preprocess_video(
        args.video,
        run_whisper=args.run_whisper,
        whisper_model=args.whisper_model,
        whisper_language=args.whisper_language,
    )

    frame_payload: list[dict[str, Any]] | None = None
    if args.use_frame_array:
        frame_dir = run_dir / "frames"
        frames = sample_frames(
            args.video,
            frame_dir,
            sample_fps=args.sample_fps,
            max_frames=args.max_frames,
        )
        frame_payload = encode_frames_base64(frames, sample_fps=args.sample_fps)

    payload = build_request_payload(
        run_id=run_id,
        source_meta=source_meta,
        transcript_words=transcript_words,
        user_prompt=args.prompt,
        mode=args.mode,
        use_frame_array=args.use_frame_array,
        video_path=args.video,
        colab_video_path=args.colab_video_path,
        frame_payload=frame_payload,
        sample_fps=args.sample_fps,
        max_frames=args.max_frames,
    )

    response = request_plan(args.colab_url, payload)
    final_plan = response["final_edit_plan"]
    _print_plan_metrics(response, final_plan, source_meta)

    args.output_plan.parent.mkdir(parents=True, exist_ok=True)
    with args.output_plan.open("w", encoding="utf-8") as f:
        json.dump(final_plan, f, indent=2)

    validation_error: str | None = None
    try:
        validate_plan(final_plan)
        print("Validation: OK")
    except Exception as exc:
        validation_error = str(exc)
        print("Validation: INVALID")
        print(f"Reason: {validation_error}")
        print(f"Saved invalid plan to: {args.output_plan}")

    write_run_artifacts(
        run_dir,
        {
            "request": payload,
            "response": response,
            "source_meta": source_meta,
            "transcript_words": transcript_words,
            "validation": {
                "valid": validation_error is None,
                "error": validation_error,
            },
        },
    )

    if validation_error is not None:
        return 1

    if args.render_out:
        args.render_out.parent.mkdir(parents=True, exist_ok=True)
        render(args.output_plan, args.video, args.render_out)

    print(str(args.output_plan))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

