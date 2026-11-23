/**
 * Mission views for the web app: Today, the plan timeline, the mission
 * player. Thin: the logic lives in @progresso/core (plan, mastery, readiness)
 * and @progresso/db (the mission service).
 */
import {
  daysBetween,
  gradeAnswer,
  nextMission,
  prettyWorking,
  recapFor,
  type ComebackPlan,
  type ConceptGraph,
  type ErrorRecord,
  type LessonCheck,
  type MistakeRecap,
  type PlannedMission,
  type Readiness,
  type StepExplainer,
} from "@progresso/core";
import {
  answerQuestion,
  finishMission,
  getMission,
  getPlan,
  getPlanSettings,
  getReadiness,
  liveMisconceptions,
  ownMisconceptions,
  resetPlan,
  savePlanSettings,
  setDemoDayOffset,
  startMission,
  type MissionResultJson,
} from "@progresso/db";
import type { ExplainerLesson, FeedbackView, MissionCard, MissionData, PlanData, RecapEvidence, RecapLesson, ReplaysData, ResultView, TodayData, WorkingSegment } from "@/lib/mission-types";
import { db, getLessons, isSample, studentContext, studentToday } from "./data";

type Ctx = NonNullable<ReturnType<typeof studentContext>>;

const STEP_LABEL = { recap: "Mistake Recap", explainer: "Explainer", prove_it: "Prove it" } as const;

function name(graph: ConceptGraph, id: string | undefined): string {
  return id && graph.has(id) ? graph.get(id).name : (id ?? "");
}

/** Which of a mission's steps have real content: a verified recap for one of its records, an explainer for one of its misconceptions. */
function stepContent(ctx: Ctx, m: Pick<PlannedMission, "record_ids" | "misconception_ids">): { recap: boolean; explainer: boolean } {
  const lessons = getLessons();
  const byId = new Map(ctx.records.map((r) => [r.id, r]));
  return {
    recap: m.record_ids.some((id) => {
      const r = byId.get(id);
      return r !== undefined && recapFor(lessons, r) !== undefined;
    }),
    explainer: m.misconception_ids.some((id) => lessons.explainers.has(id)),
  };
}

function card(ctx: Ctx, m: PlannedMission): MissionCard {
  const graph = ctx.graph;
  const content = stepContent(ctx, m);
  const concept = m.concept_id ? { id: m.concept_id, name: name(graph, m.concept_id) } : undefined;
  const root = name(graph, m.root_id);
  const review_names = m.review_concepts.map((c) => name(graph, c));
  let title: string;
  let subtitle: string;
  switch (m.kind) {
    case "learn":
      title = m.root_id ? `Fix the root: ${concept!.name}` : `Fix a one-off gap: ${concept!.name}`;
      subtitle = m.attempt > m.planned_attempts ? "One more go at the check" : m.planned_attempts > 1 ? `Part ${m.attempt} of ${m.planned_attempts}` : "One mission";
      break;
    case "apply":
      title = `${root} in ${concept!.name}`;
      subtitle = m.attempt > 1 ? "One more go at the check" : "Use the fixed root where your mistake was";
      break;
    case "review":
      title = review_names.length === 1 ? `Quick review: ${review_names[0]}` : `Quick review: ${review_names.length} topics`;
      subtitle = "Spaced so it holds until the exam";
      break;
    case "rehearsal":
      title = "Exam rehearsal";
      subtitle = "Mixed check across what you've fixed";
      break;
  }
  return {
    key: m.key,
    ...(m.stored_id ? { stored_id: m.stored_id } : {}),
    kind: m.kind,
    title,
    subtitle,
    ...(concept ? { concept } : {}),
    review_names,
    minutes: m.minutes,
    date: m.date,
    status: m.status,
    ...(m.passed !== undefined ? { passed: m.passed } : {}),
    steps: m.steps.map((s) => ({ kind: s.kind, label: STEP_LABEL[s.kind], minutes: s.minutes, placeholder: s.kind === "prove_it" ? s.content === "placeholder" : !content[s.kind] })),
    attempt: m.attempt,
    planned_attempts: m.planned_attempts,
    ...(m.needs_help ? { needs_help: true } : {}),
    reason: m.reason,
  };
}

