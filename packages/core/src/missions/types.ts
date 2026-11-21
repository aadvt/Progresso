import type { MasteryLevel } from "../constellation/types";
import type { IsoDay } from "./dates";

/**
 * learn:     re-learn a concept (a root, or a one-off gap), ending in its prove-it gate.
 * apply:     use a fixed root where the student's mistakes surfaced (a symptom topic), with its own gate.
 * review:    FSRS-scheduled quick checks on concepts already proven, so they hold until the exam.
 * rehearsal: buffer days before the exam: mixed checks across everything fixed, no new learning.
 */
export type MissionKind = "learn" | "apply" | "review" | "rehearsal";

export type StepKind = "recap" | "explainer" | "prove_it";

export interface MissionStep {
  kind: StepKind;
  minutes: number;
  /**
   * Content status. "placeholder": the structure is real but the content
   * arrives later (Mistake Recap and explainers come in Phases 6–8);
   * "ready": real content (prove-it questions from the verified bank).
   */
  content: "ready" | "placeholder";
}

export type MissionStatus = "done" | "skipped" | "today" | "planned";

export interface PlannedMission {
  /** Deterministic work id: `${kind}:${concept}:${n}` for learning, `${kind}:${date}:${slot}` for reviews. */
  key: string;
  kind: MissionKind;
  date: IsoDay;
  slot: number;
  minutes: number;
  /** The concept a learn/apply mission targets. */
  concept_id?: string;
  /** The root this mission serves (learn on a root, or apply of it). */
  root_id?: string;
  /** 1-based: which attempt at this concept's gate. */
  attempt: number;
  /** Planned attempts for this concept (attempt > planned means an extra go). */
  planned_attempts: number;
  /** Concepts checked in a review or rehearsal. */
  review_concepts: string[];
  /** Report records this mission recaps (verbatim evidence). */
  record_ids: string[];
  /** Misconceptions the prove-it check targets: the student's own first. */
  misconception_ids: string[];
  status: MissionStatus;
  /** For done missions: whether the gate/review passed. */
  passed?: boolean;
  steps: MissionStep[];
  /** One line: why this mission, why now. */
  reason: string;
  /** Plan-time projection: this mission is expected to prove the concept (its last planned attempt). */
  proves?: boolean;
  /** The gate kept failing beyond the retries: suggest asking a teacher. */
  needs_help?: boolean;
  /** Set when today's mission has been started (the stored mission id). */
  stored_id?: string;
}

export type DayKind = "past" | "study" | "buffer" | "exam";

export interface PlanDay {
  date: IsoDay;
  kind: DayKind;
  /** Minutes planned (≤ daily budget). */
  minutes: number;
  missions: PlannedMission[];
  /** Past days with nothing done. */
  missed?: boolean;
}

/** A unit of learning work, before it is placed on a day. */
export interface WorkItem {
  key: string;
  kind: "learn" | "apply";
  concept_id: string;
  root_id?: string;
  /** Block = a root (all its missions) or a one-off gap. Blocks are scheduled in order. */
  block: string;
  attempt: number;
  planned_attempts: number;
  record_ids: string[];
  misconception_ids: string[];
  /** Marks per study hour of the block (the ranking key). */
  priority: number;
  /** True for the last planned attempt: the plan projects the gate passes here. */
  proves: boolean;
  needs_help: boolean;
  reason: string;
}

export interface PlanSettings {
  exam_name: string;
  exam_date: IsoDay;
  daily_minutes: number;
  /** First day of the plan (when the student started it). */
  start_date: IsoDay;
}

/** One concept's learning state, as the plan and readiness see it. */
export interface ConceptProgress {
  state: MasteryLevel;
  /** FSRS: next review day. */
  due?: IsoDay;
  /** FSRS stability (days) and the serialised card. */
  stability?: number;
  card?: SerializedCard;
  proven_at?: IsoDay;
}

/** A ts-fsrs card in JSON-safe form (dates as ISO strings). */
export interface SerializedCard {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: string;
}

/** A past mission, as stored. */
export interface MissionRecord {
  key: string;
  kind: MissionKind;
  date: IsoDay;
  slot: number;
  status: "completed" | "skipped";
  concept_id?: string;
  root_id?: string;
  review_concepts?: string[];
  passed?: boolean;
  /** False when the mission had no verified questions, so nothing was checked (absent: assume checked). */
  checked?: boolean;
  minutes?: number;
}

export interface ProgressState {
  concepts: Record<string, ConceptProgress>;
  history: MissionRecord[];
}

export interface ComebackPlan {
  student_id: string;
  today: IsoDay;
  settings: PlanSettings;
  days: PlanDay[];
  /** Learning missions that don't fit before the buffer days (lowest marks-per-hour last, so these are dropped first). */
  unscheduled: WorkItem[];
  /** Topics the plan can't cover (not in the concept map). */
  not_covered: { record_id: string; question_ref: string; reason: string }[];
  totals: {
    /** Learning missions: done, still to do (scheduled), and in the whole plan. */
    learning_done: number;
    learning_remaining: number;
    reviews_planned: number;
    /** Concepts whose gate is passed / all concepts the plan targets. */
    concepts_proven: number;
    concepts_targeted: number;
    days_left: number;
    buffer_days: number;
    /** Last study day with new learning (projected). */
    projected_finish?: IsoDay;
  };
  warnings: string[];
}
