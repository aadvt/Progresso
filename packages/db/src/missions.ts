/**
 * The mission service: plan settings, progress, starting and finishing
 * missions, answering prove-it questions. Shared by the web app, the
 * simulation CLI and (Phase 10) the MCP server.
 *
 * What is stored:
 *  - plan_settings: exam, daily minutes, start day.
 *  - missions: only missions that were started (their questions stay fixed);
 *    the rest of the plan is a projection recomputed from progress every time.
 *  - question_attempts: every answer, with the misconception it revealed.
 *  - review_log: one row per check (FSRS rating), concept_mastery: state + FSRS card.
 * Writing concept_mastery is what updates the constellation (and its ripple).
 */
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import {
  applyCheck,
  buildPlan,
  computeReadiness,
  eventsFromAnswers,
  gradeAnswer,
  gradeCheck,
  isMastered,
  misconceptionStatus,
  parseNumber,
  selectQuestions,
  DEFAULT_MISSION_PARAMS,
  type CheckOutcome,
  type ComebackPlan,
  type ConceptGraph,
  type ConceptProgress,
  type ErrorRecord,
  type GradedAnswer,
  type IsoDay,
  type MasteryLevel,
  type MisconceptionEvent,
  type MissionKind,
  type MissionParams,
  type MissionRecord,
  type PlannedMission,
  type PlanSettings,
  type ProgressState,
  type ProveItQuestion,
  type QuestionBank,
  type Readiness,
  type RootCauseAnalysis,
  type SerializedCard,
} from "@progresso/core";
import type { Db } from "./client";
import { conceptMastery, missions, planSettings, questionAttempts, reviewLog } from "./schema";

export interface StudentContext {
  student_id: string;
  graph: ConceptGraph;
  analysis: RootCauseAnalysis;
  records: readonly ErrorRecord[];
  bank: QuestionBank;
  params?: Partial<MissionParams>;
}

const paramsOf = (ctx: StudentContext): MissionParams => ({ ...DEFAULT_MISSION_PARAMS, ...ctx.params });

// ---------------------------------------------------------------- settings

export interface StoredPlanSettings extends PlanSettings {
  demo_day_offset: number;
}

export function getPlanSettings(db: Db, studentId: string): StoredPlanSettings | undefined {
  const row = db.select().from(planSettings).where(eq(planSettings.studentId, studentId)).get();
  if (!row) return undefined;
  return {
    exam_name: row.examName,
    exam_date: row.examDate,
    daily_minutes: row.dailyMinutes,
    start_date: row.startDate,
    demo_day_offset: row.demoDayOffset,
  };
}

export function savePlanSettings(db: Db, studentId: string, s: PlanSettings): void {
  const values = { examName: s.exam_name, examDate: s.exam_date, dailyMinutes: s.daily_minutes, startDate: s.start_date, updatedAt: new Date().toISOString() };
  db.insert(planSettings)
    .values({ studentId, ...values })
    .onConflictDoUpdate({ target: planSettings.studentId, set: values })
    .run();
}

export function setDemoDayOffset(db: Db, studentId: string, offset: number): void {
  db.update(planSettings).set({ demoDayOffset: offset }).where(eq(planSettings.studentId, studentId)).run();
}

/** Forget the plan and everything done in it (demo reset). Mastery is cleared too. */
export function resetPlan(db: Db, studentId: string): void {
  db.transaction((tx) => {
    tx.delete(questionAttempts).where(eq(questionAttempts.studentId, studentId)).run();
    tx.delete(reviewLog).where(eq(reviewLog.studentId, studentId)).run();
    tx.delete(missions).where(eq(missions.studentId, studentId)).run();
    tx.delete(conceptMastery).where(eq(conceptMastery.studentId, studentId)).run();
    tx.delete(planSettings).where(eq(planSettings.studentId, studentId)).run();
  });
}

// ---------------------------------------------------------------- progress

export function getConceptProgress(db: Db, studentId: string): Record<string, ConceptProgress> {
  const out: Record<string, ConceptProgress> = {};
  for (const r of db.select().from(conceptMastery).where(eq(conceptMastery.studentId, studentId)).all()) {
    const card = (r.card ?? undefined) as SerializedCard | undefined;
    out[r.conceptId] = {
      state: r.state,
      ...(r.dueAt ? { due: r.dueAt } : {}),
      ...(r.stability !== null ? { stability: r.stability } : {}),
      ...(card ? { card } : {}),
      ...(r.provenAt ? { proven_at: r.provenAt } : {}),
    };
  }
  return out;
}

