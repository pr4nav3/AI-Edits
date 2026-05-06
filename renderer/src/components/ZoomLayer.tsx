import React, { useMemo } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { EditPlan, Zoom } from "../types/editPlan";
import {
  sourceTimeToOutputSeconds,
  sourceTimeToOutputSecondsForRangeEnd,
} from "../lib/timeMap";
import type { OutputTimeline } from "../lib/timeMap";

/** Center of each cell in a 3×3 grid (percentages). Symmetric around frame center. */
function anchorToOrigin(anchor: Zoom["anchor"], xy?: { x: number; y: number }): string {
  /** Normalized focal point overrides the grid whenever both coordinates are set. */
  if (
    xy !== undefined &&
    typeof xy.x === "number" &&
    typeof xy.y === "number" &&
    Number.isFinite(xy.x) &&
    Number.isFinite(xy.y)
  ) {
    const x = Math.max(0, Math.min(1, xy.x));
    const y = Math.max(0, Math.min(1, xy.y));
    return `${x * 100}% ${y * 100}%`;
  }
  const xL = "16.67%";
  const xM = "50%";
  const xR = "83.33%";
  const yT = "16.67%";
  const yM = "50%";
  const yB = "83.33%";
  switch (anchor ?? "center") {
    case "top_left":
      return `${xL} ${yT}`;
    case "top_center":
      return `${xM} ${yT}`;
    case "top_right":
      return `${xR} ${yT}`;
    case "center_left":
      return `${xL} ${yM}`;
    case "center":
      return `${xM} ${yM}`;
    case "center_right":
      return `${xR} ${yM}`;
    case "bottom_left":
      return `${xL} ${yB}`;
    case "bottom_center":
      return `${xM} ${yB}`;
    case "bottom_right":
      return `${xR} ${yB}`;
    case "custom":
    default:
      return `${xM} ${yM}`;
  }
}

/** Ramp-up share of the zoom window; lower = punch-in feels faster. */
const ZOOM_RAMP_FRACTION = 0.32;

function easingFor(z: Zoom["easing"]): (t: number) => number {
  switch (z) {
    case "ease_in":
      return Easing.in(Easing.ease);
    case "ease_out":
      return Easing.out(Easing.ease);
    case "linear":
      return Easing.linear;
    case "spring":
      return Easing.bezier(0.34, 1.56, 0.64, 1);
    case "ease_in_out":
    default:
      return Easing.inOut(Easing.ease);
  }
}

type Props = {
  editPlan: EditPlan;
  timeline: OutputTimeline;
  zooms: Zoom[];
  children: React.ReactNode;
};

export const ZoomLayer: React.FC<Props> = ({
  editPlan,
  timeline,
  zooms,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const active = useMemo(() => {
    for (const z of zooms) {
      const start = sourceTimeToOutputSeconds(editPlan, z.start_s, timeline);
      const end = sourceTimeToOutputSecondsForRangeEnd(editPlan, z.end_s, timeline);
      if (start === null || end === null) continue;
      const from = Math.floor(start * fps);
      const to = Math.ceil(end * fps);
      if (frame >= from && frame < to) {
        return { z, from, to };
      }
    }
    return null;
  }, [editPlan, fps, frame, timeline, zooms]);

  if (!active) {
    return <AbsoluteFill>{children}</AbsoluteFill>;
  }

  const { z, from, to } = active;
  const span = to - from;
  let scale: number;
  if (span <= 1) {
    scale = z.scale;
  } else {
    const rampFrames = Math.max(
      1,
      Math.min(span - 1, Math.round(span * ZOOM_RAMP_FRACTION)),
    );
    const rampEnd = from + rampFrames;
    scale = interpolate(frame, [from, rampEnd], [1, z.scale], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: easingFor(z.easing ?? "ease_in_out"),
    });
  }

  return (
    <AbsoluteFill
      style={{
        transform: `scale(${scale})`,
        transformOrigin: anchorToOrigin(z.anchor ?? "center", z.anchor_xy),
      }}
    >
      {children}
    </AbsoluteFill>
  );
};
