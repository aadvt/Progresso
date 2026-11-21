import { describe, expect, it } from "vitest";
import {
  addDays,
  analyseStudent,
  buildConstellation,
  layoutConstellation,
  loadAppConfig,
  loadConceptGraph,
  makeBank,
  ProveItQuestionSchema,
  type ProveItQuestion,
} from "@progresso/core";
import { loadDemoFixtures } from "@progresso/core/demo-fixtures";
import {
  answerQuestion,
  ensureDemoData,
  finishMission,
  getConceptMastery,
  getMission,
  getPlan,
  getPlanSettings,
  getProgress,
  liveMisconceptions,
  openDb,
  resetPlan,
  runMigrations,
  savePlanSettings,
  schema,
  startMission,
  type StudentContext,
} from "../src";

const config = loadAppConfig();
const { graph } = loadConceptGraph(config.conceptGraphDir);
const demo = loadDemoFixtures(config.fixturesDir);
const riya = demo.find((d) => d.student.id === "demo-riya")!;
const analysis = { ...analyseStudent({ graph, records: riya.records }), student_id: riya.student.id };
const ROOT = analysis.roots[0]!.concept.id;
const OWN = riya.records.find((r) => r.misconception?.misconception_id?.startsWith(ROOT))!.misconception!.misconception_id;
const OTHER = graph.get(ROOT).misconceptions.find((m) => m.id !== OWN)!.id;
const DAY = "2026-11-21";

/** A tiny hand-written bank: 4 MCQs and a numeric on the root, aimed at its misconceptions. */
function q(n: number, kind: "mcq" | "numeric" = "mcq"): ProveItQuestion {
  const base = {
    schema_version: "1.0" as const,
    id: `test.${n}`,
    subject: "Mathematics",
    concept_id: ROOT,
    target_misconception_id: n % 2 ? OWN : OTHER,
    stem: `Test question ${n}`,
    solution: "Worked solution.",
    difficulty: 1 as const,
    verification: { status: "verified" as const, checks: [{ method: "cas_sympy" as const, passed: true, detail: "test" }], verified_at: DAY },
    provenance: { generator: { provider: "test", model: "hand" }, generated_at: DAY, prompt_version: "test", distractors_from: { misconceptions: [OWN, OTHER], report_mistakes: 0 } },
  };
  if (kind === "numeric")
    return ProveItQuestionSchema.parse({
      ...base,
      kind,
      answer: { value: 12, tolerance: 0.01, display: "12", feedback: "Right." },
      numeric_wrong: [{ value: 4, misconception_id: OWN, feedback: "That's the old slip." }],
    });
  return ProveItQuestionSchema.parse({
    ...base,
    kind,
    options: [
      { id: "a", text: "right", correct: true, feedback: "Yes." },
      { id: "b", text: "own slip", correct: false, misconception_id: OWN, feedback: "The old slip." },
      { id: "c", text: "other slip", correct: false, misconception_id: OTHER, feedback: "Another slip." },
    ],
  });
}

function setup() {
  const handle = openDb(":memory:");
  runMigrations(handle.db);
  ensureDemoData(handle.db, demo, graph);
  const ctx: StudentContext = { student_id: riya.student.id, graph, analysis, records: riya.records, bank: makeBank([q(1), q(2), q(3), q(4), q(5, "numeric")]) };
  savePlanSettings(handle.db, ctx.student_id, { exam_name: "Pre-Board 2", exam_date: riya.student.next_exam!.date, daily_minutes: 25, start_date: DAY });
  return { ...handle, ctx };
}

function play(db: ReturnType<typeof setup>["db"], ctx: StudentContext, day: string, answers: (qq: ProveItQuestion) => string) {
  const plan = getPlan(db, ctx, day)!;
  const m = plan.days.find((d) => d.date === day)!.missions.find((x) => x.status === "today")!;
  const id = startMission(db, ctx, day, m.key)!;
  const view = getMission(db, ctx, id)!;
  for (const x of view.questions) answerQuestion(db, ctx, id, x.question.id, answers(x.question), `${day}T18:00:00Z`);
  return { id, key: m.key, result: finishMission(db, ctx, id, `${day}T18:30:00Z`) };
}

const right = (qq: ProveItQuestion) => (qq.kind === "mcq" ? "a" : "12");

