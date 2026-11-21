/**
 * Diagnosis view model: the root-cause analysis joined back to the report's
 * own words, shaped for display (web app, Phase 3; MCP server, Phase 10).
 *
 * Pure and UI-independent. It adds no diagnosis of its own: every sentence
 * about what went wrong is the report's verbatim text from the error record.
 */
import type { ErrorRecord, ErrorType } from "../error-record/schema";
import { marksLost } from "../error-record/schema";
import type {
  ConceptRef,
  CounterEvidence,
  LinkVia,
  MarksValue,
  RootCauseAnalysis,
  RootFinding,
} from "../root-cause/types";

/** The report's own words about one mistake. */
export interface ReportEvidence {
  record_id: string;
  exam_id: string;
  exam_name: string;
  exam_date: string;
  subject: string;
  question_ref: string;
  /** Only when the report quotes the question. */
  question_text?: string;
  error_type: ErrorType;
  /** The report's own label for the error, verbatim. */
  error_label?: string;
  marks_lost?: number;
  marks_max?: number;
  /** Verbatim report wording. */
  diagnosis: string;
  correct_approach?: string;
  /** The student's working, only when the report quotes it. */
  working?: { text: string; format: "plain" | "latex" };
}

export interface ChainError {
  evidence: ReportEvidence;
  marks: MarksValue;
  via: LinkVia;
  /** Set when the question tested a different topic than this node (the report pointed back here). */
  in_question_on?: ConceptRef;
}

/** One node of a root's "why" tree: root at the top, the topics built on it below. */
export interface ChainNode {
  concept: ConceptRef;
  errors: ChainError[];
  children: ChainNode[];
}

export interface RootView {
  rank: number;
  concept: ConceptRef;
  confidence: number;
  confidence_label: RootFinding["confidence_label"];
  explanation: string;
  explanation_source: RootFinding["explanation_source"];
  error_count: number;
  exam_count: number;
  marks_lost: number;
  marks_estimated: boolean;
  board_marks_dependent: number;
  study_hours: number;
  missions: number;
  /** Distinct topics (other than the root) where the mistakes surfaced, in order of first appearance. */
  surfaced_in: ConceptRef[];
  misconceptions: RootFinding["misconceptions"];
  close_alternatives: RootFinding["close_alternatives"];
  evidence_against: CounterEvidence[];
  coverage: RootFinding["coverage"];
  chain: ChainNode;
}

export interface StandaloneView {
  concept?: ConceptRef;
  reason: "no_shared_root" | "unmapped";
  explanation: string;
  marks: MarksValue;
  study_hours: number;
  evidence: ReportEvidence;
}

export interface HabitView {
  kind: string;
  label: string;
  tip: string;
  marks_lost: number;
  marks_estimated: boolean;
  misconception?: string;
  items: { evidence: ReportEvidence; marks: MarksValue }[];
}

export type HeadlineMode = "roots" | "habits" | "standalone" | "empty";

export interface DiagnosisHeadline {
  mode: HeadlineMode;
  /** Number of things to fix: roots (mode roots) or habit patterns (mode habits) or one-offs. */
  fix_count: number;
  explained: number;
  total: number;
  marks: number;
  marks_estimated: boolean;
  /** The engine's one-line headline, for screen readers and plain-text contexts. */
  text: string;
}

export interface ReportExamSection {
  exam: { id: string; name: string; date: string; subject: string; max_marks?: number };
  items: ReportEvidence[];
}

export interface DiagnosisView {
  student_id?: string;
  graph_fingerprint: string;
  headline: DiagnosisHeadline;
  breakdown: { roots: number; standalone: number; habits: number; total: number };
  marks: { lost_total: number; explained_by_roots: number; include_estimates: boolean };
  exams: RootCauseAnalysis["exams"];
  roots: RootView[];
  standalone: StandaloneView[];
  habits: HabitView[];
  /** The report's own words, by exam, in question order: the "view original" panel. */
  report: ReportExamSection[];
  warnings: string[];
}

export class DiagnosisViewError extends Error {
  override name = "DiagnosisViewError";
}