export function saveConceptProgress(db: Db, studentId: string, conceptId: string, p: ConceptProgress, at: string): void {
  const values = {
    state: p.state,
    stability: p.card?.stability ?? null,
    difficulty: p.card?.difficulty ?? null,
    reps: p.card?.reps ?? 0,
    lapses: p.card?.lapses ?? 0,
    lastReviewAt: p.card?.last_review ?? null,
    dueAt: p.due ?? null,
    card: p.card ?? null,
    provenAt: p.proven_at ?? null,
    updatedAt: at,
  };
  db.insert(conceptMastery)
    .values({ studentId, conceptId, ...values })
    .onConflictDoUpdate({ target: [conceptMastery.studentId, conceptMastery.conceptId], set: values })
    .run();
}

/** Missions left unfinished on a past day become "skipped": the plan re-flows around them. */
export function markStaleMissions(db: Db, studentId: string, today: IsoDay): number {
  return db
    .update(missions)
    .set({ status: "skipped" })
    .where(and(eq(missions.studentId, studentId), lt(missions.scheduledFor, today), inArray(missions.status, ["planned", "in_progress"])))
    .run().changes;
}

interface StoredPlan {
  mission: PlannedMission;
  questions: { id: string; concept_id: string }[];
}

export function getProgress(db: Db, studentId: string): ProgressState {
  const history: MissionRecord[] = [];
  for (const m of db.select().from(missions).where(eq(missions.studentId, studentId)).orderBy(asc(missions.scheduledFor), asc(missions.slot)).all()) {
    if (m.status !== "completed" && m.status !== "skipped") continue;
    const plan = m.plan as StoredPlan | null;
    const result = m.result as MissionResultJson | null;
    history.push({
      key: m.workKey ?? m.id,
      kind: (m.kind ?? "learn") as MissionKind,
      date: m.scheduledFor,
      slot: m.slot,
      status: m.status,
      ...(m.targetConceptId ? { concept_id: m.targetConceptId } : {}),
      ...(plan?.mission.root_id ? { root_id: plan.mission.root_id } : {}),
      ...(plan?.mission.review_concepts.length ? { review_concepts: plan.mission.review_concepts } : {}),
      ...(result ? { passed: result.outcomes.every((o) => o.outcome.passed), checked: result.outcomes.some((o) => o.outcome.total > 0) } : {}),
      minutes: m.plannedMinutes,
    });
  }
  return { concepts: getConceptProgress(db, studentId), history };
}

export function misconceptionEvents(db: Db, studentId: string): MisconceptionEvent[] {
  const rows = db.select().from(questionAttempts).where(eq(questionAttempts.studentId, studentId)).orderBy(asc(questionAttempts.id)).all();
  return rows.flatMap((r) =>
    eventsFromAnswers(
      [
        {
          question_id: r.questionId,
          correct: r.correct,
          ...(r.targetMisconceptionId ? { target_misconception_id: r.targetMisconceptionId } : {}),
          ...(r.revealedMisconceptionId ? { revealed_misconception_id: r.revealedMisconceptionId } : {}),
        },
      ],
      r.answeredAt,
    ),
  );
}

/** The student's own misconceptions: those the report named in their mistakes. */
export function ownMisconceptions(records: readonly ErrorRecord[]): string[] {
  return [...new Set(records.map((r) => r.misconception?.misconception_id).filter((m): m is string => !!m))];
}

export function liveMisconceptions(db: Db, ctx: StudentContext) {
  return misconceptionStatus(ownMisconceptions(ctx.records), misconceptionEvents(db, ctx.student_id));
}

// ---------------------------------------------------------------- plan & readiness

export function getPlan(db: Db, ctx: StudentContext, today: IsoDay): ComebackPlan | undefined {
  const settings = getPlanSettings(db, ctx.student_id);
  if (!settings) return undefined;
  markStaleMissions(db, ctx.student_id, today);
  const progress = getProgress(db, ctx.student_id);
  const plan = buildPlan({
    student_id: ctx.student_id,
    graph: ctx.graph,
    analysis: ctx.analysis,
    records: ctx.records,
    settings,
    today,
    progress,
    ...(ctx.params ? { params: ctx.params } : {}),
  });
  // Today's started-but-unfinished missions show as in progress, with their stored id.
  const stored = db
    .select()
    .from(missions)
    .where(and(eq(missions.studentId, ctx.student_id), eq(missions.scheduledFor, today)))
    .all();
  const day = plan.days.find((d) => d.date === today);
  if (day) {
    for (const m of day.missions) {
      const s = stored.find((x) => x.workKey === m.key && x.status !== "skipped");
      if (s) m.stored_id = s.id;
    }
  }
  return plan;
}

export function getReadiness(db: Db, ctx: StudentContext, examDate: IsoDay, targeted?: readonly string[]): Readiness {
  return computeReadiness({
    graph: ctx.graph,
    analysis: ctx.analysis,
    records: ctx.records,
    progress: getProgress(db, ctx.student_id),
    exam_date: examDate,
    ...(targeted ? { targeted } : {}),
    ...(ctx.params ? { params: ctx.params } : {}),
  });
}