function totals(plan: ComebackPlan): TodayData["totals"] {
  return {
    learning_done: plan.totals.learning_done,
    learning_total: plan.totals.learning_done + plan.totals.learning_remaining + plan.unscheduled.length,
    concepts_proven: plan.totals.concepts_proven,
    concepts_targeted: plan.totals.concepts_targeted,
    reviews_planned: plan.totals.reviews_planned,
    buffer_days: plan.totals.buffer_days,
    ...(plan.totals.projected_finish ? { projected_finish: plan.totals.projected_finish } : {}),
    unscheduled: plan.unscheduled.length,
  };
}

function targeted(plan: ComebackPlan): string[] {
  return [...new Set(plan.days.flatMap((d) => d.missions.map((m) => m.concept_id)).filter((c): c is string => !!c).concat(plan.unscheduled.map((u) => u.concept_id)))];
}

export interface PlanDefaults {
  exam_name: string;
  exam_date: string;
  daily_minutes: number;
  today: string;
}

export function planDefaults(studentId: string): PlanDefaults | undefined {
  const ctx = studentContext(studentId);
  if (!ctx) return undefined;
  const today = studentToday(studentId);
  return { exam_name: ctx.next_exam?.name ?? "Next exam", exam_date: ctx.next_exam?.date ?? "", daily_minutes: 25, today };
}

export function hasPlan(studentId: string): boolean {
  return getPlanSettings(db(), studentId) !== undefined;
}

export function getToday(studentId: string): TodayData | undefined {
  const ctx = studentContext(studentId);
  if (!ctx) return undefined;
  const settings = getPlanSettings(db(), studentId);
  if (!settings) return undefined;
  const today = studentToday(studentId);
  const plan = getPlan(db(), ctx, today)!;
  const readiness = getReadiness(db(), ctx, settings.exam_date, targeted(plan));
  const todays = plan.days.find((d) => d.date === today)?.missions ?? [];
  const upcoming = plan.days
    .filter((d) => d.date > today)
    .flatMap((d) => d.missions)
    .slice(0, 4);
  const alive = [...liveMisconceptions(db(), ctx).values()]
    .filter((s) => s.alive && s.source === "check")
    .map((s) => {
      const m = ctx.graph.misconceptions.get(s.id);
      return { id: s.id, description: m?.description ?? s.id, concept: name(ctx.graph, m?.concept_id) };
    });
  return {
    student_id: studentId,
    today,
    exam: { name: settings.exam_name, date: settings.exam_date, days_left: daysBetween(today, settings.exam_date) },
    daily_minutes: settings.daily_minutes,
    start_date: settings.start_date,
    missions: todays.map((m) => card(ctx, m)),
    upcoming: upcoming.map((m) => card(ctx, m)),
    totals: totals(plan),
    readiness,
    alive,
    warnings: plan.warnings,
    demo: isSample(studentId),
    demo_offset: settings.demo_day_offset,
    habits_only: ctx.analysis.roots.length === 0 && plan.totals.concepts_targeted === 0,
    questions_available: ctx.bank.questions.length,
    replays_available: ctx.records.filter((r) => recapFor(getLessons(), r)).length,
  };
}