export function buildDiagnosisView(analysis: RootCauseAnalysis, records: readonly ErrorRecord[]): DiagnosisView {
  const byId = new Map(records.map((r) => [r.id, r]));
  const evidence = (recordId: string): ReportEvidence => {
    const r = byId.get(recordId);
    if (!r) throw new DiagnosisViewError(`analysis refers to record "${recordId}", which was not passed in`);
    return reportEvidence(r);
  };

  const roots = analysis.roots.map((root): RootView => {
    const chain: ChainNode = { concept: root.concept, errors: [], children: [] };
    const surfaced = new Map<string, ConceptRef>();
    for (const e of root.explains) {
      const path = e.tested_path ?? e.path;
      let node = chain;
      for (const c of path.slice(1)) {
        let child = node.children.find((n) => n.concept.id === c.id);
        if (!child) {
          child = { concept: c, errors: [], children: [] };
          node.children.push(child);
        }
        node = child;
      }
      const last = path[path.length - 1];
      const inQuestionOn = !e.tested_path && e.tested && e.tested.id !== last?.id ? e.tested : undefined;
      node.errors.push({ evidence: evidence(e.record_id), marks: e.marks_lost, via: e.via, ...(inQuestionOn ? { in_question_on: inQuestionOn } : {}) });
      const topic = inQuestionOn ?? e.tested ?? last;
      if (topic && topic.id !== root.concept.id) surfaced.set(topic.id, topic);
    }
    sortChain(chain);
    return {
      rank: root.rank,
      concept: root.concept,
      confidence: root.confidence,
      confidence_label: root.confidence_label,
      explanation: root.explanation,
      explanation_source: root.explanation_source,
      error_count: root.explains.length,
      exam_count: root.exam_ids.length,
      marks_lost: root.marks.lost,
      marks_estimated: root.marks.estimated_part > 0,
      board_marks_dependent: root.marks.board_marks_dependent,
      study_hours: root.study_hours,
      missions: root.missions,
      surfaced_in: [...surfaced.values()],
      misconceptions: root.misconceptions,
      close_alternatives: root.close_alternatives,
      evidence_against: root.evidence_against,
      coverage: root.coverage,
      chain,
    };
  });

  const standalone = analysis.standalone.map(
    (s): StandaloneView => ({
      ...(s.concept ? { concept: s.concept } : {}),
      reason: s.reason,
      explanation: s.explanation,
      marks: s.marks_lost,
      study_hours: s.study_hours,
      evidence: evidence(s.record_id),
    }),
  );

  const habits = analysis.habits.map(
    (h): HabitView => ({
      kind: h.kind,
      label: h.label,
      tip: h.tip,
      marks_lost: h.marks_lost,
      marks_estimated: h.estimated_part > 0,
      ...(h.misconception ? { misconception: h.misconception.description } : {}),
      items: h.records.map((r) => ({ evidence: evidence(r.record_id), marks: r.marks_lost })),
    }),
  );

  const s = analysis.summary;
  const habitMarks = habits.reduce((sum, h) => sum + h.marks_lost, 0);
  const standaloneMarks = standalone.reduce((sum, x) => sum + x.marks.value, 0);
  let headline: DiagnosisHeadline;
  if (s.total_errors === 0) {
    headline = { mode: "empty", fix_count: 0, explained: 0, total: 0, marks: 0, marks_estimated: false, text: analysis.headline };
  } else if (roots.length > 0) {
    headline = {
      mode: "roots",
      fix_count: roots.length,
      explained: s.explained_by_roots,
      total: s.total_errors,
      marks: s.marks_explained_by_roots,
      marks_estimated: roots.some((r) => r.marks_estimated),
      text: analysis.headline,
    };
  } else if (s.habit_errors > 0 && s.habit_errors >= s.total_errors / 2) {
    headline = {
      mode: "habits",
      fix_count: habits.length,
      explained: s.habit_errors,
      total: s.total_errors,
      marks: habitMarks,
      marks_estimated: habits.some((h) => h.marks_estimated),
      text: analysis.headline,
    };
  } else {
    headline = {
      mode: "standalone",
      fix_count: standalone.length,
      explained: s.standalone,
      total: s.total_errors,
      marks: standaloneMarks,
      marks_estimated: standalone.some((x) => x.marks.estimated),
      text: analysis.headline,
    };
  }

  const examOrder = [...analysis.exams].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const report = examOrder
    .map((exam): ReportExamSection => {
      const recs = records.filter((r) => r.exam.id === exam.id).sort((a, b) => compareQuestionRefs(a.question.ref, b.question.ref));
      const max = recs[0]?.exam.max_marks;
      return { exam: { ...exam, ...(max !== undefined ? { max_marks: max } : {}) }, items: recs.map(reportEvidence) };
    })
    .filter((sec) => sec.items.length > 0);

  return {
    ...(analysis.student_id ? { student_id: analysis.student_id } : {}),
    graph_fingerprint: analysis.graph_fingerprint,
    headline,
    breakdown: { roots: s.explained_by_roots, standalone: s.standalone, habits: s.habit_errors, total: s.total_errors },
    marks: { lost_total: s.marks_lost_total, explained_by_roots: s.marks_explained_by_roots, include_estimates: s.marks_include_estimates },
    exams: examOrder,
    roots,
    standalone,
    habits,
    report,
    warnings: analysis.warnings,
  };
}

export function reportEvidence(r: ErrorRecord): ReportEvidence {
  const lost = marksLost(r);
  const max = r.marks?.max ?? r.question.max_marks;
  return {
    record_id: r.id,
    exam_id: r.exam.id,
    exam_name: r.exam.name,
    exam_date: r.exam.date,
    subject: r.exam.subject,
    question_ref: r.question.ref,
    ...(r.question.text ? { question_text: r.question.text } : {}),
    error_type: r.error_type,
    ...(r.error_type_original ? { error_label: r.error_type_original } : {}),
    ...(lost !== undefined ? { marks_lost: lost } : {}),
    ...(max !== undefined ? { marks_max: max } : {}),
    diagnosis: r.diagnosis.text,
    ...(r.diagnosis.correct_approach ? { correct_approach: r.diagnosis.correct_approach } : {}),
    ...(r.student_working ? { working: { text: r.student_working.text, format: r.student_working.format } } : {}),
  };
}

/** Order "Q4" before "Q11" before "Q11(b)"; non-numeric refs fall back to text order. */
export function compareQuestionRefs(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

/** Errors by exam date then question; children by their earliest error. */
function sortChain(node: ChainNode): number {
  node.errors.sort(
    (a, b) => a.evidence.exam_date.localeCompare(b.evidence.exam_date) || compareQuestionRefs(a.evidence.question_ref, b.evidence.question_ref),
  );
  const keyed = node.children.map((c) => ({ c, k: sortChain(c) }));
  keyed.sort((a, b) => a.k - b.k);
  node.children = keyed.map((x) => x.c);
  const own = node.errors.map((e) => Date.parse(e.evidence.exam_date));
  return Math.min(Number.POSITIVE_INFINITY, ...own, ...keyed.map((x) => x.k));
}

/** Count the errors in a chain subtree. */
export function chainErrorCount(node: ChainNode): number {
  return node.errors.length + node.children.reduce((s, c) => s + chainErrorCount(c), 0);
}
