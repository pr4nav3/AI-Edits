from __future__ import annotations

import json
import subprocess


def get_video_metadata(path: str) -> dict[str, float | int]:
    """Read canonical source_video metadata with ffprobe."""
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,r_frame_rate,duration:stream_tags=rotate:stream_side_data=rotation",
        "-of",
        "json",
        path,
    ]
    out = subprocess.check_output(cmd).decode("utf-8")
    data = json.loads(out)
    stream = data["streams"][0]

    num, den = stream["r_frame_rate"].split("/")
    fps = float(num) / float(den) if float(den) != 0 else 0.0
    duration_s = float(stream.get("duration", 0) or 0)
    width = int(stream["width"])
    height = int(stream["height"])

    # Phone videos are often encoded as landscape with a display rotation.
    # Normalize to display dimensions so downstream plan/render coordinates
    # always match what viewers actually see.
    rotation = 0
    tags = stream.get("tags") or {}
    rotate_tag = tags.get("rotate")
    try:
        if rotate_tag is not None:
            rotation = int(float(rotate_tag))
    except (TypeError, ValueError):
        rotation = 0

    if rotation == 0:
        for side_data in stream.get("side_data_list") or []:
            raw = side_data.get("rotation")
            try:
                if raw is not None:
                    rotation = int(float(raw))
                    break
            except (TypeError, ValueError):
                continue

    normalized_rotation = rotation % 360
    if normalized_rotation in (90, 270):
        width, height = height, width

    return {
        "duration_s": round(duration_s, 3),
        "width": width,
        "height": height,
        "fps": round(fps, 3),
    }

