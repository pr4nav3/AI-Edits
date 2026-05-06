/** Types aligned with edit_plan_schema.json (contract between planner and renderer). */

export type SourceVideo = {
  duration_s: number;
  width: number;
  height: number;
  fps: number;
};

export type SegmentAction = "keep" | "cut";

export type CutReason =
  | "silence"
  | "filler"
  | "repetition"
  | "off_topic"
  | "pacing"
  | "other";

export type TransitionType =
  | "none"
  | "crossfade"
  | "fade_from_black"
  | "wipe_left"
  | "wipe_right"
  | "wipe_up";

export type TransitionIn = {
  type: TransitionType;
  duration_s?: number;
};

export type Segment = {
  start_s: number;
  end_s: number;
  action: SegmentAction;
  cut_reason?: CutReason;
  speed?: number;
  transition_in?: TransitionIn;
};

export type CaptionPosition =
  | "bottom_center"
  | "top_center"
  | "center"
  | "bottom_left"
  | "bottom_right";

export type CaptionGrouping = "word_by_word" | "phrase" | "sentence";

export type WordEmphasis = "none" | "highlight" | "bold" | "color_pop";

export type CaptionWord = {
  word: string;
  start_s: number;
  end_s: number;
  emphasis?: WordEmphasis;
};

export type Captions = {
  enabled: boolean;
  position?: CaptionPosition;
  grouping?: CaptionGrouping;
  words: CaptionWord[];
};

/** 3×3 grid cell for zoom transform origin (deterministic, symmetric). */
export type ZoomAnchor =
  | "top_left"
  | "top_center"
  | "top_right"
  | "center_left"
  | "center"
  | "center_right"
  | "bottom_left"
  | "bottom_center"
  | "bottom_right"
  | "custom";

export type ZoomEasing =
  | "ease_in_out"
  | "ease_in"
  | "ease_out"
  | "linear"
  | "spring";

export type Zoom = {
  start_s: number;
  end_s: number;
  scale: number;
  anchor?: ZoomAnchor;
  anchor_xy?: { x: number; y: number };
  easing?: ZoomEasing;
};

export type OverlayPosition =
  | "fullscreen"
  | "picture_in_picture"
  | "left_third"
  | "right_third"
  | "top_half"
  | "bottom_half"
  | "corner_tr"
  | "corner_tl"
  | "corner_br"
  | "corner_bl";

export type OverlayAnimation =
  | "none"
  | "fade_in"
  | "slide_in_right"
  | "slide_in_left"
  | "slide_in_up"
  | "pop"
  | "scale_up";

export type Overlay = {
  start_s: number;
  end_s: number;
  image_query: string;
  image_url?: string;
  position: OverlayPosition;
  animation?: OverlayAnimation;
};

export type TextOverlayPosition =
  | "top_center"
  | "bottom_center"
  | "center"
  | "top_left"
  | "top_right"
  | "bottom_left"
  | "bottom_right";

export type TextOverlayStyle =
  | "title_card"
  | "lower_third"
  | "callout"
  | "stat"
  | "label";

export type TextOverlayAnimation =
  | "none"
  | "fade_in"
  | "typewriter"
  | "slide_in_up"
  | "pop";

export type TextOverlay = {
  start_s: number;
  end_s: number;
  text: string;
  position: TextOverlayPosition;
  style?: TextOverlayStyle;
  animation?: TextOverlayAnimation;
};

export type MusicMood =
  | "upbeat"
  | "chill"
  | "dramatic"
  | "corporate"
  | "playful"
  | "inspirational"
  | "dark"
  | "none";

export type Music = {
  enabled?: boolean;
  mood?: MusicMood;
  start_s?: number;
  end_s?: number;
  volume?: number;
  duck_under_speech?: boolean;
};

export type TargetAspectRatio = "16:9" | "9:16" | "1:1" | "4:5";

export type ReframeFocus = "center" | "custom";

export type Reframe = {
  enabled?: boolean;
  target_aspect_ratio?: TargetAspectRatio;
  focus?: ReframeFocus;
};

export type EditPlan = {
  source_video: SourceVideo;
  segments: Segment[];
  captions: Captions;
  zooms?: Zoom[];
  overlays?: Overlay[];
  text_overlays?: TextOverlay[];
  music?: Music;
  reframe?: Reframe;
};

/** Props passed to Remotion (CLI --props or defaultProps). */
export type EditPlanRendererProps = {
  editPlan: EditPlan;
  /** Path under `public/`, e.g. `source.mp4` */
  sourceVideoSrc: string;
  /** Optional resolved music file under `public/` */
  musicSrc?: string;
};
