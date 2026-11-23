/**
 * explain_my_mistake: gathers what the report actually says about a mistake
 * (verbatim), the root it traces back to through the prerequisite graph, and
 * the verified recap and explainer for it. No LLM call: the student's Claude
 * turns this into a plain-language explanation, grounded in these facts.
 */
import { recapFor, type ErrorRecord } from "@progresso/core";
import { lastAttempt } from "@progresso/db";
import { db, store, studentContext, type Ctx } from "@progresso/service";
import { ToolError } from "./views";

export interface MistakeEvidence {
  record_id: string;
  exam_name: string;
  exam_date: string;
  question_ref: string;
  question_text?: string;
  marks_lost?: number;
  marks_max?: number;
  error_type: string;
  /** The report's diagnosis, verbatim. */
  report_diagnosis: string;
  /** The student's working, only when the report quotes it (verbatim). */
  student_working?: string;
  /** The report's suggested correct approach, verbatim. */
  report_correct_approach?: string;
  concept: string;
  misconception?: string;
  /** Root first, this question's topic last. */
  traces_to?: { root: string; path: string[]; root_explanation: string };
  /** Verified Mistake Recap: the fix, line by line, and the key idea. */
  verified_fix?: { lines: string[]; key_idea: string; recap_mode: "student_working" | "typical_step" };
}