export function getPlanView(studentId: string): PlanData | undefined {
  const ctx = studentContext(studentId);
  const settings = getPlanSettings(db(), studentId);
  if (!ctx || !settings) return undefined;
  const today = studentToday(studentId);
  const plan = getPlan(db(), ctx, today)!;
  return {
    student_id: studentId,
    today,
    exam: { name: settings.exam_name, date: settings.exam_date, days_left: daysBetween(today, settings.exam_date) },
    daily_minutes: settings.daily_minutes,
    days: plan.days.map((d) => ({ date: d.date, kind: d.kind, minutes: d.minutes, ...(d.missed ? { missed: true } : {}), missions: d.missions.map((m) => card(ctx, m)) })),
    unscheduled: plan.unscheduled.map((u) => {
      const c = card(ctx, { ...u, date: "", slot: 0, minutes: 25, review_concepts: [], status: "planned", steps: [] });
      return { title: c.title, subtitle: c.subtitle };
    }),
    not_covered: plan.not_covered.map((n) => ({ question_ref: n.question_ref, reason: n.reason })),
    warnings: plan.warnings,
    totals: totals(plan),
  };
}

// ---------------------------------------------------------------- the player

function checkedWords(checks: LessonCheck[]): string {
  const m = new Set(checks.filter((c) => c.passed).map((c) => c.method));
  return [m.has("cas_sympy") ? "maths checked by SymPy" : "", m.has("llm_review") ? "reviewed independently" : ""].filter(Boolean).join(", ");
}

/** Split a raw working line around its marked part, then prettify each piece (display only). */
function segments(text: string, mark: string | undefined, format: "plain" | "latex"): WorkingSegment[] {
  const show = (t: string) => (format === "plain" ? prettyWorking(t) : t);
  const i = mark ? text.indexOf(mark) : -1;
  if (!mark || i < 0) return [{ text: show(text) }];
  return [
    ...(i > 0 ? [{ text: show(text.slice(0, i)) }] : []),
    { text: show(mark), marked: true },
    ...(i + mark.length < text.length ? [{ text: show(text.slice(i + mark.length)) }] : []),
  ];
}

function recapLesson(r: MistakeRecap): RecapLesson {
  return {
    mode: r.mode,
    wrong: {
      format: r.wrong.format,
      lines: r.wrong.lines.map((l) => ({ segments: segments(l.text, l.mark, r.wrong.format), wrong: l.wrong })),
      note: r.wrong.note,
    },
    fix: r.fix.lines.map((l) => ({ text: l.text, ...(l.note ? { note: l.note } : {}) })),
    key_idea: r.key_idea,
    checked: checkedWords(r.verification.checks),
  };
}

function lessonFor(record: ErrorRecord): { lesson?: RecapLesson } {
  const r = recapFor(getLessons(), record);
  return r ? { lesson: recapLesson(r) } : {};
}

function explainerLesson(ctx: Ctx, e: StepExplainer, yours: boolean): ExplainerLesson {
  return {
    misconception_id: e.misconception_id,
    description: ctx.graph.misconceptions.get(e.misconception_id)?.description ?? "",
    yours,
    title: e.title,
    steps: e.steps.map((s) => ({ kind: s.kind, say: s.say, ...(s.math ? { math: s.math } : {}) })),
    takeaway: e.takeaway,
    checked: checkedWords(e.verification.checks),
  };
}

function feedbackView(ctx: Ctx, questionId: string, given: string): FeedbackView | undefined {
  const q = ctx.bank.byId.get(questionId);
  if (!q) return undefined;
  const g = gradeAnswer(q, given);
  let misconception: FeedbackView["misconception"];
  if (g.revealed_misconception_id) {
    const m = ctx.graph.misconceptions.get(g.revealed_misconception_id);
    const rec = ctx.records.find((r) => r.misconception?.misconception_id === g.revealed_misconception_id);
    misconception = {
      id: g.revealed_misconception_id,
      description: m?.description ?? "",
      ...(rec ? { yours: { exam_name: rec.exam.name, question_ref: rec.question.ref } } : {}),
    };
  }
  return {
    correct: g.correct,
    chosen: given,
    feedback: g.feedback,
    ...(g.correct_option_id ? { correct_option_id: g.correct_option_id } : {}),
    ...(g.correct_display ? { correct_display: g.correct_display } : {}),
    ...(misconception ? { misconception } : {}),
    solution: q.solution,
  };
}