// ---------------------------------------------------------------- missions

export interface MissionQuestion {
  question: ProveItQuestion;
  /** The concept this question checks (reviews cover several concepts). */
  concept_id: string;
  answer?: { given: string; graded: GradedAnswer };
}

export interface MissionView {
  id: string;
  student_id: string;
  date: IsoDay;
  status: "planned" | "in_progress" | "completed" | "skipped";
  mission: PlannedMission;
  questions: MissionQuestion[];
  result?: MissionResultJson;
}

export interface ConceptOutcome {
  concept_id: string;
  outcome: CheckOutcome;
  before: MasteryLevel | "none";
  after: MasteryLevel;
  /** A root just went to proven: the constellation plays the chain reaction. */
  root_mastered: boolean;
}

export interface MissionResultJson {
  outcomes: ConceptOutcome[];
  finished_at: string;
}

function choose(ctx: StudentContext, db: Db, m: PlannedMission, date: IsoDay): { id: string; concept_id: string }[] {
  const params = paramsOf(ctx);
  const own = new Set(ownMisconceptions(ctx.records));
  const alive = new Set([...liveMisconceptions(db, ctx).values()].filter((s) => s.alive).map((s) => s.id));
  const seen = new Map<string, number>();
  for (const r of db.select({ q: questionAttempts.questionId }).from(questionAttempts).where(eq(questionAttempts.studentId, ctx.student_id)).all())
    seen.set(r.q, (seen.get(r.q) ?? 0) + 1);

  const conceptMisconceptions = (c: string) => (ctx.graph.has(c) ? ctx.graph.get(c).misconceptions.map((x) => x.id) : []);
  if (m.kind === "learn" || m.kind === "apply") {
    const picked = selectQuestions(ctx.bank, {
      concept_id: m.concept_id!,
      misconception_ids: m.misconception_ids,
      own,
      alive,
      seen,
      n: params.checkQuestions,
      seed: `${ctx.student_id}|${m.key}|${date}`,
    });
    return picked.map((q) => ({ id: q.id, concept_id: m.concept_id! }));
  }
  const per = Math.max(1, Math.min(params.reviewQuestions, Math.floor(8 / Math.max(1, m.review_concepts.length))));
  const out: { id: string; concept_id: string }[] = [];
  for (const c of m.review_concepts) {
    // A topic reached by applying a root is checked with the root's misconceptions too.
    const rootMis = ctx.analysis.roots.filter((r) => r.explains.some((e) => (e.tested?.id ?? e.anchor.id) === c)).flatMap((r) => conceptMisconceptions(r.concept.id));
    const picked = selectQuestions(ctx.bank, {
      concept_id: c,
      misconception_ids: [...conceptMisconceptions(c), ...rootMis],
      own,
      alive,
      seen,
      n: per,
      seed: `${ctx.student_id}|${m.key}|${c}`,
    }).filter((q) => !out.some((x) => x.id === q.id));
    out.push(...picked.map((q) => ({ id: q.id, concept_id: c })));
  }
  return out;
}

/**
 * Start (or resume) one of today's planned missions. Stores it with its
 * questions so they stay fixed; returns the stored mission id.
 */
export function startMission(db: Db, ctx: StudentContext, today: IsoDay, key: string): string | undefined {
  const plan = getPlan(db, ctx, today);
  const m = plan?.days.find((d) => d.date === today)?.missions.find((x) => x.key === key && (x.status === "today" || x.stored_id));
  if (!m) return undefined;
  if (m.stored_id) return m.stored_id;
  const taken = db
    .select({ slot: missions.slot })
    .from(missions)
    .where(and(eq(missions.studentId, ctx.student_id), eq(missions.scheduledFor, today)))
    .all()
    .map((r) => r.slot);
  let slot = m.slot;
  while (taken.includes(slot)) slot++;
  const id = `${ctx.student_id}:${today}:${slot}`;
  const questions = choose(ctx, db, m, today);
  const stored: StoredPlan = { mission: { ...m, slot, status: "today" }, questions };
  db.insert(missions)
    .values({
      id,
      studentId: ctx.student_id,
      scheduledFor: today,
      slot,
      kind: m.kind,
      workKey: m.key,
      targetConceptId: m.concept_id ?? null,
      status: "in_progress",
      plannedMinutes: m.minutes,
      plan: stored,
    })
    .run();
  return id;
}

