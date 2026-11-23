/**
 * What the MCP tools return, built from the same service, mission engine and
 * database as the web app. Thin: the logic lives in @progresso/core (plan,
 * mastery gate, FSRS, readiness) and @progresso/db (the mission service).
 *
 * Nothing here calls an LLM: inside Claude, the student's own Claude does the
 * conversational thinking; this server returns grounded data and UI.
 */
import {
  daysBetween,
  gradeAnswer,
  nextMission,
  recapFor,
  type ComebackPlan,
  type ConceptGraph,
  type ErrorRecord,
  type GradedAnswer,
  type MistakeRecap,
  type PlannedMission,
  type Readiness,
  type RootFinding,
} from "@progresso/core";
import {
  answerQuestion,
  finishMission,
  getConceptProgress,
  getMission,
  getPlan,
  getPlanSettings,
  getReadiness,
  liveMisconceptions,
  ownMisconceptions,
  savePlanSettings,
  startMission,
  type MissionResultJson,
  type MissionView,
} from "@progresso/db";
import { constellation, db, isSample, store, studentContext, studentToday, type Ctx } from "@progresso/service";
import { rich, workingHtml } from "./math";
import type {
  AnswerData,
  ExamInfo,
  ExplainerInfo,
  FeedbackView,
  Links,
  MissionInfo,
  MissionWidgetData,
  ProgressData,
  QuestionView,
  RecapPreview,
  ResultInfo,
  RootInfo,
  RootProgress,
  SkyData,
  StarCode,
} from "./shared/types";

export class ToolError extends Error {
  override name = "ToolError";
}

/** Where the web app runs, for links out of Claude ("watch the explainer", "see your constellation"). */
export function webUrl(): string {
  return (process.env.PROGRESSO_WEB_URL || "http://localhost:3100").replace(/\/+$/, "");
}

export function links(studentId: string, missionId?: string): Links {
  const s = `${webUrl()}/s/${encodeURIComponent(studentId)}`;
  return {
    today: `${s}/today`,
    constellation: `${s}/constellation`,
    ...(missionId ? { mission: `${s}/mission/${encodeURIComponent(missionId)}` } : {}),
  };
}

function context(studentId: string): Ctx {
  const ctx = studentContext(studentId);
  if (!ctx) throw new ToolError(`Unknown student "${studentId}".`);
  return ctx;
}

const name = (graph: ConceptGraph, id: string | undefined): string => (id && graph.has(id) ? graph.get(id).name : (id ?? ""));

const STEP_LABEL = { recap: "Mistake Recap", explainer: "Explainer", prove_it: "Prove it" } as const;

function title(graph: ConceptGraph, m: PlannedMission): { title: string; subtitle: string } {
  const concept = name(graph, m.concept_id);
  const reviews = m.review_concepts.map((c) => name(graph, c));
  switch (m.kind) {
    case "learn":
      return {
        title: m.root_id ? `Fix the root: ${concept}` : `Fix a one-off gap: ${concept}`,
        subtitle: m.attempt > m.planned_attempts ? "One more go at the check" : m.planned_attempts > 1 ? `Part ${m.attempt} of ${m.planned_attempts}` : "One mission",
      };
    case "apply":
      return { title: `${name(graph, m.root_id)} in ${concept}`, subtitle: m.attempt > 1 ? "One more go at the check" : "Use the fixed root where your mistake was" };
    case "review":
      return { title: reviews.length === 1 ? `Quick review: ${reviews[0]}` : `Quick review: ${reviews.length} topics`, subtitle: "Spaced so it holds until the exam" };
    case "rehearsal":
      return { title: "Exam rehearsal", subtitle: "Mixed check across what you've fixed" };
  }
}

function targeted(plan: ComebackPlan): string[] {
  return [...new Set(plan.days.flatMap((d) => d.missions.map((m) => m.concept_id)).filter((c): c is string => !!c).concat(plan.unscheduled.map((u) => u.concept_id)))];
}

function range(r: Readiness["now"]): { low: number; mid: number; high: number } {
  return { low: r.low, mid: r.mid, high: r.high };
}

// ---------------------------------------------------------------- plan

export interface PlanState {
  ctx: Ctx;
  today: string;
  exam: ExamInfo;
  plan: ComebackPlan;
  created: boolean;
}

/**
 * The student's plan, set up with the defaults the web app offers (next exam,
 * 25 minutes a day) if they haven't made one yet. Undefined when there is no
 * exam date to plan back from.
 */