describe("mission service", () => {
  it("stores the plan settings and plans today's first mission on the root", () => {
    const { db, ctx, close } = setup();
    expect(getPlanSettings(db, ctx.student_id)).toMatchObject({ daily_minutes: 25, start_date: DAY, demo_day_offset: 0 });
    const plan = getPlan(db, ctx, DAY)!;
    expect(plan.days.find((d) => d.date === DAY)!.missions[0]).toMatchObject({ kind: "learn", concept_id: ROOT, status: "today" });
    close();
  });

  it("starting a mission fixes its questions (own misconceptions first, a numeric included); starting again resumes it", () => {
    const { db, ctx, close } = setup();
    const key = getPlan(db, ctx, DAY)!.days[0]!.missions[0]!.key;
    const id = startMission(db, ctx, DAY, key)!;
    expect(startMission(db, ctx, DAY, key)).toBe(id);
    const view = getMission(db, ctx, id)!;
    expect(view.questions).toHaveLength(4);
    expect(view.questions.some((x) => x.question.kind === "numeric")).toBe(true);
    expect(view.questions.filter((x) => x.question.target_misconception_id === OWN).length).toBeGreaterThanOrEqual(2);
    expect(getPlan(db, ctx, DAY)!.days[0]!.missions[0]!.stored_id).toBe(id);
    close();
  });

  it("grades answers on the server, records the misconception a wrong pick reveals, and keeps the first answer", () => {
    const { db, ctx, close } = setup();
    const id = startMission(db, ctx, DAY, getPlan(db, ctx, DAY)!.days[0]!.missions[0]!.key)!;
    const view = getMission(db, ctx, id)!;
    const mcq = view.questions.find((x) => x.question.kind === "mcq")!;
    const wrong = answerQuestion(db, ctx, id, mcq.question.id, "c");
    expect(wrong).toMatchObject({ correct: false, revealed_misconception_id: OTHER, feedback: "Another slip." });
    expect(answerQuestion(db, ctx, id, mcq.question.id, "a")).toMatchObject({ correct: false });
    const num = view.questions.find((x) => x.question.kind === "numeric")!;
    expect(answerQuestion(db, ctx, id, num.question.id, "twelve")).toBe("unreadable");
    expect(answerQuestion(db, ctx, id, num.question.id, "4")).toMatchObject({ correct: false, revealed_misconception_id: OWN });
    expect(liveMisconceptions(db, ctx).get(OTHER)).toMatchObject({ alive: true, source: "check" });
    expect(finishMission(db, ctx, id)).toBe("unanswered");
    close();
  });

  it("passing the gate proves the root: FSRS card saved, the constellation shows it mastered, the plan drops the rest of its learn missions", () => {
    const { db, ctx, close } = setup();
    const before = getPlan(db, ctx, DAY)!;
    const learnBefore = before.days.flatMap((d) => d.missions).filter((m) => m.concept_id === ROOT && m.kind === "learn").length;
    const { result } = play(db, ctx, DAY, right);
    if (typeof result === "string") throw new Error(result);
    expect(result.outcomes[0]).toMatchObject({ concept_id: ROOT, before: "none", after: "proven", root_mastered: true });
    const row = db.select().from(schema.conceptMastery).all().find((r) => r.conceptId === ROOT)!;
    expect(row).toMatchObject({ state: "proven", provenAt: DAY, reps: 1 });
    expect(row.dueAt! > DAY).toBe(true);
    expect(db.select().from(schema.reviewLog).all()).toHaveLength(1);

    const model = buildConstellation({ student_id: ctx.student_id, graph, layout: layoutConstellation(graph, riya.student.subjects), analysis, records: riya.records, mastery: getConceptMastery(db, ctx.student_id) });
    expect(model.roots[0]!.mastered).toBe(true);
    expect(model.nodes.filter((n) => n.lit).length).toBeGreaterThan(5);

    const next = getPlan(db, ctx, addDays(DAY, 1))!;
    const upcoming = next.days.filter((d) => d.kind !== "past").flatMap((d) => d.missions);
    expect(learnBefore).toBeGreaterThan(1);
    expect(upcoming.filter((m) => m.concept_id === ROOT && m.kind === "learn")).toHaveLength(0);
    expect(upcoming[0]!.kind).toBe("apply");
    expect(getProgress(db, ctx.student_id).history[0]).toMatchObject({ status: "completed", passed: true });
    close();
  });

  it("bringing back the report's own mistake fails the gate, even at 3 of 4", () => {
    const { db, ctx, close } = setup();
    let wrongOnce = false;
    const { result } = play(db, ctx, DAY, (qq) => {
      if (!wrongOnce && qq.kind === "mcq") {
        wrongOnce = true;
        return "b";
      }
      return right(qq);
    });
    if (typeof result === "string") throw new Error(result);
    expect(result.outcomes[0]!.outcome).toMatchObject({ passed: false, correct: 3, total: 4, own_revealed: [OWN] });
    expect(result.outcomes[0]!.after).toBe("learning");
    // Tomorrow: the next learn attempt on the root.
    const next = getPlan(db, ctx, addDays(DAY, 1))!;
    expect(next.days.find((d) => d.date === addDays(DAY, 1))!.missions[0]).toMatchObject({ concept_id: ROOT, attempt: 2 });
    close();
  });

  it("a started mission left unfinished becomes skipped the next day, and comes back", () => {
    const { db, ctx, close } = setup();
    const key = getPlan(db, ctx, DAY)!.days[0]!.missions[0]!.key;
    startMission(db, ctx, DAY, key);
    const next = getPlan(db, ctx, addDays(DAY, 1))!;
    expect(getProgress(db, ctx.student_id).history[0]).toMatchObject({ status: "skipped" });
    expect(next.days.find((d) => d.date === addDays(DAY, 1))!.missions[0]!.key).toBe(key);
    close();
  });

  it("resetPlan forgets the plan, its missions, answers and mastery", () => {
    const { db, ctx, close } = setup();
    play(db, ctx, DAY, right);
    resetPlan(db, ctx.student_id);
    expect(getPlanSettings(db, ctx.student_id)).toBeUndefined();
    expect(db.select().from(schema.missions).all()).toHaveLength(0);
    expect(db.select().from(schema.questionAttempts).all()).toHaveLength(0);
    expect(getConceptMastery(db, ctx.student_id)).toHaveLength(0);
    close();
  });
});
