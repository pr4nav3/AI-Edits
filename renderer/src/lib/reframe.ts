import type { CSSProperties } from "react";
import type { EditPlan } from "../types/editPlan";
import { getOutputDimensions } from "./dimensions";

/** CSS transform to letterbox/crop source video into output composition (cover). */
export function getReframeStyle(plan: EditPlan): CSSProperties {
  const reframe = plan.reframe;
  if (!reframe?.enabled || !reframe.target_aspect_ratio) {
    return { width: "100%", height: "100%" };
  }

  const sw = plan.source_video.width;
  const sh = plan.source_video.height;
  const { width: ow, height: oh } = getOutputDimensions(plan);
  const scale = Math.max(ow / sw, oh / sh);

  return {
    width: "100%",
    height: "100%",
    transform: `scale(${scale})`,
    transformOrigin: "50% 50%",
  };
}
