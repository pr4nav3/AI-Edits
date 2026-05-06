import type { EditPlan, Segment } from "../types/editPlan";

export type OutputSegmentInfo = {
  /** Index in original `plan.segments` array */
  segmentIndex: number;
  sourceStartS: number;
  sourceEndS: number;
  speed: number;
  transitionIn?: { type: string; duration_s?: number };
  followsCut: boolean;
};

export type OutputTimeline = {
  outputSegments: OutputSegmentInfo[];
  /** overlapSeconds[i] = overlap between outputSegments[i] and outputSegments[i + 1] */
  overlapSeconds: number[];
  /** outputStartSeconds[i] = start time in output for segment i */
  outputStartSeconds: number[];
  totalDurationSeconds: number;
};

export function segmentOutputDurationS(seg: OutputSegmentInfo): number {
  return (seg.sourceEndS - seg.sourceStartS) / seg.speed;
}

function transitionOverlapS(
  prev: OutputSegmentInfo,
  curr: OutputSegmentInfo,
): number {
  if (!curr.followsCut) return 0;
  const ti = curr.transitionIn;
  if (!ti || ti.type === "none") return 0;
  const dur = ti.duration_s ?? 0.5;
  const prevOut = segmentOutputDurationS(prev);
  const currOut = segmentOutputDurationS(curr);
  const cap = Math.min(prevOut, currOut) * 0.99;
  return Math.min(dur, cap);
}

export function collectKeepSegments(plan: EditPlan): OutputSegmentInfo[] {
  const out: OutputSegmentInfo[] = [];
  for (let i = 0; i < plan.segments.length; i++) {
    const seg = plan.segments[i];
    if (seg.action !== "keep") continue;
    const prevSeg: Segment | undefined = plan.segments[i - 1];
    const followsCut = prevSeg?.action === "cut";
    out.push({
      segmentIndex: i,
      sourceStartS: seg.start_s,
      sourceEndS: seg.end_s,
      speed: seg.speed ?? 1,
      transitionIn: seg.transition_in,
      followsCut,
    });
  }
  return out;
}

export function buildOutputTimeline(plan: EditPlan): OutputTimeline {
  const outputSegments = collectKeepSegments(plan);
  const overlapSeconds: number[] = [];
  for (let i = 0; i < outputSegments.length - 1; i++) {
    overlapSeconds.push(
      transitionOverlapS(outputSegments[i], outputSegments[i + 1]),
    );
  }

  const outputStartSeconds: number[] = [];
  let t = 0;
  for (let i = 0; i < outputSegments.length; i++) {
    outputStartSeconds.push(t);
    const dur = segmentOutputDurationS(outputSegments[i]);
    if (i < outputSegments.length - 1) {
      t += dur - overlapSeconds[i];
    } else {
      t += dur;
    }
  }

  const totalDurationSeconds =
    outputSegments.length === 0
      ? 0
      : outputStartSeconds[outputSegments.length - 1] +
        segmentOutputDurationS(outputSegments[outputSegments.length - 1]);

  return {
    outputSegments,
    overlapSeconds,
    outputStartSeconds,
    totalDurationSeconds,
  };
}

/** Map source time (seconds) to output time, or `null` if inside a cut. */
export function sourceTimeToOutputSeconds(
  plan: EditPlan,
  sourceT: number,
  timeline?: OutputTimeline,
): number | null {
  const tl = timeline ?? buildOutputTimeline(plan);
  for (let i = 0; i < tl.outputSegments.length; i++) {
    const seg = tl.outputSegments[i];
    if (sourceT >= seg.sourceStartS && sourceT < seg.sourceEndS) {
      const offset = (sourceT - seg.sourceStartS) / seg.speed;
      return tl.outputStartSeconds[i] + offset;
    }
  }
  return null;
}

/**
 * Variant for range end-times.
 * Accepts source times on keep/cut boundaries (or exact video end) by nudging
 * slightly backward so overlays/music/captions don't disappear at boundaries.
 */
export function sourceTimeToOutputSecondsForRangeEnd(
  plan: EditPlan,
  sourceT: number,
  timeline?: OutputTimeline,
): number | null {
  const tl = timeline ?? buildOutputTimeline(plan);
  const direct = sourceTimeToOutputSeconds(plan, sourceT, tl);
  if (direct !== null) return direct;

  if (tl.outputSegments.length === 0) return null;

  const duration = plan.source_video.duration_s;
  const eps = 1e-4;
  if (sourceT >= duration - eps) {
    return tl.totalDurationSeconds;
  }

  const back = Math.max(0, sourceT - eps);
  return sourceTimeToOutputSeconds(plan, back, tl);
}

/**
 * Inverse: output time → source time.
 * In transition overlap windows, prefers the later segment (matches on-screen "incoming" clip).
 */
export function outputTimeToSourceTime(
  plan: EditPlan,
  outputT: number,
  timeline?: OutputTimeline,
): number | null {
  const tl = timeline ?? buildOutputTimeline(plan);
  if (outputT < 0) return null;
  if (tl.outputSegments.length === 0) return null;

  for (let i = tl.outputSegments.length - 1; i >= 0; i--) {
    const seg = tl.outputSegments[i];
    const start = tl.outputStartSeconds[i];
    const dur = segmentOutputDurationS(seg);
    if (outputT >= start && outputT < start + dur) {
      const within = outputT - start;
      return seg.sourceStartS + within * seg.speed;
    }
  }

  return null;
}