function resultView(ctx: Ctx, r: MissionResultJson, after: Readiness, before?: Readiness, next?: PlannedMission): ResultView {
  const ripple = r.outcomes.find((o) => o.root_mastered);
  return {
    passed: r.outcomes.every((o) => o.outcome.passed),
    outcomes: r.outcomes.map((o) => ({
      concept_id: o.concept_id,
      concept_name: name(ctx.graph, o.concept_id),
      passed: o.outcome.passed,
      correct: o.outcome.correct,
      total: o.outcome.total,
      reason: o.outcome.reason,
      before: o.before,
      after: o.after,
      root_mastered: o.root_mastered,
    })),
    ...(before ? { readiness_before: before.now } : {}),
    readiness_after: after.now,
    ...(ripple ? { ripple_root: ripple.concept_id } : {}),
    ...(next ? { next: card(ctx, next) } : {}),
  };
}

function evidence(r: ErrorRecord): RecapEvidence {
  return {
    record_id: r.id,
    exam_name: r.exam.name,
    question_ref: r.question.ref,
    ...(r.question.text ? { question_text: r.question.text } : {}),
    diagnosis: r.diagnosis.text,
    ...(r.student_working ? { working: r.student_working.text } : {}),
    ...(r.diagnosis.correct_approach ? { correct_approach: r.diagnosis.correct_approach } : {}),
    ...(r.marks?.lost !== undefined ? { marks_lost: r.marks.lost } : r.marks?.awarded !== undefined && r.marks.max !== undefined ? { marks_lost: r.marks.max - r.marks.awarded } : {}),
    ...(r.marks?.max !== undefined ? { marks_max: r.marks.max } : r.question.max_marks !== undefined ? { marks_max: r.question.max_marks } : {}),
    ...lessonFor(r),
  };
}

