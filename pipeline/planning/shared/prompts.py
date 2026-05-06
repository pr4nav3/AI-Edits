from __future__ import annotations

import json
from typing import Any

TRANSCRIPT_WORD_LIMIT = 1000


EDIT_PLAN_CONTRACT = """
Return one JSON object with edit decisions only.
Do not try to output a fully-complete final schema: backend compiles defaults and validates.

Decision object shape (all fields optional):
{
  "segments": [
    {
      "start_s": number,
      "end_s": number,
      "action": "keep" | "cut",
      "cut_reason": "silence" | "filler" | "repetition" | "off_topic" | "pacing" | "other",
      "speed": number,
      "transition_in": {"type": "none" | "crossfade" | "fade_from_black" | "wipe_left" | "wipe_right" | "wipe_up", "duration_s": number}
    }
  ],
  "captions": {
    "enabled": boolean,
    "position": "bottom_center" | "top_center" | "center" | "bottom_left" | "bottom_right",
    "grouping": "word_by_word" | "phrase" | "sentence",
    "emphasis_by_index": {"12": "bold", "24": "highlight"},
    "omit_indices": [13, 14],
    "words": [{"word": "token", "emphasis": "none" | "highlight" | "bold" | "color_pop", "omit": true}]
  },
  "zooms": [{"start_s": number, "end_s": number, "scale": number, "anchor": "face" | "center" | "top_third" | "bottom_third" | "custom", "easing": "ease_in_out" | "ease_in" | "ease_out" | "linear" | "spring"}],
  "overlays": [{"start_s": number, "end_s": number, "image_query": string, "position": "fullscreen" | "picture_in_picture" | "left_third" | "right_third" | "top_half" | "bottom_half" | "corner_tr" | "corner_tl" | "corner_br" | "corner_bl", "animation": "none" | "fade_in" | "slide_in_right" | "slide_in_left" | "slide_in_up" | "pop" | "scale_up"}],
  "text_overlays": [{"start_s": number, "end_s": number, "text": string, "position": "top_center" | "bottom_center" | "center" | "top_left" | "top_right" | "bottom_left" | "bottom_right", "style": "title_card" | "lower_third" | "callout" | "stat" | "label", "animation": "none" | "fade_in" | "typewriter" | "slide_in_up" | "pop"}],
  "music": {"enabled": boolean, "mood": "upbeat" | "chill" | "dramatic" | "corporate" | "playful" | "inspirational" | "dark" | "none", "start_s": number, "end_s": number, "volume": number, "duck_under_speech": boolean},
  "reframe": {"enabled": boolean, "target_aspect_ratio": "16:9" | "9:16" | "1:1" | "4:5", "focus": "face_track" | "center" | "custom"}
}

Caption rules:
- Whisper provides the canonical word list and timestamps.
- Do NOT rewrite full captions.words from scratch.
- Do NOT invent caption start_s/end_s values.
- Prefer sparse emphasis_by_index / omit_indices decisions.
- Keep output concise.
""".strip()


def build_timeline_prompt(source_meta: dict[str, Any]) -> str:
    return f"""
You are analyzing a video for an editing pipeline.

Source metadata:
{json.dumps(source_meta, indent=2)}

Return JSON only with this exact shape:
{{
  "summary": "short summary",
  "events": [
    {{
      "start": "mm:ss.ff",
      "end": "mm:ss.ff",
      "description": "short visual description",
      "visible_objects": ["object"],
      "confidence": "low|medium|high"
    }}
  ]
}}

Rules:
- Output at most 8 events.
- Timestamps must be in mm:ss.ff format.
- Each event must be at least 1 second long.
- Each description must be under 100 characters.
- Focus on visual changes and editing beats.
- Do NOT include markdown fences.
""".strip()


def build_plan_prompt(
    *,
    source_meta: dict[str, Any],
    events: list[dict[str, Any]],
    transcript_words: list[dict[str, Any]],
    user_prompt: str,
) -> str:
    # Keep transcript compact to avoid context blowups.
    transcript_slice = transcript_words[:TRANSCRIPT_WORD_LIMIT]
    return f"""
You are generating an edit plan for a deterministic renderer.

User editing request:
{user_prompt}

Source metadata:
{json.dumps(source_meta, indent=2)}

Timeline events from pass 1:
{json.dumps(events, indent=2)}

Whisper word timestamps:
{json.dumps(transcript_slice, indent=2)}

Requirements:
- Keep segments gapless across the full video duration.
- Use cuts to remove silence/filler/repetition.
- Use overlays and text only when they clearly support spoken content.
- Keep edits tasteful and avoid over-editing.
- Whisper timing is authoritative; focus caption creativity on grouping and per-word emphasis.
- Keep caption words aligned with Whisper transcript ordering.
- Do not regenerate the full caption words array; add sparse creative decisions only.
- Return one concise JSON object of decisions; backend compiles and validates the final plan.

Contract:
{EDIT_PLAN_CONTRACT}
""".strip()