export function planState(studentId: string, opts: { create: boolean }): PlanState | undefined {
  const ctx = context(studentId);
  const d = db();
  let settings = getPlanSettings(d, studentId);
  let created = false;
  const today = studentToday(studentId);
  if (!settings && opts.create && ctx.next_exam?.date && ctx.next_exam.date > today) {
    savePlanSettings(d, studentId, { exam_name: ctx.next_exam.name, exam_date: ctx.next_exam.date, daily_minutes: 25, start_date: today });
    settings = getPlanSettings(d, studentId);
    created = true;
  }
  if (!settings) return undefined;
  const plan = getPlan(d, ctx, today)!;
  return { ctx, today, plan, created, exam: { name: settings.exam_name, date: settings.exam_date, days_left: daysBetween(today, settings.exam_date) } };
}

// ---------------------------------------------------------------- pieces

function rootInfo(ctx: Ctx, m: PlannedMission): RootInfo | undefined {
  const rootId = m.root_id ?? (m.concept_id && ctx.analysis.roots.some((r) => r.concept.id === m.concept_id) ? m.concept_id : undefined);
  const r = ctx.analysis.roots.find((x) => x.concept.id === rootId);
  if (!r) return undefined;
  const c = ctx.graph.has(r.concept.id) ? ctx.graph.get(r.concept.id) : undefined;
  return {
    concept_id: r.concept.id,
    name: r.concept.name,
    ...(c ? { chapter: c.chapter, class: c.class } : {}),
    rank: r.rank,
    roots_total: ctx.analysis.roots.length,
    explanation: r.explanation,
    errors_explained: r.explains.length,
    exams: r.exam_ids.length,
    marks_lost: round1(r.marks.lost),
    marks_estimated: r.marks.estimated_part > 0,
    ...(m.kind === "apply" && m.concept_id && m.concept_id !== r.concept.id ? { via: name(ctx.graph, m.concept_id) } : {}),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function marks(r: ErrorRecord): { marks_lost?: number; marks_max?: number } {
  const lost = r.marks?.lost ?? (r.marks?.awarded !== undefined && r.marks?.max !== undefined ? r.marks.max - r.marks.awarded : undefined);
  const max = r.marks?.max ?? r.question.max_marks;
  return { ...(lost !== undefined ? { marks_lost: lost } : {}), ...(max !== undefined ? { marks_max: max } : {}) };
}

function recapPreview(ctx: Ctx, m: PlannedMission): RecapPreview | undefined {
  const lessons = store().lessons;
  const byId = new Map(ctx.records.map((r) => [r.id, r]));
  const recs = m.record_ids.map((id) => byId.get(id)).filter((r): r is ErrorRecord => r !== undefined);
  if (recs.length === 0) return undefined;
  // Lead with the student's own quoted working, then a typical step, then the report alone (as the web player does).
  const ranked = recs
    .map((r, i) => ({ r, i, lesson: recapFor(lessons, r) }))
    .sort((a, b) => rank(a.lesson) - rank(b.lesson) || a.i - b.i);
  const { r, lesson } = ranked[0]!;
  return {
    record_id: r.id,
    exam_name: r.exam.name,
    question_ref: r.question.ref,
    ...(r.question.text ? { question: rich(r.question.text) } : {}),
    ...marks(r),
    diagnosis: r.diagnosis.text,
    mode: lesson ? lesson.mode : "report_only",
    ...(lesson ? lessonParts(lesson) : {}),
    more: recs.length - 1,
  };
}

const rank = (l: MistakeRecap | undefined) => (l ? (l.mode === "student_working" ? 0 : 1) : 2);

function lessonParts(l: MistakeRecap): Pick<RecapPreview, "wrong" | "fix" | "key_idea"> {
  return {
    wrong: {
      format: l.wrong.format,
      lines: l.wrong.lines.map((line) => {
        const i = line.mark ? line.text.indexOf(line.mark) : -1;
        const segs =
          i < 0 || !line.mark
            ? [{ html: workingHtml(line.text, l.wrong.format) }]
            : [
                ...(i > 0 ? [{ html: workingHtml(line.text.slice(0, i), l.wrong.format) }] : []),
                { html: workingHtml(line.mark, l.wrong.format), marked: true },
                ...(i + line.mark.length < line.text.length ? [{ html: workingHtml(line.text.slice(i + line.mark.length), l.wrong.format) }] : []),
              ];
        return { segments: segs, wrong: line.wrong };
      }),
      note: rich(l.wrong.note),
    },
    fix: l.fix.lines.map((f) => rich(f.text)),
    key_idea: rich(l.key_idea),
  };
}

function explainerInfo(ctx: Ctx, m: PlannedMission): ExplainerInfo {
  const own = new Set(ownMisconceptions(ctx.records));
  const ids = [...m.misconception_ids].sort((a, b) => Number(own.has(b)) - Number(own.has(a)));
  const { lessons, videos } = store();
  const vid = ids.map((id) => videos.passing.get(id)).find((v) => v !== undefined);
  const exp = ids.map((id) => lessons.explainers.get(id)).find((e) => e !== undefined);
  const base = webUrl();
  return {
    ...(vid
      ? {
          video: {
            title: vid.title,
            url: `${base}/media/videos/${encodeURIComponent(vid.misconception_id)}/video.mp4`,
            poster: `${base}/media/videos/${encodeURIComponent(vid.misconception_id)}/poster.jpg`,
            duration_s: Math.round(vid.duration_s ?? 0),
          },
        }
      : {}),
    ...(exp ? { steps: { title: exp.title, takeaway: rich(exp.takeaway), count: exp.steps.length } } : {}),
    watch_for: ids
      .map((id) => ctx.graph.misconceptions.get(id))
      .filter((x) => x !== undefined)
      .slice(0, 3)
      .map((x) => ({ description: x.description, yours: own.has(x.id) })),
  };
}

export function feedback(ctx: Ctx, questionId: string, given: string, graded?: GradedAnswer): FeedbackView | undefined {
  const q = ctx.bank.byId.get(questionId);
  if (!q) return undefined;
  const g = graded ?? gradeAnswer(q, given);
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
    feedback: rich(g.feedback),
    ...(g.correct_option_id ? { correct_option_id: g.correct_option_id } : {}),
    ...(g.correct_display ? { correct_display: rich(g.correct_display) } : {}),
    ...(misconception ? { misconception } : {}),
    solution: rich(q.solution),
  };
}

function questions(ctx: Ctx, view: MissionView): QuestionView[] {
  return view.questions.map((q) => ({
    id: q.question.id,
    kind: q.question.kind,
    stem: rich(q.question.stem),
    // Options without `correct`, `misconception_id` or feedback: the answer key stays on the server.
    ...(q.question.options ? { options: q.question.options.map((o) => ({ id: o.id, label: rich(o.text) })) } : {}),
    ...(q.question.answer?.unit ? { unit: q.question.answer.unit } : {}),
    concept_name: name(ctx.graph, q.concept_id),
    ...(q.answer ? { answered: feedback(ctx, q.question.id, q.answer.given, q.answer.graded)! } : {}),
  }));
}

function resultInfo(ctx: Ctx, r: MissionResultJson, after: Readiness, before?: Readiness): ResultInfo {
  const ripple = r.outcomes.find((o) => o.root_mastered);
  return {
    passed: r.outcomes.every((o) => o.outcome.passed),
    outcomes: r.outcomes.map((o) => ({
      concept_name: name(ctx.graph, o.concept_id),
      passed: o.outcome.passed,
      correct: o.outcome.correct,
      total: o.outcome.total,
      reason: o.outcome.reason,
      before: o.before,
      after: o.after,
      root_mastered: o.root_mastered,
    })),
    ...(before ? { readiness_before: range(before.now) } : {}),
    readiness_after: range(after.now),
    ...(ripple ? { ripple_root: name(ctx.graph, ripple.concept_id) } : {}),
  };
}

function missionInfo(ctx: Ctx, view: MissionView, index: number, of: number): MissionInfo {
  const m = view.mission;
  return {
    id: view.id,
    kind: m.kind,
    ...title(ctx.graph, m),
    minutes: m.minutes,
    reason: m.reason,
    status: view.status,
    steps: m.steps.map((s) => ({ kind: s.kind, label: STEP_LABEL[s.kind], minutes: s.minutes })),
    index,
    of,
  };
}

function missionWidget(ps: PlanState, view: MissionView, index: number, of: number): MissionWidgetData {
  const { ctx, plan } = ps;
  const m = view.mission;
  const next = nextMission(plan);
  let result: ResultInfo | undefined;
  if (view.result) result = resultInfo(ctx, view.result, getReadiness(db(), ctx, ps.exam.date, targeted(plan)));
  const root = rootInfo(ctx, m);
  const recap = recapPreview(ctx, m);
  return {
    view: "mission",
    student_id: ctx.student_id,
    sample: isSample(ctx.student_id),
    today: ps.today,
    exam: ps.exam,
    state: "ready",
    ...(ps.created ? { plan_created: true } : {}),
    mission: missionInfo(ctx, view, index, of),
    ...(root ? { root } : {}),
    ...(recap ? { recap } : {}),
    explainer: explainerInfo(ctx, m),
    questions: questions(ctx, view),
    ...(result ? { result } : {}),
    ...(next && next.key !== m.key ? { next: { title: title(ctx.graph, next).title, date: next.date } } : {}),
    links: links(ctx.student_id, view.id),
  };
}

// ---------------------------------------------------------------- tools

/**
 * Tonight's mission: starts (or resumes) the first of today's missions that
 * isn't finished, so its prove-it questions are fixed and shared with the web
 * app. When everything is done, shows the last finished one with its result.
 */
export function tonight(studentId: string, missionId?: string): MissionWidgetData {
  const ps = planState(studentId, { create: true });
  const base = { view: "mission" as const, student_id: studentId, sample: isSample(studentId), questions: [], links: links(studentId) };
  if (!ps) return { ...base, today: studentToday(studentId), state: "no_plan" };
  const d = db();
  const todays = ps.plan.days.find((x) => x.date === ps.today)?.missions ?? [];

  if (missionId) {
    const view = getMission(d, ps.ctx, missionId);
    if (!view) throw new ToolError(`No mission "${missionId}" for this student.`);
    const i = todays.findIndex((x) => x.stored_id === missionId);
    return missionWidget(ps, view, i >= 0 ? i + 1 : 1, Math.max(1, todays.length));
  }

  const open = todays.findIndex((x) => x.status === "today");
  if (open >= 0) {
    const id = startMission(d, ps.ctx, ps.today, todays[open]!.key);
    if (!id) throw new ToolError("Could not start tonight's mission.");
    return missionWidget(ps, getMission(d, ps.ctx, id)!, open + 1, todays.length);
  }
  const done = todays.map((x, i) => ({ x, i })).filter(({ x }) => x.status === "done" && x.stored_id);
  const next = nextMission(ps.plan);
  if (done.length > 0) {
    const last = done[done.length - 1]!;
    const w = missionWidget(ps, getMission(d, ps.ctx, last.x.stored_id!)!, last.i + 1, todays.length);
    return { ...w, state: "done_today" };
  }
  return {
    ...base,
    today: ps.today,
    exam: ps.exam,
    state: "nothing_today",
    ...(ps.created ? { plan_created: true } : {}),
    ...(next ? { next: { title: title(ps.ctx.graph, next).title, date: next.date } } : {}),
  };
}

/** Record one answer; when it completes the check, finish the mission (mastery gate + FSRS, writes concept_mastery). */
export function submit(studentId: string, missionId: string, questionId: string, answer: string): AnswerData {
  const ps = planState(studentId, { create: false });
  if (!ps) throw new ToolError("This student has no plan yet. Call get_tonight_mission first.");
  const d = db();
  // Option letters are case-insensitive ("B" or "b"); numbers pass through.
  const q = ps.ctx.bank.byId.get(questionId);
  const given = q?.kind === "mcq" ? (q.options?.find((o) => o.id.toLowerCase() === answer.trim().toLowerCase())?.id ?? answer.trim()) : answer.trim();
  const r = answerQuestion(d, ps.ctx, missionId, questionId, given);
  if (r === "not_found") throw new ToolError(`Question "${questionId}" is not part of mission "${missionId}".`);
  if (r === "finished") throw new ToolError("That mission is already finished.");
  if (r === "unreadable") throw new ToolError(`"${answer}" isn't a number. Answer with a number, e.g. 12 or -0.5.`);
  const view = getMission(d, ps.ctx, missionId)!;
  const answered = view.questions.filter((q) => q.answer).length;
  let result: ResultInfo | undefined;
  if (answered === view.questions.length && view.status !== "completed") result = finish(studentId, missionId, ps);
  return {
    view: "answer",
    student_id: studentId,
    mission_id: missionId,
    question_id: questionId,
    feedback: feedback(ps.ctx, questionId, given, r)!,
    answered,
    total: view.questions.length,
    ...(result ? { result } : {}),
    links: links(studentId, missionId),
  };
}

/** Finish a mission (all questions answered, or a mission with no questions yet: "studied, not proven"). */
export function finish(studentId: string, missionId: string, given?: PlanState): ResultInfo {
  const ps = given ?? planState(studentId, { create: false });
  if (!ps) throw new ToolError("This student has no plan yet. Call get_tonight_mission first.");
  const d = db();
  // Already finished: return the stored result (no "before", it would be the same as "after").
  const already = getMission(d, ps.ctx, missionId)?.status === "completed";
  const before = already ? undefined : getReadiness(d, ps.ctx, ps.exam.date, targeted(ps.plan));
  const r = finishMission(d, ps.ctx, missionId);
  if (r === "not_found") throw new ToolError(`No mission "${missionId}" for this student.`);
  if (r === "unanswered") throw new ToolError("Some prove-it questions are still unanswered. Answer them with submit_answer first.");
  const plan = getPlan(d, ps.ctx, ps.today)!;
  return resultInfo(ps.ctx, r, getReadiness(d, ps.ctx, ps.exam.date, targeted(plan)), before);
}

const STAR: Record<string, StarCode> = { unassessed: 0, weak: 1, root: 2, learning: 3, mastered: 4 };

function sky(studentId: string): SkyData {
  const model = constellation(studentId)!;
  const { minX, maxX, minY, maxY } = model.bounds;
  const pad = 0.04;
  const w = 1000;
  const h = Math.round((w * (maxY - minY)) / Math.max(1e-9, maxX - minX));
  const sx = (x: number) => Math.round(((x - minX) / (maxX - minX)) * w * (1 - 2 * pad) + w * pad);
  const sy = (y: number) => Math.round(((y - minY) / (maxY - minY)) * h * (1 - 2 * pad) + h * pad);
  const rootIds = new Set(model.roots.map((r) => r.id));
  const roots: Record<string, number> = {};
  const nodes = model.nodes.map((n, i) => {
    if (rootIds.has(n.id)) roots[n.id] = i;
    const flags = (n.lit ? 1 : 0) | (n.on_chain ? 2 : 0) | (rootIds.has(n.id) ? 4 : 0);
    return [sx(n.x), sy(n.y), STAR[n.state] ?? 0, flags] as [number, number, StarCode, number];
  });
  return { w, h, nodes, edges: model.edges.map((e) => [e.from, e.to, e.chain ? 1 : 0]), roots };
}

export function progress(studentId: string): ProgressData {
  const ctx = context(studentId);
  const ps = planState(studentId, { create: false });
  const d = db();
  const today = ps?.today ?? studentToday(studentId);
  const examDate = ps?.exam.date ?? ctx.next_exam?.date ?? today;
  const readiness = getReadiness(d, ctx, examDate, ps ? targeted(ps.plan) : undefined);
  const cp = getConceptProgress(d, studentId);
  const model = constellation(studentId)!;
  const downstream = new Map(model.roots.map((r) => [r.id, r.downstream_count]));
  const roots: RootProgress[] = ctx.analysis.roots.map((r: RootFinding) => ({
    id: r.concept.id,
    name: r.concept.name,
    rank: r.rank,
    state: cp[r.concept.id]?.state ?? "gap",
    errors_explained: r.explains.length,
    marks_lost: round1(r.marks.lost),
    downstream: downstream.get(r.concept.id) ?? 0,
  }));
  const still = [...liveMisconceptions(d, ctx).values()]
    .filter((s) => s.alive && s.source === "check")
    .map((s) => {
      const m = ctx.graph.misconceptions.get(s.id);
      return { description: m?.description ?? s.id, concept: name(ctx.graph, m?.concept_id) };
    });
  return {
    view: "progress",
    student_id: studentId,
    sample: isSample(studentId),
    today,
    ...(ps ? { exam: ps.exam } : ctx.next_exam ? { exam: { ...ctx.next_exam, days_left: daysBetween(today, ctx.next_exam.date) } } : {}),
    has_plan: !!ps,
    roots,
    roots_fixed: roots.filter((r) => r.state === "proven" || r.state === "retained").length,
    readiness: { label: "Estimate", start: range(readiness.start), now: range(readiness.now), potential: range(readiness.potential) },
    missions_done: ps?.plan.totals.learning_done ?? 0,
    concepts_proven: ps?.plan.totals.concepts_proven ?? 0,
    concepts_targeted: ps?.plan.totals.concepts_targeted ?? 0,
    still_making: still,
    sky: sky(studentId),
    links: links(studentId),
  };
}

