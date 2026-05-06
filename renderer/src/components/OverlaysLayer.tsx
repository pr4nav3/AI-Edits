import React from "react";
import { AbsoluteFill, Img, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { EditPlan, Overlay } from "../types/editPlan";
import {
  sourceTimeToOutputSeconds,
  sourceTimeToOutputSecondsForRangeEnd,
} from "../lib/timeMap";
import type { OutputTimeline } from "../lib/timeMap";

function boxForPosition(
  position: Overlay["position"],
): React.CSSProperties {
  switch (position) {
    case "fullscreen":
      return { top: 0, left: 0, width: "100%", height: "100%" };
    case "picture_in_picture":
      return { bottom: "6%", right: "6%", width: "34%", height: "30%" };
    case "left_third":
      return { top: "10%", left: "3%", width: "32%", height: "55%" };
    case "right_third":
      return { top: "10%", right: "3%", width: "32%", height: "55%" };
    case "top_half":
      return { top: 0, left: 0, width: "100%", height: "48%" };
    case "bottom_half":
      return { bottom: 0, left: 0, width: "100%", height: "48%" };
    case "corner_tr":
      return { top: "4%", right: "4%", width: "28%", height: "24%" };
    case "corner_tl":
      return { top: "4%", left: "4%", width: "28%", height: "24%" };
    case "corner_br":
      return { bottom: "4%", right: "4%", width: "28%", height: "24%" };
    case "corner_bl":
      return { bottom: "4%", left: "4%", width: "28%", height: "24%" };
    default:
      return { top: "10%", right: "6%", width: "30%", height: "28%" };
  }
}

function computeEnterAnimation(
  animation: Overlay["animation"],
  frameInSequence: number,
  fps: number,
): React.CSSProperties {
  const a = animation ?? "fade_in";
  if (a === "none") return { opacity: 1 };
  if (a === "fade_in") {
    const o = interpolate(frameInSequence, [0, 12], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return { opacity: o };
  }
  if (a === "slide_in_right") {
    const x = interpolate(frameInSequence, [0, 18], [80, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return { transform: `translateX(${x}px)`, opacity: 1 };
  }
  if (a === "slide_in_left") {
    const x = interpolate(frameInSequence, [0, 18], [-80, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return { transform: `translateX(${x}px)`, opacity: 1 };
  }
  if (a === "slide_in_up") {
    const y = interpolate(frameInSequence, [0, 18], [60, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return { transform: `translateY(${y}px)`, opacity: 1 };
  }
  if (a === "pop" || a === "scale_up") {
    const s = spring({
      frame: frameInSequence,
      fps,
      config: { damping: 12 },
    });
    return { transform: `scale(${0.85 + s * 0.15})`, opacity: 1 };
  }
  return { opacity: 1 };
}

type Props = {
  editPlan: EditPlan;
  timeline: OutputTimeline;
  overlays: Overlay[];
};

export const OverlaysLayer: React.FC<Props> = ({
  editPlan,
  timeline,
  overlays,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      {overlays.map((o, i) => {
        const startOut = sourceTimeToOutputSeconds(editPlan, o.start_s, timeline);
        const endOut = sourceTimeToOutputSecondsForRangeEnd(editPlan, o.end_s, timeline);
        if (startOut === null || endOut === null) return null;
        const from = Math.max(0, Math.floor(startOut * fps));
        const to = Math.max(from + 1, Math.ceil(endOut * fps));
        const durationInFrames = to - from;
        const frameInSeq = frame - from;
        const anim = computeEnterAnimation(o.animation, frameInSeq, fps);
        const src = o.image_url;
        if (!src) {
          return null;
        }
        const isFullscreen = o.position === "fullscreen";
        return (
          <Sequence key={i} from={from} durationInFrames={durationInFrames} layout="none">
            <div
              style={{
                position: "absolute",
                ...boxForPosition(o.position),
                ...anim,
                overflow: "hidden",
                borderRadius: isFullscreen ? 0 : 12,
                boxShadow: isFullscreen ? "none" : "0 8px 32px rgba(0,0,0,0.45)",
              }}
            >
              <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
