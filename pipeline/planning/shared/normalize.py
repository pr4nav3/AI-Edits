from __future__ import annotations

import json
import re
from typing import Any


def extract_json_object(text: str) -> dict[str, Any]:
    text = text.strip()

    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return json.loads(text[start : end + 1])

    raise ValueError("No valid JSON object found in model output")


def ts_to_seconds(ts: str) -> float:
    m = re.match(r"^(\d+):(\d{2})\.(\d{2})$", str(ts).strip())
    if not m:
        raise ValueError(f"Bad timestamp format: {ts}")
    mm, ss, cs = map(int, m.groups())
    return mm * 60 + ss + cs / 100.0


def seconds_to_ts(seconds: float) -> str:
    seconds = max(0.0, float(seconds))
    mm = int(seconds // 60)
    rest = seconds - (mm * 60)
    ss = int(rest)
    cs = int(round((rest - ss) * 100))
    if cs == 100:
        ss += 1
        cs = 0
    if ss == 60:
        mm += 1
        ss = 0
    return f"{mm:02d}:{ss:02d}.{cs:02d}"


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def validate_events(
    events: list[dict[str, Any]],
    duration_s: float,
    min_len_s: float = 1.0,
) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    for event in events:
        try:
            start = clamp(ts_to_seconds(event["start"]), 0, duration_s)
            end = clamp(ts_to_seconds(event["end"]), 0, duration_s)
        except Exception:
            continue
        if end <= start or (end - start) < min_len_s:
            continue
        cleaned.append(
            {
                "start": seconds_to_ts(start),
                "end": seconds_to_ts(end),
                "start_s": round(start, 2),
                "end_s": round(end, 2),
                "description": event.get("description", ""),
                "visible_objects": event.get("visible_objects", []),
                "speech_or_text": event.get("speech_or_text", ""),
                "confidence": event.get("confidence", "medium"),
            }
        )

    cleaned.sort(key=lambda x: x["start_s"])
    deduped: list[dict[str, Any]] = []
    for event in cleaned:
        if deduped and event["start_s"] >= deduped[-1]["start_s"] and event["end_s"] <= deduped[-1]["end_s"]:
            continue
        deduped.append(event)
    return deduped


def make_gapless_segments(
    segments: list[dict[str, Any]],
    duration_s: float,
    eps: float = 0.05,
) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    duration_exact = round(float(duration_s), 3)

    for seg in segments or []:
        try:
            start = clamp(float(seg["start_s"]), 0, duration_s)
            end = clamp(float(seg["end_s"]), 0, duration_s)
        except Exception:
            continue
        if end - start <= eps:
            continue

        action = seg.get("action", "keep")
        if action not in {"keep", "cut"}:
            action = "keep"

        out: dict[str, Any] = {
            "start_s": round(start, 2),
            "end_s": round(end, 2),
            "action": action,
        }

        if out["end_s"] <= out["start_s"]:
            continue

        if action == "cut":
            reason = seg.get("cut_reason", "pacing")
            if reason not in {"silence", "filler", "repetition", "off_topic", "pacing", "other"}:
                reason = "pacing"
            out["cut_reason"] = reason
        else:
            try:
                speed = float(seg.get("speed", 1.0))
            except Exception:
                speed = 1.0
            out["speed"] = round(clamp(speed, 0.5, 2.0), 2)

            transition = seg.get("transition_in") or {"type": "none"}
            if isinstance(transition, str):
                transition = {"type": transition}
            if not isinstance(transition, dict):
                transition = {"type": "none"}
            transition_type = transition.get("type", "none")
            if transition_type not in {
                "none",
                "crossfade",
                "fade_from_black",
                "wipe_left",
                "wipe_right",
                "wipe_up",
            }:
                transition_type = "none"
            clean_transition: dict[str, Any] = {"type": transition_type}
            if transition_type != "none":
                try:
                    transition_duration = float(transition.get("duration_s", 0.5))
                except Exception:
                    transition_duration = 0.5
                clean_transition["duration_s"] = round(clamp(transition_duration, 0.1, 2.0), 2)
            out["transition_in"] = clean_transition

        cleaned.append(out)

    cleaned.sort(key=lambda x: x["start_s"])

    gapless: list[dict[str, Any]] = []
    cursor = 0.0
    for seg in cleaned:
        start = seg["start_s"]
        end = seg["end_s"]
        if end <= cursor + eps:
            continue
        if start > cursor + eps:
            filler = {
                "start_s": round(cursor, 2),
                "end_s": round(start, 2),
                "action": "keep",
                "speed": 1.0,
                "transition_in": {"type": "none"},
            }
            if filler["end_s"] > filler["start_s"]:
                gapless.append(filler)

        seg["start_s"] = round(max(start, cursor), 2)
        if seg["end_s"] > seg["start_s"]:
            gapless.append(seg)
            cursor = max(cursor, seg["end_s"])

    if duration_s - cursor > eps:
        tail = {
            "start_s": round(cursor, 2),
            "end_s": duration_exact,
            "action": "keep",
            "speed": 1.0,
            "transition_in": {"type": "none"},
        }
        if tail["end_s"] > tail["start_s"]:
            gapless.append(tail)

    if not gapless:
        return [
            {
                "start_s": 0.0,
                "end_s": duration_exact,
                "action": "keep",
                "speed": 1.0,
                "transition_in": {"type": "none"},
            }
        ]

    gapless[0]["start_s"] = 0.0
    # Force exact source duration coverage to satisfy semantic validation.
    gapless[-1]["end_s"] = duration_exact
    return [seg for seg in gapless if seg["end_s"] > seg["start_s"]]


def filter_timed_items(items: list[dict[str, Any]], duration_s: float) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    for item in items or []:
        try:
            start = clamp(float(item["start_s"]), 0, duration_s)
            end = clamp(float(item["end_s"]), 0, duration_s)
        except Exception:
            continue
        if end <= start:
            continue
        out = dict(item)
        out["start_s"] = round(start, 2)
        out["end_s"] = round(end, 2)
        cleaned.append(out)
    return cleaned


def default_keep_plan(
    source_meta: dict[str, Any],
    caption_words: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    duration_s = float(source_meta["duration_s"])
    return {
        "source_video": {
            "duration_s": source_meta["duration_s"],
            "width": source_meta["width"],
            "height": source_meta["height"],
            "fps": source_meta["fps"],
        },
        "segments": [
            {
                "start_s": 0.0,
                "end_s": round(duration_s, 3),
                "action": "keep",
                "speed": 1.0,
                "transition_in": {"type": "none"},
            }
        ],
        "captions": {
            "enabled": True,
            "position": "bottom_center",
            "grouping": "phrase",
            "words": caption_words or [],
        },
        "zooms": [],
        "overlays": [],
        "text_overlays": [],
        "music": {
            "enabled": False,
            "mood": "none",
            "start_s": 0,
            "end_s": round(duration_s, 3),
            "volume": 0.15,
            "duck_under_speech": True,
        },
        "reframe": {
            "enabled": False,
            "target_aspect_ratio": "9:16",
            "focus": "face_track",
        },
    }


def build_final_plan(
    model_plan: dict[str, Any],
    source_meta: dict[str, Any],
    caption_words: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    duration_s = float(source_meta["duration_s"])
    plan = {
        "source_video": {
            "duration_s": source_meta["duration_s"],
            "width": source_meta["width"],
            "height": source_meta["height"],
            "fps": source_meta["fps"],
        },
        "segments": make_gapless_segments(model_plan.get("segments", []), duration_s),
        "captions": model_plan.get("captions")
        or {
            "enabled": True,
            "position": "bottom_center",
            "grouping": "phrase",
            "words": [],
        },
        "zooms": filter_timed_items(model_plan.get("zooms", []), duration_s),
        "overlays": filter_timed_items(model_plan.get("overlays", []), duration_s),
        "text_overlays": filter_timed_items(model_plan.get("text_overlays", []), duration_s),
        "music": model_plan.get("music")
        or {
            "enabled": False,
            "mood": "none",
            "start_s": 0,
            "end_s": duration_s,
            "volume": 0.15,
            "duck_under_speech": True,
        },
        "reframe": model_plan.get("reframe")
        or {
            "enabled": False,
            "target_aspect_ratio": "9:16",
            "focus": "face_track",
        },
    }

    # Whisper timings are the authoritative caption timeline when available.
    if caption_words is not None:
        plan["captions"]["words"] = caption_words
    else:
        plan["captions"].setdefault("words", [])

    plan["music"].setdefault("enabled", False)
    plan["music"].setdefault("mood", "none")
    plan["music"].setdefault("start_s", 0)
    plan["music"].setdefault("end_s", duration_s)
    plan["music"].setdefault("volume", 0.15)
    plan["music"].setdefault("duck_under_speech", True)
    return plan

