/** Serializable mission shapes the server hands to client components (no answer keys until answered). */
import type { MissionKind, MissionStatus, Readiness, StepKind } from "@progresso/core/missions/client";

export interface MissionCard {
  key: string;
  stored_id?: string;
  kind: MissionKind;
  title: string;
  subtitle: string;
  concept?: { id: string; name: string };
  review_names: string[];
  minutes: number;
  date: string;
  status: MissionStatus;
  passed?: boolean;
  steps: { kind: StepKind; label: string; minutes: number; placeholder: boolean }[];
  attempt: number;
  planned_attempts: number;
  needs_help?: boolean;
  reason: string;
}

export interface TodayData {
  student_id: string;
  today: string;
  exam: { name: string; date: string; days_left: number };
  daily_minutes: number;
  start_date: string;
  missions: MissionCard[];
  upcoming: MissionCard[];
  totals: {
    learning_done: number;
    learning_total: number;
    concepts_proven: number;
    concepts_targeted: number;
    reviews_planned: number;
    buffer_days: number;
    projected_finish?: string;
    unscheduled: number;
  };
  readiness: Readiness;
  /** Misconceptions a recent prove-it answer revealed and that are still alive. */
  alive: { id: string; description: string; concept: string }[];
  warnings: string[];
  demo: boolean;
  demo_offset: number;
  habits_only: boolean;
  questions_available: number;
}

export interface PlanDayView {
  date: string;
  kind: "past" | "study" | "buffer" | "exam";
  minutes: number;
  missed?: boolean;
  missions: MissionCard[];
}

export interface PlanData {
  student_id: string;
  today: string;
  exam: { name: string; date: string; days_left: number };
  daily_minutes: number;
  days: PlanDayView[];
  unscheduled: { title: string; subtitle: string }[];
  not_covered: { question_ref: string; reason: string }[];
  warnings: string[];
  totals: TodayData["totals"];
}

export interface RecapEvidence {
  record_id: string;
  exam_name: string;
  question_ref: string;
  question_text?: string;
  diagnosis: string;
  working?: string;
  correct_approach?: string;
  marks_lost?: number;
}

export interface FeedbackView {
  correct: boolean;
  chosen: string;
  feedback: string;
  correct_option_id?: string;
  correct_display?: string;
  misconception?: { id: string; description: string; yours?: { exam_name: string; question_ref: string } };
  solution: string;
}

export interface QuestionView {
  id: string;
  kind: "mcq" | "numeric";
  stem: string;
  options?: { id: string; text: string }[];
  unit?: string;
  concept_name: string;
  answered?: FeedbackView;
}

export interface OutcomeView {
  concept_id: string;
  concept_name: string;
  passed: boolean;
  correct: number;
  total: number;
  reason: string;
  before: string;
  after: string;
  root_mastered: boolean;
}

export interface ResultView {
  passed: boolean;
  outcomes: OutcomeView[];
  readiness_before?: Readiness["now"];
  readiness_after: Readiness["now"];
  ripple_root?: string;
  next?: MissionCard;
}

export interface MissionData {
  id: string;
  student_id: string;
  date: string;
  status: "planned" | "in_progress" | "completed" | "skipped";
  card: MissionCard;
  recap: RecapEvidence[];
  explainer: {
    concept_name: string;
    chapter: string;
    class: number;
    root_name?: string;
    watch_for: { id: string; description: string; yours: boolean }[];
  } | null;
  questions: QuestionView[];
  result?: ResultView;
}
