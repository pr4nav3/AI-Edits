import type { Caption } from "@remotion/captions";
import { createTikTokStyleCaptions } from "@remotion/captions";
import React, { useMemo } from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { EditPlan } from "../types/editPlan";
import type { CaptionWord } from "../types/editPlan";
import { sourceTimeToOutputSeconds } from "../lib/timeMap";
import type { OutputTimeline } from "../lib/timeMap";

const PHRASE_COMBINE_MS = 450;
const MAX_SENTENCE_WORDS = 10;
const MAX_SENTENCE_DURATION_MS = 3200;

type PageToken = {
  text: string;
  fromMs: number;
  toMs: number;
};

type CaptionPage = {
  text: string;
  startMs: number;
  durationMs: number;
  tokens: PageToken[];
};

function endsSentence(tokenText: string): boolean {
  return /[.!?]["')\]]*$/.test(tokenText.trim());
}

function makePage(tokens: PageToken[]): CaptionPage {
  const startMs = tokens[0]?.fromMs ?? 0;
  const endMs = tokens[tokens.length - 1]?.toMs ?? startMs + 1;
  return {
    text: tokens.map((t) => t.text).join(" "),
    startMs,
    durationMs: Math.max(1, endMs - startMs),
    tokens,
  };
}

function buildSentencePages(words: CaptionWord[]): CaptionPage[] {
  const pages: CaptionPage[] = [];
  let current: PageToken[] = [];

  const flush = () => {
    if (current.length === 0) return;
    pages.push(makePage(current));
    current = [];
  };

  for (const w of words) {
    const next: PageToken = {
      text: w.word,
      fromMs: w.start_s * 1000,
      toMs: w.end_s * 1000,
    };

    if (current.length > 0) {
      const firstMs = current[0].fromMs;
      const projectedWords = current.length + 1;
      const projectedDuration = next.toMs - firstMs;
      if (
        projectedWords > MAX_SENTENCE_WORDS ||
        projectedDuration > MAX_SENTENCE_DURATION_MS
      ) {
        flush();
      }
    }

    current.push(next);

    const duration = current[current.length - 1].toMs - current[0].fromMs;
    if (
      endsSentence(next.text) ||
      current.length >= MAX_SENTENCE_WORDS ||
      duration >= MAX_SENTENCE_DURATION_MS
    ) {
      flush();
    }
  }

  flush();
  return pages;
}

function findWordForToken(
  words: CaptionWord[],
  text: string,
  fromMs: number,
  toMs: number,
): CaptionWord | undefined {
  return words.find(
    (w) =>
      w.word.trim() === text.trim() &&
      Math.abs(w.start_s * 1000 - fromMs) < 80 &&
      Math.abs(w.end_s * 1000 - toMs) < 80,
  );
}

function emphasisClass(emphasis: CaptionWord["emphasis"]): string {
  switch (emphasis) {
    case "highlight":
      return "ae-caption-emphasis-highlight";
    case "bold":
      return "ae-caption-emphasis-bold";
    case "color_pop":
      return "ae-caption-emphasis-pop";
    default:
      return "";
  }
}

function positionStyle(
  position: NonNullable<EditPlan["captions"]["position"]> | undefined,
): React.CSSProperties {
  const p = position ?? "bottom_center";
  const base: React.CSSProperties = {
    display: "flex",
    justifyContent: "center",
    width: "100%",
    padding: "5%",
    pointerEvents: "none",
  };
  if (p === "bottom_center")
    return { ...base, alignItems: "flex-end", justifyContent: "center" };
  if (p === "top_center")
    return { ...base, alignItems: "flex-start", justifyContent: "center" };
  if (p === "center")
    return { ...base, alignItems: "center", justifyContent: "center" };
  if (p === "bottom_left")
    return { ...base, alignItems: "flex-end", justifyContent: "flex-start" };
  return { ...base, alignItems: "flex-end", justifyContent: "flex-end" };
}

type Props = {
  editPlan: EditPlan;
  timeline: OutputTimeline;
};

export const CaptionsLayer: React.FC<Props> = ({ editPlan, timeline }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const captions = editPlan.captions;

  const wordsInKept = useMemo(() => {
    return captions.words.filter((w) => {
      const mid = (w.start_s + w.end_s) / 2;
      return sourceTimeToOutputSeconds(editPlan, mid, timeline) !== null;
    });
  }, [captions.words, editPlan, timeline]);

  const pages = useMemo(() => {
    const grouping = captions.grouping ?? "phrase";
    if (grouping === "word_by_word") {
      return wordsInKept.map((w) => ({
        text: w.word,
        startMs: w.start_s * 1000,
        durationMs: Math.max(1, (w.end_s - w.start_s) * 1000),
        tokens: [
          {
            text: w.word,
            fromMs: w.start_s * 1000,
            toMs: w.end_s * 1000,
          },
        ],
      }));
    }
    if (grouping === "sentence") {
      return buildSentencePages(wordsInKept);
    }
    const cap: Caption[] = wordsInKept.map((w) => ({
      text: w.word,
      startMs: w.start_s * 1000,
      endMs: w.end_s * 1000,
      timestampMs: w.start_s * 1000,
      confidence: null,
    }));
    const { pages: tiktokPages } = createTikTokStyleCaptions({
      captions: cap,
      combineTokensWithinMilliseconds: PHRASE_COMBINE_MS,
    });
    return tiktokPages.map((p) => ({
      text: p.text,
      startMs: p.startMs,
      durationMs: p.durationMs,
      tokens: p.tokens,
    }));
  }, [captions.grouping, wordsInKept]);

  const currentTime = frame / fps;

  if (!captions.enabled || pages.length === 0) {
    return null;
  }

  return (
    <AbsoluteFill style={positionStyle(captions.position)}>
      <div
        style={{
          maxWidth: "92%",
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
          fontSize: 42,
          fontWeight: 700,
          color: "#fff",
          textShadow: "0 2px 8px rgba(0,0,0,0.85)",
          lineHeight: 1.25,
          whiteSpace: "normal",
        }}
      >
        {pages.map((page, idx) => {
          const startOut = sourceTimeToOutputSeconds(
            editPlan,
            page.startMs / 1000,
            timeline,
          );
          if (startOut === null) return null;
          const endOut = sourceTimeToOutputSeconds(
            editPlan,
            (page.startMs + page.durationMs) / 1000,
            timeline,
          );
          if (endOut === null) return null;
          const from = Math.max(0, Math.floor(startOut * fps));
          const to = Math.max(from + 1, Math.ceil(endOut * fps));
          const durationInFrames = to - from;

          const activeWord = page.tokens.find((tok) => {
            const a = sourceTimeToOutputSeconds(editPlan, tok.fromMs / 1000, timeline);
            const b = sourceTimeToOutputSeconds(editPlan, tok.toMs / 1000, timeline);
            if (a === null || b === null) return false;
            return currentTime >= a && currentTime < b;
          });

          return (
            <Sequence key={idx} from={from} durationInFrames={durationInFrames} layout="none">
              <span>
                {page.tokens.map((tok, ti) => {
                  const w = findWordForToken(wordsInKept, tok.text, tok.fromMs, tok.toMs);
                  const em = w?.emphasis ?? "none";
                  const isActive =
                    activeWord &&
                    tok.fromMs === activeWord.fromMs &&
                    tok.toMs === activeWord.toMs;
                  return (
                    <span
                      key={ti}
                      className={`${emphasisClass(em)} ${isActive ? "ae-caption-active" : ""}`}
                      style={{
                        marginRight: 6,
                        padding: em === "highlight" ? "2px 8px" : undefined,
                        borderRadius: em === "highlight" ? 6 : undefined,
                        background:
                          em === "highlight"
                            ? "rgba(255, 230, 0, 0.35)"
                            : undefined,
                        color:
                          em === "color_pop"
                            ? "#7ee787"
                            : em === "bold"
                              ? "#fff"
                              : undefined,
                        fontWeight: em === "bold" ? 900 : 700,
                        textShadow: isActive
                          ? "0 0 12px rgba(255,255,255,0.95)"
                          : undefined,
                      }}
                    >
                      {tok.text}
                    </span>
                  );
                })}
              </span>
            </Sequence>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
