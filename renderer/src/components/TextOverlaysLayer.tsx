import React from "react";
import { AbsoluteFill, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { EditPlan, TextOverlay } from "../types/editPlan";
import {
  sourceTimeToOutputSeconds,
  sourceTimeToOutputSecondsForRangeEnd,
} from "../lib/timeMap";
import type { OutputTimeline } from "../lib/timeMap";

const SAFE_PAD = { vertical: "4%", horizontal: "6%" };

function boxForPosition(position: TextOverlay["position"]): React.CSSProperties {
  const p = position ?? "top_center";
  const base: React.CSSProperties = {
    position: "absolute",
    padding: "12px 20px",
    maxWidth: "100%",
    width: "max-content",
    boxSizing: "border-box",
    textAlign: "center",
    fontFamily: "system-ui, sans-serif",
    color: "#fff",
    textShadow: "0 2px 10px rgba(0,0,0,0.75)",
    overflowWrap: "break-word",
    wordBreak: "break-word",
  };
  if (p === "top_center")
    return { ...base, top: SAFE_PAD.vertical, left: "50%", transform: "translateX(-50%)" };
  if (p === "bottom_center")
    return {
      ...base,
      bottom: SAFE_PAD.vertical,
      left: "50%",
      transform: "translateX(-50%)",
    };
  if (p === "center")
    return { ...base, top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  if (p === "top_left") return { ...base, top: SAFE_PAD.vertical, left: 0, textAlign: "left" };
  if (p === "top_right") return { ...base, top: SAFE_PAD.vertical, right: 0, textAlign: "right" };
  if (p === "bottom_left")
    return { ...base, bottom: SAFE_PAD.vertical, left: 0, textAlign: "left" };
  return { ...base, bottom: SAFE_PAD.vertical, right: 0, textAlign: "right" };
}

function stylePreset(style: TextOverlay["style"]): React.CSSProperties {
  const s = style ?? "lower_third";
  if (s === "title_card") {
    return { fontSize: 56, fontWeight: 800, background: "rgba(0,0,0,0.55)", borderRadius: 12 };
  }
  if (s === "lower_third") {
    return { fontSize: 36, fontWeight: 700, background: "rgba(0,0,0,0.45)", borderRadius: 8 };
  }
  if (s === "callout") {
    return { fontSize: 34, fontWeight: 700, background: "rgba(80,120,255,0.55)", borderRadius: 10 };
  }
  if (s === "stat") {
    return { fontSize: 48, fontWeight: 900, background: "rgba(0,0,0,0.5)", borderRadius: 12 };
  }
  return { fontSize: 30, fontWeight: 600, background: "rgba(0,0,0,0.4)", borderRadius: 8 };
}

function enterStyle(
  animation: TextOverlay["animation"],
  frameInSequence: number,
  fps: number,
): React.CSSProperties {
  const a = animation ?? "fade_in";
  if (a === "none") return { opacity: 1 };
  if (a === "fade_in") {
    return {
      opacity: interpolate(frameInSequence, [0, 12], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }),
    };
  }
  if (a === "slide_in_up") {
    const y = interpolate(frameInSequence, [0, 16], [40, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return { transform: `translateY(${y}px)`, opacity: 1 };
  }
  if (a === "pop") {
    const s = spring({ frame: frameInSequence, fps, config: { damping: 10 } });
    return { transform: `scale(${0.9 + s * 0.1})`, opacity: 1 };
  }
  if (a === "typewriter") {
    return { opacity: 1 };
  }
  return { opacity: 1 };
}

type Props = {
  editPlan: EditPlan;
  timeline: OutputTimeline;
  items: TextOverlay[];
};

export const TextOverlaysLayer: React.FC<Props> = ({
  editPlan,
  timeline,
  items,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        padding: `${SAFE_PAD.vertical} ${SAFE_PAD.horizontal}`,
        boxSizing: "border-box",
        pointerEvents: "none",
      }}
    >
      {items.map((t, i) => {
        const startOut = sourceTimeToOutputSeconds(editPlan, t.start_s, timeline);
        const endOut = sourceTimeToOutputSecondsForRangeEnd(editPlan, t.end_s, timeline);
        if (startOut === null || endOut === null) return null;
        const from = Math.max(0, Math.floor(startOut * fps));
        const to = Math.max(from + 1, Math.ceil(endOut * fps));
        const durationInFrames = to - from;
        const frameInSeq = frame - from;
        const anim = enterStyle(t.animation, frameInSeq, fps);
        const baseBox = boxForPosition(t.position);
        const baseTransform = baseBox.transform;
        const animTransform = anim.transform;
        const transform =
          baseTransform && animTransform
            ? `${baseTransform} ${animTransform}`
            : (animTransform ?? baseTransform);
        return (
          <Sequence key={i} from={from} durationInFrames={durationInFrames} layout="none">
            <div
              style={{
                ...baseBox,
                ...stylePreset(t.style),
                ...anim,
                transform,
                maxWidth: "min(100%, 52rem)",
              }}
            >
              {t.text}
            </div>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