export interface ExplainData {
  view: "explain";
  student_id: string;
  query: string;
  matched_by: "question" | "search" | "none";
  mistakes: MistakeEvidence[];
  /** From a prove-it answer given in a mission (the question id was passed). */
  check_answer?: { question: string; given: string; correct: boolean; misconception?: string; solution: string };
  /** A verified step explainer for the misconception, if one exists. */
  explainer?: { title: string; steps: string[]; takeaway: string };
  /** When nothing matched: what the student can ask about. */
  available?: { question_ref: string; exam_name: string; concept: string }[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();
const conceptName = (ctx: Ctx, id: string | undefined) => (id && ctx.graph.has(id) ? ctx.graph.get(id).name : (id ?? ""));
const primary = (r: ErrorRecord) => r.concepts.find((c) => c.role === "primary")?.concept_id ?? r.concepts[0]?.concept_id;

function score(ctx: Ctx, r: ErrorRecord, q: string): number {
  const words = new Set(q.split(" ").filter((w) => w.length > 0));
  let s = 0;
  const ref = norm(r.question.ref);
  if (words.has(ref) || q.includes(`question ${ref.replace(/^q/, "")}`)) s += 3;
  if (q.includes(norm(r.exam.name))) s += 2;
  for (const c of r.concepts) {
    const n = norm(conceptName(ctx, c.concept_id));
    if (n && (q.includes(n) || (n.includes(q) && q.length >= 4))) s += c.role === "primary" ? 3 : 1;
    if (q.includes(norm(c.concept_id))) s += 3;
  }
  const mid = r.misconception?.misconception_id;
  if (mid && q.includes(norm(mid))) s += 4;
  const desc = norm(ctx.graph.misconceptions.get(mid ?? "")?.description ?? "");
  const overlap = [...words].filter((w) => w.length > 3 && desc.includes(w)).length;
  s += Math.min(2, overlap * 0.5);
  if (r.question.text && words.size > 1 && [...words].filter((w) => w.length > 3 && norm(r.question.text!).includes(w)).length >= 2) s += 1;
  return s;
}

function evidence(ctx: Ctx, r: ErrorRecord): MistakeEvidence {
  const root = ctx.analysis.roots.find((x) => x.explains.some((e) => e.record_id === r.id));
  const ex = root?.explains.find((e) => e.record_id === r.id);
  const lesson = recapFor(store().lessons, r);
  const lost = r.marks?.lost ?? (r.marks?.awarded !== undefined && r.marks?.max !== undefined ? r.marks.max - r.marks.awarded : undefined);
  const max = r.marks?.max ?? r.question.max_marks;
  const mid = r.misconception?.misconception_id;
  return {
    record_id: r.id,
    exam_name: r.exam.name,
    exam_date: r.exam.date,
    question_ref: r.question.ref,
    ...(r.question.text ? { question_text: r.question.text } : {}),
    ...(lost !== undefined ? { marks_lost: lost } : {}),
    ...(max !== undefined ? { marks_max: max } : {}),
    error_type: r.error_type,
    report_diagnosis: r.diagnosis.text,
    ...(r.student_working ? { student_working: r.student_working.text } : {}),
    ...(r.diagnosis.correct_approach ? { report_correct_approach: r.diagnosis.correct_approach } : {}),
    concept: conceptName(ctx, primary(r)),
    ...(mid && ctx.graph.misconceptions.has(mid) ? { misconception: ctx.graph.misconceptions.get(mid)!.description } : {}),
    ...(root && ex
      ? { traces_to: { root: root.concept.name, path: (ex.tested_path ?? ex.path).map((c) => c.name), root_explanation: root.explanation } }
      : {}),
    ...(lesson ? { verified_fix: { lines: lesson.fix.lines.map((l) => l.text), key_idea: lesson.key_idea, recap_mode: lesson.mode } } : {}),
  };
}

const withExplainer = (e: ExplainData["explainer"]) => (e ? { explainer: e } : {});

function explainerFor(misconceptionIds: (string | undefined)[]): ExplainData["explainer"] {
  for (const id of misconceptionIds) {
    const e = id ? store().lessons.explainers.get(id) : undefined;
    if (e) return { title: e.title, steps: e.steps.map((s) => (s.math ? `${s.say} ($${s.math}$)` : s.say)), takeaway: e.takeaway };
  }
  return undefined;
}

export function explainMistake(studentId: string, about: string, questionId?: string): ExplainData {
  const ctx = studentContext(studentId);
  if (!ctx) throw new ToolError(`Unknown student "${studentId}".`);
  const base = { view: "explain" as const, student_id: studentId, query: about };

  // A prove-it question the student just answered: explain that answer, tied back to the report.
  if (questionId) {
    const q = ctx.bank.byId.get(questionId);
    if (!q) throw new ToolError(`Unknown question "${questionId}".`);
    const a = lastAttempt(db(), studentId, questionId);
    const mid = a?.revealed_misconception_id;
    const recs = ctx.records.filter((r) => mid && r.misconception?.misconception_id === mid);
    const sameConcept = recs.length > 0 ? recs : ctx.records.filter((r) => r.concepts.some((c) => c.concept_id === (a?.concept_id ?? q.concept_id)));
    const chosen = q.options?.find((o) => o.id === a?.answer);
    return {
      ...base,
      matched_by: "question",
      check_answer: {
        question: q.stem,
        given: chosen ? chosen.text : (a?.answer ?? "(not answered yet)"),
        correct: a?.correct ?? false,
        ...(mid && ctx.graph.misconceptions.has(mid) ? { misconception: ctx.graph.misconceptions.get(mid)!.description } : {}),
        solution: a ? q.solution : "(answer it first to see the worked solution)",
      },
      mistakes: sameConcept.slice(0, 3).map((r) => evidence(ctx, r)),
      ...withExplainer(explainerFor([mid, q.target_misconception_id])),
    };
  }

  const query = norm(about);
  const scored = ctx.records
    .map((r, i) => ({ r, i, s: query ? score(ctx, r, query) : 0 }))
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s || a.i - b.i);
  if (scored.length === 0) {
    return {
      ...base,
      matched_by: "none",
      mistakes: [],
      available: ctx.records.map((r) => ({ question_ref: r.question.ref, exam_name: r.exam.name, concept: conceptName(ctx, primary(r)) })),
    };
  }
  const top = scored[0]!.s;
  const picked = scored.filter((x) => x.s >= top - 1).slice(0, 3).map((x) => x.r);
  return { ...base, matched_by: "search", mistakes: picked.map((r) => evidence(ctx, r)), ...withExplainer(explainerFor(picked.map((r) => r.misconception?.misconception_id))) };
}
