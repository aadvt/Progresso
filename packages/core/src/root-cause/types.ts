import { z } from "zod";
import { IsoDate, type ErrorType } from "../error-record/schema";
import type { RootCauseParams } from "./params";

/**
 * Evidence that the student HAS mastered a concept: a report praising a topic,
 * a question answered correctly, a passed "prove it" check (Phase 5).
 * Optional input; it lowers blame on the concept and, fading with distance,
 * on its prerequisites.
 */
export const MasteryEvidenceSchema = z
  .object({
    concept_id: z.string().min(1),
    /** 0..1: how convincingly the student showed the concept works. */
    strength: z.number().min(0).max(1),
    source: z.enum(["report_strength", "correct_answer", "mission"]),
    exam_id: z.string().optional(),
    date: IsoDate.optional(),
    note: z.string().optional(),
  })
  .strict();
export type MasteryEvidence = z.infer<typeof MasteryEvidenceSchema>;

export interface ConceptRef {
  id: string;
  name: string;
  subject: string;
  class: number;
  unit_id: string;
  chapter: string;
}

export type LinkVia = "primary" | "secondary" | "misconception";

export interface MarksValue {
  value: number;
  /** True when the record gave no marks and the value is our fallback estimate. */
  estimated: boolean;
}

export interface ExplainedError {
  record_id: string;
  question_ref: string;
  exam_id: string;
  exam_name: string;
  exam_date: string;
  error_type: ErrorType;
  /** The concept the record was mapped to that the path starts from. */
  anchor: ConceptRef;
  /** Root first, anchor last: the chain of prerequisites behind the strongest link. */
  path: ConceptRef[];
  /** The concept the question tested (the record's primary mapping). */
  tested?: ConceptRef;
  /** Root first, tested concept last, when the tested concept builds on the root: what the student sees. */
  tested_path?: ConceptRef[];
  hops: number;
  /** Mapping confidence x decay per hop, 0..1. */
  link_strength: number;
  via: LinkVia;
  marks_lost: MarksValue;
}

export interface CounterEvidence {
  /** Where the student showed the concept works. */
  concept_id: string;
  source: "slip_record" | MasteryEvidence["source"];
  /** Record id for slip evidence, or the note/exam of explicit evidence. */
  detail: string;
  /** Strength after fading to the root, 0..1. */
  strength: number;
}

export interface RootFinding {
  rank: number;
  concept: ConceptRef;
  confidence: number;
  confidence_label: "high" | "medium" | "low";
  explains: ExplainedError[];
  exam_ids: string[];
  misconceptions: { id: string; description: string; count: number }[];
  marks: {
    /** Marks lost on the explained errors (actual + estimated). */
    lost: number;
    /** Part of `lost` that is estimated because records gave no marks. */
    estimated_part: number;
    /** Board-exam marks of syllabus that builds on this concept (from unit weightage). */
    board_marks_dependent: number;
    /** confidence x (lost + boardMarksFactor x board_marks_dependent). */
    recoverable: number;
  };
  /**
   * Branch coverage: topics built directly on the root (in the subjects and
   * class range examined) and how many lead to one of the errors; plus whether
   * an error was mapped to the root itself.
   */
  coverage: { branches: number; branches_with_errors: number; root_itself: boolean };
  study_hours: number;
  missions: number;
  /** Marks recoverable per study hour: the ranking key. */
  priority: number;
  evidence_against: CounterEvidence[];
  /** Concepts that would explain nearly as well if swapped in (honesty about close calls). */
  close_alternatives: { concept: ConceptRef; relative_fit: number }[];
  explanation: string;
  explanation_source: "template" | "llm";
}

export interface StandaloneError {
  record_id: string;
  question_ref: string;
  exam_id: string;
  exam_name: string;
  error_type: ErrorType;
  concept?: ConceptRef;
  reason: "no_shared_root" | "unmapped";
  marks_lost: MarksValue;
  study_hours: number;
  explanation: string;
}

export interface HabitPattern {
  kind: "repeated_slip" | ErrorType;
  label: string;
  tip: string;
  misconception?: { id: string; description: string };
  records: { record_id: string; question_ref: string; exam_name: string; error_type: ErrorType; concept_id?: string; marks_lost: MarksValue }[];
  marks_lost: number;
  estimated_part: number;
}

export interface RootCauseAnalysis {
  student_id?: string;
  graph_fingerprint: string;
  exams: { id: string; name: string; date: string; subject: string }[];
  headline: string;
  summary: {
    total_errors: number;
    explained_by_roots: number;
    standalone: number;
    habit_errors: number;
    marks_lost_total: number;
    marks_explained_by_roots: number;
    /** True if any mark figure above includes an estimate. */
    marks_include_estimates: boolean;
  };
  roots: RootFinding[];
  standalone: StandaloneError[];
  habits: HabitPattern[];
  /** Mappings dropped because the concept id is not in the current graph (re-map needed). */
  warnings: string[];
  params: RootCauseParams;
}