/** Every recap for the student's records (newest exam first, own working first) and every explainer for their misconceptions. */
export function getReplays(studentId: string): ReplaysData | undefined {
  const ctx = studentContext(studentId);
  if (!ctx) return undefined;
  const recaps = ctx.records
    .map(evidence)
    .filter((e): e is RecapEvidence & { lesson: RecapLesson } => !!e.lesson)
    .map((e, i) => ({ e, i, date: ctx.records.find((r) => r.id === e.record_id)!.exam.date }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.i - b.i)
    .map((x) => x.e);
  const own = new Set(ownMisconceptions(ctx.records));
  const explainers = [...own].sort().flatMap((id) => {
    const e = getLessons().explainers.get(id);
    return e ? [explainerLesson(ctx, e, true)] : [];
  });
  return { student_id: studentId, recaps, explainers };
}

export function getMissionData(studentId: string, missionId: string): MissionData | undefined {
  const ctx = studentContext(studentId);
  const settings = getPlanSettings(db(), studentId);
  if (!ctx || !settings) return undefined;
  const view = getMission(db(), ctx, missionId);
  if (!view) return undefined;
  const m = view.mission;
  const recordById = new Map(ctx.records.map((r) => [r.id, r]));
  const recap = m.record_ids
    .map((id) => recordById.get(id))
    .filter((r) => r !== undefined)
    .map(evidence)
    // The animated recap leads with a mistake that has one: the student's own quoted working first.
    .map((e, i) => ({ e, i, rank: e.lesson ? (e.lesson.mode === "student_working" ? 0 : 1) : 2 }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.e);
  const own = new Set(ownMisconceptions(ctx.records));
  const concept = m.concept_id && ctx.graph.has(m.concept_id) ? ctx.graph.get(m.concept_id) : undefined;
  const explainer = concept
    ? {
        concept_name: concept.name,
        chapter: concept.chapter,
        class: concept.class,
        ...(m.root_id && m.root_id !== concept.id ? { root_name: name(ctx.graph, m.root_id) } : {}),
        watch_for: m.misconception_ids
          .map((id) => ctx.graph.misconceptions.get(id))
          .filter((x) => x !== undefined)
          .slice(0, 4)
          .map((x) => ({ id: x.id, description: x.description, yours: own.has(x.id) })),
        lessons: [...m.misconception_ids]
          .sort((a, b) => Number(own.has(b)) - Number(own.has(a)))
          .map((id) => getLessons().explainers.get(id))
          .filter((x) => x !== undefined)
          .map((x) => explainerLesson(ctx, x, own.has(x.misconception_id))),
      }
    : null;
  let result: ResultView | undefined;
  if (view.result) {
    const plan = getPlan(db(), ctx, studentToday(studentId))!;
    result = resultView(ctx, view.result, getReadiness(db(), ctx, settings.exam_date, targeted(plan)), undefined, nextMission(plan));
  }
  return {
    id: view.id,
    student_id: studentId,
    date: view.date,
    status: view.status,
    card: card(ctx, m),
    recap,
    explainer,
    questions: view.questions.map((q) => ({
      id: q.question.id,
      kind: q.question.kind,
      stem: q.question.stem,
      ...(q.question.options ? { options: q.question.options.map((o) => ({ id: o.id, text: o.text })) } : {}),
      ...(q.question.answer?.unit ? { unit: q.question.answer.unit } : {}),
      concept_name: name(ctx.graph, q.concept_id),
      ...(q.answer ? { answered: feedbackView(ctx, q.question.id, q.answer.given)! } : {}),
    })),
    ...(result ? { result } : {}),
  };
}

// ---------------------------------------------------------------- writes

export function savePlan(studentId: string, input: { exam_name: string; exam_date: string; daily_minutes: number }): boolean {
  const ctx = studentContext(studentId);
  if (!ctx) return false;
  const today = studentToday(studentId);
  const existing = getPlanSettings(db(), studentId);
  savePlanSettings(db(), studentId, { ...input, start_date: existing?.start_date ?? today });
  return true;
}

export function startMissionFor(studentId: string, key: string): string | undefined {
  const ctx = studentContext(studentId);
  if (!ctx) return undefined;
  return startMission(db(), ctx, studentToday(studentId), key);
}

export function answer(studentId: string, missionId: string, questionId: string, given: string): FeedbackView | { error: string } {
  const ctx = studentContext(studentId);
  if (!ctx) return { error: "not_found" };
  const r = answerQuestion(db(), ctx, missionId, questionId, given);
  if (typeof r === "string") return { error: r };
  return feedbackView(ctx, questionId, given)!;
}

export function finish(studentId: string, missionId: string): ResultView | { error: string } {
  const ctx = studentContext(studentId);
  const settings = getPlanSettings(db(), studentId);
  if (!ctx || !settings) return { error: "not_found" };
  const today = studentToday(studentId);
  const planBefore = getPlan(db(), ctx, today)!;
  const before = getReadiness(db(), ctx, settings.exam_date, targeted(planBefore));
  const r = finishMission(db(), ctx, missionId);
  if (typeof r === "string") return { error: r };
  const plan = getPlan(db(), ctx, today)!;
  const after = getReadiness(db(), ctx, settings.exam_date, targeted(plan));
  return resultView(ctx, r, after, before, nextMission(plan));
}

/** SAMPLE DATA demo: move the student's clock one day forward (shows the plan re-flowing). */
export function demoNextDay(studentId: string): boolean {
  const s = getPlanSettings(db(), studentId);
  if (!s || !isSample(studentId)) return false;
  setDemoDayOffset(db(), studentId, s.demo_day_offset + 1);
  return true;
}

export function demoResetPlan(studentId: string): boolean {
  if (!isSample(studentId)) return false;
  resetPlan(db(), studentId);
  return true;
}

