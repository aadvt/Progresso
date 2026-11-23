/**
 * View models the MCP tools return as `structuredContent` and the widgets
 * render. Shared by the server and the browser bundles (types only).
 *
 * Rules carried over from the web app:
 *  - the answer key never leaves the server before an answer is given;
 *  - report text (diagnosis, quoted working) is verbatim;
 *  - display names never appear (only the pseudonymous student id).
 */

/** Text that may contain $…$ maths: `text` is the raw source, `html` is escaped text with maths as MathML. */
export interface Rich {
  text: string;
  html: string;
}

export interface ExamInfo {
  name: string;
  date: string;
  days_left: number;
}

export interface Links {
  /** The web app's Today page for this student. */
  today: string;
  constellation: string;
  /** The full mission player in the web app (recap animation, explainer board, video). */
  mission?: string;
}

export interface MissionStep {
  kind: "recap" | "explainer" | "prove_it";
  label: string;
  minutes: number;
}

export interface MissionInfo {
  id: string;
  kind: "learn" | "apply" | "review" | "rehearsal";
  title: string;
  subtitle: string;
  minutes: number;
  /** Why this mission, tonight (from the plan). */
  reason: string;
  status: "planned" | "in_progress" | "completed" | "skipped";
  steps: MissionStep[];
  /** 1-based position among tonight's missions. */
  index: number;
  of: number;
}

export interface RootInfo {
  concept_id: string;
  name: string;
  chapter?: string;
  class?: number;
  /** Rank by marks recoverable per study hour, 1 = fix first. */
  rank: number;
  roots_total: number;
  /** The engine's plain-language explanation of why this is the root. */
  explanation: string;
  errors_explained: number;
  exams: number;
  marks_lost: number;
  marks_estimated: boolean;
  /** This mission works on a topic built on the root (apply), not the root itself. */
  via?: string;
}

export interface WorkingLine {
  segments: { html: string; marked?: boolean }[];
  wrong: boolean;
}

export interface RecapPreview {
  record_id: string;
  exam_name: string;
  question_ref: string;
  question?: Rich;
  marks_lost?: number;
  marks_max?: number;
  /** The report's own diagnosis, verbatim. */
  diagnosis: string;
  /**
   * student_working: the report quotes the student's working (shown as theirs);
   * typical_step: a typical wrong step, labelled "Not your working";
   * report_only: no verified recap yet, so only the report's words.
   */
  mode: "student_working" | "typical_step" | "report_only";
  wrong?: { format: "plain" | "latex"; lines: WorkingLine[]; note: Rich };
  fix?: Rich[];
  key_idea?: Rich;
  /** Other mistakes this mission also covers. */
  more: number;
}

export interface ExplainerInfo {
  /** A checked explainer video (Manim) in the web app. */
  video?: { title: string; url: string; poster: string; duration_s: number };
  /** A verified step-by-step explainer (shown in the web app's mission player). */
  steps?: { title: string; takeaway: Rich; count: number };
  /** Mistakes to watch for in this topic; `yours` = the report shows the student made it. */
  watch_for: { description: string; yours: boolean }[];
}

export interface FeedbackView {
  correct: boolean;
  /** The option id or typed value. */
  chosen: string;
  feedback: Rich;
  correct_option_id?: string;
  correct_display?: Rich;
  /** The wrong answer matched a known misconception. */
  misconception?: { id: string; description: string; yours?: { exam_name: string; question_ref: string } };
  solution: Rich;
}

export interface QuestionView {
  id: string;
  kind: "mcq" | "numeric";
  stem: Rich;
  options?: { id: string; label: Rich }[];
  unit?: string;
  concept_name: string;
  answered?: FeedbackView;
}

export interface ScoreRange {
  low: number;
  mid: number;
  high: number;
}

export interface ResultInfo {
  passed: boolean;
  outcomes: {
    concept_name: string;
    passed: boolean;
    correct: number;
    total: number;
    reason: string;
    before: string;
    after: string;
    root_mastered: boolean;
  }[];
  readiness_before?: ScoreRange;
  readiness_after: ScoreRange;
  /** A root just went to proven: the constellation in the web app plays its chain reaction. */
  ripple_root?: string;
}

export interface MissionWidgetData {
  view: "mission";
  student_id: string;
  sample: boolean;
  today: string;
  exam?: ExamInfo;
  /**
   * ready: a mission to do; done_today: tonight's missions are finished;
   * nothing_today: a rest or buffer day; no_plan: the student has nothing to plan (habits only).
   */
  state: "ready" | "done_today" | "nothing_today" | "no_plan";
  /** True when this call set up the comeback plan with default settings. */
  plan_created?: boolean;
  mission?: MissionInfo;
  root?: RootInfo;
  recap?: RecapPreview;
  explainer?: ExplainerInfo;
  questions: QuestionView[];
  result?: ResultInfo;
  next?: { title: string; date: string };
  links: Links;
}

export interface AnswerData {
  view: "answer";
  student_id: string;
  mission_id: string;
  question_id: string;
  feedback: FeedbackView;
  answered: number;
  total: number;
  /** Set when this answer completed the check and the mission was finished. */
  result?: ResultInfo;
  links: Links;
}

export type StarCode = 0 | 1 | 2 | 3 | 4; // unassessed, weak, root, learning, mastered

export interface SkyData {
  /** viewBox is 0 0 w h. */
  w: number;
  h: number;
  /** [x, y, state, flags] with flags: 1 = lit by a fixed root, 2 = on a root → mistake chain, 4 = a root. */
  nodes: [number, number, StarCode, number][];
  /** [from, to, chain (0/1)] node indexes. */
  edges: [number, number, 0 | 1][];
  /** Index into `nodes` per root id. */
  roots: Record<string, number>;
}

export interface RootProgress {
  id: string;
  name: string;
  rank: number;
  /** gap → learning → proven → retained (held at a later review). */
  state: "gap" | "learning" | "proven" | "retained";
  errors_explained: number;
  marks_lost: number;
  /** Topics that build on this root and light up when it is fixed. */
  downstream: number;
}

export interface ProgressData {
  view: "progress";
  student_id: string;
  sample: boolean;
  today: string;
  exam?: ExamInfo;
  has_plan: boolean;
  roots: RootProgress[];
  roots_fixed: number;
  readiness: { label: "Estimate"; start: ScoreRange; now: ScoreRange; potential: ScoreRange };
  missions_done: number;
  concepts_proven: number;
  concepts_targeted: number;
  /** Mistakes the student still makes in checks (from their own answers). */
  still_making: { description: string; concept: string }[];
  sky: SkyData;
  links: Links;
}
