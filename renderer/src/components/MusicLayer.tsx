import React, { useMemo } from "react";
import { AbsoluteFill, Audio, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { staticFile } from "remotion";
import type { EditPlan } from "../types/editPlan";
import {
  outputTimeToSourceTime,
  sourceTimeToOutputSeconds,
  sourceTimeToOutputSecondsForRangeEnd,
} from "../lib/timeMap";
import type { OutputTimeline } from "../lib/timeMap";

type Props = {
  editPlan: EditPlan;
  timeline: OutputTimeline;
  musicSrc?: string;
};

export const MusicLayer: React.FC<Props> = ({ editPlan, timeline, musicSrc }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const music = editPlan.music;

  const speaking = useMemo(() => {
    const t = frame / fps;
    const sourceT = outputTimeToSourceTime(editPlan, t, timeline);
    if (sourceT === null) return false;
    return editPlan.captions.words.some(
      (w) => sourceT >= w.start_s && sourceT < w.end_s,
    );
  }, [editPlan, frame, fps, timeline]);

  if (!music?.enabled || !musicSrc) {
    return null;
  }

  const baseVol = music.volume ?? 0.15;
  const duck = music.duck_under_speech !== false;
  const vol = duck && speaking ? baseVol * 0.25 : baseVol;

  const startS = music.start_s ?? 0;
  const endS = music.end_s ?? editPlan.source_video.duration_s;
  const startOut = sourceTimeToOutputSeconds(editPlan, startS, timeline);
  const endOut = sourceTimeToOutputSecondsForRangeEnd(editPlan, endS, timeline);
  if (startOut === null || endOut === null) {
    return null;
  }

  const from = Math.max(0, Math.floor(startOut * fps));
  const to = Math.max(from + 1, Math.ceil(endOut * fps));
  const durationInFrames = to - from;

  return (
    <AbsoluteFill>
      <Sequence from={from} durationInFrames={durationInFrames} layout="none">
        <Audio src={staticFile(musicSrc)} volume={vol} />
      </Sequence>
    </AbsoluteFill>
  );
};