export function getMission(db: Db, ctx: StudentContext, id: string): MissionView | undefined {
  const row = db.select().from(missions).where(and(eq(missions.id, id), eq(missions.studentId, ctx.student_id))).get();
  if (!row) return undefined;
  const plan = row.plan as StoredPlan;
  const attempts = db.select().from(questionAttempts).where(eq(questionAttempts.missionId, id)).orderBy(asc(questionAttempts.id)).all();
  const questions: MissionQuestion[] = [];
  for (const q of plan.questions) {
    const question = ctx.bank.byId.get(q.id);
    if (!question) continue;
    const a = attempts.find((x) => x.questionId === q.id);
    questions.push({ question, concept_id: q.concept_id, ...(a ? { answer: { given: a.answer, graded: gradeAnswer(question, a.answer) } } : {}) });
  }
  return {
    id,
    student_id: ctx.student_id,
    date: row.scheduledFor,
    status: row.status,
    mission: plan.mission,
    questions,
    ...(row.result ? { result: row.result as MissionResultJson } : {}),
  };
}

export type AnswerError = "not_found" | "finished" | "unreadable";

/** Record an answer (first answer counts; repeats return the stored grading). */
export function answerQuestion(
  db: Db,
  ctx: StudentContext,
  missionId: string,
  questionId: string,
  answer: string,
  at: string = new Date().toISOString(),
): GradedAnswer | AnswerError {
  const view = getMission(db, ctx, missionId);
  if (!view) return "not_found";
  if (view.status === "completed" || view.status === "skipped") return "finished";
  const mq = view.questions.find((q) => q.question.id === questionId);
  if (!mq) return "not_found";
  if (mq.answer) return mq.answer.graded;
  if (mq.question.kind === "numeric" && parseNumber(answer) === undefined) return "unreadable";
  const graded = gradeAnswer(mq.question, answer);
  db.insert(questionAttempts)
    .values({
      studentId: ctx.student_id,
      missionId,
      questionId,
      conceptId: mq.concept_id,
      targetMisconceptionId: mq.question.target_misconception_id,
      answer,
      correct: graded.correct,
      revealedMisconceptionId: graded.revealed_misconception_id ?? null,
      answeredAt: at,
    })
    .run();
  return graded;
}

/**
 * Finish a mission: grade each concept's check, apply the mastery rule and
 * FSRS, store everything. Writing concept_mastery updates the constellation.
 */
export function finishMission(
  db: Db,
  ctx: StudentContext,
  missionId: string,
  at: string = new Date().toISOString(),
): MissionResultJson | "not_found" | "unanswered" {
  const view = getMission(db, ctx, missionId);
  if (!view) return "not_found";
  if (view.result) return view.result;
  if (view.questions.some((q) => !q.answer)) return "unanswered";
  const params = paramsOf(ctx);
  const own = ownMisconceptions(ctx.records);
  const roots = new Set(ctx.analysis.roots.map((r) => r.concept.id));
  const progress = getConceptProgress(db, ctx.student_id);
  const kind = view.mission.kind === "learn" || view.mission.kind === "apply" ? "gate" : "review";
  const concepts = kind === "gate" ? [view.mission.concept_id!] : [...new Set(view.questions.map((q) => q.concept_id))];

  const outcomes: ConceptOutcome[] = [];
  db.transaction((tx) => {
    for (const c of concepts) {
      const answers = view.questions.filter((q) => q.concept_id === c).map((q) => q.answer!.graded);
      const before = progress[c];
      if (answers.length === 0) {
        // No verified questions for this topic yet: the recap and explainer still count as learning, but nothing is proven or failed.
        const outcome: CheckOutcome = { kind, passed: false, correct: 0, total: 0, revealed: [], own_revealed: [], rating: 1, reason: "No verified questions for this topic yet, so there was nothing to prove." };
        const after: MasteryLevel = before && isMastered(before.state) ? before.state : "learning";
        if (!before || !isMastered(before.state)) saveConceptProgress(tx as unknown as Db, ctx.student_id, c, { ...before, state: after }, at);
        outcomes.push({ concept_id: c, outcome, before: before?.state ?? "none", after, root_mastered: false });
        continue;
      }
      const outcome = gradeCheck(answers, { kind, own_misconceptions: own }, params);
      // A review of a concept that isn't proven any more (lapsed) is graded but doesn't promote it.
      const next = applyCheck(before, outcome, view.date, params);
      saveConceptProgress(tx as unknown as Db, ctx.student_id, c, next, at);
      tx.insert(reviewLog)
        .values({ studentId: ctx.student_id, conceptId: c, missionId, rating: outcome.rating, correct: outcome.passed, detail: outcome, reviewedAt: at })
        .run();
      outcomes.push({
        concept_id: c,
        outcome,
        before: before?.state ?? "none",
        after: next.state,
        root_mastered: roots.has(c) && isMastered(next.state) && !isMastered(before?.state),
      });
    }
    const result: MissionResultJson = { outcomes, finished_at: at };
    tx.update(missions).set({ status: "completed", completedAt: at, result }).where(eq(missions.id, missionId)).run();
  });
  return { outcomes, finished_at: at };
}
