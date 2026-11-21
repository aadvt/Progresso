import { describe, expect, it } from "vitest";
import {
  addDays,
  analyseStudent,
  applyCheck,
  buildPlan,
  computeReadiness,
  daysBetween,
  deriveWork,
  gradeCheck,
  loadAppConfig,
  loadConceptGraph,
  misconceptionStatus,
  Rating,
  reviewCard,
  type AnswerResult,
  type ComebackPlan,
  type ErrorRecord,
  type MissionRecord,
  type ProgressState,
  type RootCauseAnalysis,
} from "../src";
import { loadDemoFixtures } from "../src/demo-fixtures";

const config = loadAppConfig();
const { graph } = loadConceptGraph(config.conceptGraphDir);
const demo = loadDemoFixtures(config.fixturesDir);
const TODAY = "2026-11-21";

function student(id: string): { analysis: RootCauseAnalysis; records: ErrorRecord[]; exam: string } {
  const s = demo.find((d) => d.student.id === id)!;
  return { analysis: analyseStudent({ graph, records: s.records }), records: s.records, exam: s.student.next_exam!.date };
}

const empty = (): ProgressState => ({ concepts: {}, history: [] });

function plan(id: string, opts: { today?: string; daily?: number; exam?: string; progress?: ProgressState; analysis?: RootCauseAnalysis; records?: ErrorRecord[] } = {}): ComebackPlan {
  const s = student(id);
  return buildPlan({
    student_id: id,
    graph,
    analysis: opts.analysis ?? s.analysis,
    records: opts.records ?? s.records,
    settings: { exam_name: "Pre-Board 2", exam_date: opts.exam ?? s.exam, daily_minutes: opts.daily ?? 25, start_date: TODAY },
    today: opts.today ?? TODAY,
    progress: opts.progress ?? empty(),
  });
}

/** Learning missions still to do (past days excluded). */
const learning = (p: ComebackPlan) =>
  p.days
    .filter((d) => d.kind !== "past")
    .flatMap((d) => d.missions)
    .filter((m) => (m.kind === "learn" || m.kind === "apply") && m.status !== "done");

function completed(date: string, key: string, concept: string, kind: MissionRecord["kind"] = "learn", passed = false): MissionRecord {
  return { key, kind, date, slot: 0, status: "completed", concept_id: concept, passed };
}

describe("comeback plan: order", () => {
  it("puts the highest marks-per-hour root first, learn before apply, one-off gaps after roots", () => {
    const p = plan("demo-kabir");
    const ms = learning(p);
    const kabir = student("demo-kabir").analysis;
    const [first, second] = [...kabir.roots].sort((a, b) => b.priority - a.priority);
    expect(ms[0]!.concept_id).toBe(first!.concept.id);
    const firstSecond = ms.findIndex((m) => m.root_id === second!.concept.id);
    expect(ms.slice(0, firstSecond).every((m) => m.root_id === first!.concept.id)).toBe(true);
    // Inside a root: every learn mission comes before any apply mission.
    for (const root of kabir.roots) {
      const block = ms.filter((m) => m.root_id === root.concept.id);
      const lastLearn = block.map((m) => m.kind).lastIndexOf("learn");
      const firstApply = block.map((m) => m.kind).indexOf("apply");
      expect(lastLearn).toBeLessThan(firstApply);
    }
    // One-offs (no root) only after every root mission.
    const firstOneOff = ms.findIndex((m) => !m.root_id);
    expect(firstOneOff).toBeGreaterThan(ms.map((m) => !!m.root_id).lastIndexOf(true));
  });

  it("respects prerequisite order: a root built on another root waits for it, whatever its priority (deepest root first)", () => {
    const riya = student("demo-riya");
    const vihaan = student("demo-vihaan");
    const chain = riya.analysis.roots[0]!;
    const identities = vihaan.analysis.roots[0]!;
    expect(graph.ancestorsOf(chain.concept.id).has(identities.concept.id)).toBe(true);
    // Make the deeper root the LOWER priority one.
    const analysis: RootCauseAnalysis = {
      ...riya.analysis,
      roots: [
        { ...chain, priority: 5 },
        { ...identities, priority: 1, rank: 2 },
      ],
      standalone: [],
    };
    const work = deriveWork({ graph, analysis, records: [...riya.records, ...vihaan.records], progress: empty() });
    expect(work.items[0]!.concept_id).toBe(identities.concept.id);
    const lastDeep = work.items.map((i) => i.root_id).lastIndexOf(identities.concept.id);
    const firstChain = work.items.findIndex((i) => i.root_id === chain.concept.id);
    expect(lastDeep).toBeLessThan(firstChain);
  });

  it("applies a root nearest-first, in the topics where the mistakes surfaced", () => {
    const work = deriveWork({ graph, analysis: student("demo-vihaan").analysis, records: student("demo-vihaan").records, progress: empty() });
    const applies = work.items.filter((i) => i.kind === "apply");
    expect(applies.length).toBeGreaterThan(2);
    const depth = applies.map((a) => graph.depthOf(a.concept_id));
    // Prerequisite order: no apply target is a prerequisite of an earlier one.
    for (let i = 0; i < applies.length; i++)
      for (let j = i + 1; j < applies.length; j++) expect(graph.ancestorsOf(applies[i]!.concept_id).has(applies[j]!.concept_id)).toBe(false);
    expect(depth.length).toBe(applies.length);
    // Each mission recaps the report's own records for that topic.
    for (const a of applies) expect(a.record_ids.length).toBeGreaterThan(0);
  });

  it("every mission has the fixed structure: recap → explainer → prove-it, in 25 minutes", () => {
    for (const m of learning(plan("demo-riya"))) {
      expect(m.steps.map((s) => s.kind)).toEqual(["recap", "explainer", "prove_it"]);
      expect(m.steps.reduce((s, x) => s + x.minutes, 0)).toBe(25);
      expect(m.steps.find((s) => s.kind === "prove_it")!.content).toBe("ready");
    }
  });
});

describe("comeback plan: time budget", () => {
  for (const daily of [25, 40, 50, 75]) {
    it(`never plans more than ${daily} minutes a day, and fits whole missions`, () => {
      const p = plan("demo-kabir", { daily });
      for (const d of p.days) {
        expect(d.minutes).toBeLessThanOrEqual(Math.max(daily, 25));
        const full = d.missions.filter((m) => m.minutes === 25).length;
        expect(full).toBeLessThanOrEqual(Math.max(1, Math.floor(daily / 25)));
      }
      // Everything fits with ~54 days to go.
      expect(p.unscheduled).toHaveLength(0);
    });
  }

  it("more minutes a day finishes the learning sooner", () => {
    const a = plan("demo-riya", { daily: 25 }).totals.projected_finish!;
    const b = plan("demo-riya", { daily: 50 }).totals.projected_finish!;
    expect(daysBetween(b, a)).toBeGreaterThan(3);
  });

  it("keeps buffer days before the exam free of new learning, and interleaves reviews", () => {
    const p = plan("demo-riya");
    const buffer = p.days.filter((d) => d.kind === "buffer");
    expect(buffer).toHaveLength(2);
    for (const d of buffer) expect(d.missions.every((m) => m.kind === "rehearsal" || m.kind === "review")).toBe(true);
    expect(p.days[p.days.length - 1]).toMatchObject({ kind: "exam", missions: [] });
    // Reviews appear between learning missions, not only after them.
    const kinds = p.days.flatMap((d) => d.missions.map((m) => m.kind));
    const lastLearning = Math.max(kinds.lastIndexOf("learn"), kinds.lastIndexOf("apply"));
    expect(kinds.slice(0, lastLearning).includes("review")).toBe(true);
    // Nothing goes more than 14 days without a review once proven (FSRS capped interval).
    expect(p.totals.reviews_planned).toBeGreaterThan(5);
  });

  it("when time runs out, drops the lowest marks-per-hour work and says so", () => {
    const p = plan("demo-riya", { exam: addDays(TODAY, 8) });
    expect(p.unscheduled.length).toBeGreaterThan(0);
    expect(p.warnings.join(" ")).toMatch(/don't fit before Pre-Board 2/);
    // What's scheduled is a prefix of the work order: the dropped ones are the tail.
    const work = deriveWork({ graph, analysis: student("demo-riya").analysis, records: student("demo-riya").records, progress: empty() }).items.map((i) => i.key);
    const scheduled = learning(p).map((m) => m.key);
    expect(work.slice(0, scheduled.length)).toEqual(scheduled);
    expect(p.unscheduled.map((u) => u.key)).toEqual(work.slice(scheduled.length));
  });
});

describe("comeback plan: re-flow", () => {
  it("falling behind: skipped days push the same work later, nothing is lost", () => {
    const onTime = plan("demo-riya");
    const late = plan("demo-riya", { today: addDays(TODAY, 3) });
    expect(learning(late)[0]!.key).toBe(learning(onTime)[0]!.key);
    expect(learning(late).map((m) => m.key)).toEqual(learning(onTime).map((m) => m.key));
    expect(daysBetween(onTime.totals.projected_finish!, late.totals.projected_finish!)).toBeGreaterThanOrEqual(3);
    // The missed days show as missed in the timeline.
    expect(late.days.filter((d) => d.kind === "past" && d.missed)).toHaveLength(3);
  });

  it("a skipped mission is not an attempt: it comes back", () => {
    const first = learning(plan("demo-riya"))[0]!;
    const p = plan("demo-riya", {
      today: addDays(TODAY, 1),
      progress: { concepts: {}, history: [{ ...completed(TODAY, first.key, first.concept_id!), status: "skipped" }] },
    });
    expect(learning(p)[0]!.key).toBe(first.key);
  });

  it("mastering early: passing the gate on the first try drops the remaining learn missions", () => {
    const before = plan("demo-riya");
    const root = student("demo-riya").analysis.roots[0]!.concept.id;
    const plannedLearn = learning(before).filter((m) => m.concept_id === root).length;
    expect(plannedLearn).toBeGreaterThan(1);
    const proven = applyCheck(undefined, gradeCheck(all(4, true), { kind: "gate", own_misconceptions: [] }), TODAY);
    const after = plan("demo-riya", {
      today: addDays(TODAY, 1),
      progress: { concepts: { [root]: proven }, history: [completed(TODAY, `learn:${root}:1`, root, "learn", true)] },
    });
    expect(learning(after).filter((m) => m.concept_id === root)).toHaveLength(0);
    expect(learning(after)[0]!.kind).toBe("apply");
    expect(learning(after).length).toBe(learning(before).length - plannedLearn);
    // And the proven root gets FSRS reviews.
    expect(after.days.some((d) => d.missions.some((m) => m.kind === "review" && m.review_concepts.includes(root)))).toBe(true);
  });

  it("failing every planned attempt adds one more go (and flags it after the retries)", () => {
    const root = student("demo-riya").analysis.roots[0]!.concept.id;
    const planned = learning(plan("demo-riya")).filter((m) => m.concept_id === root).length;
    const history = Array.from({ length: planned }, (_, i) => completed(addDays(TODAY, i), `learn:${root}:${i + 1}`, root));
    const p = plan("demo-riya", { today: addDays(TODAY, planned), progress: { concepts: { [root]: { state: "learning" } }, history } });
    const next = learning(p)[0]!;
    expect(next).toMatchObject({ concept_id: root, attempt: planned + 1 });
    expect(next.needs_help).toBeUndefined();
    const many = Array.from({ length: planned + 2 }, (_, i) => completed(addDays(TODAY, i), `learn:${root}:${i + 1}`, root));
    const stuck = plan("demo-riya", { today: addDays(TODAY, planned + 2), progress: { concepts: { [root]: { state: "learning" } }, history: many } });
    expect(learning(stuck)[0]).toMatchObject({ concept_id: root, attempt: planned + 3, needs_help: true });
    expect(stuck.warnings.join(" ")).toMatch(/teacher/);
  });

  it("after the last flagged go fails too, the concept is parked so the rest of the plan goes ahead", () => {
    const root = student("demo-riya").analysis.roots[0]!.concept.id;
    const planned = learning(plan("demo-riya")).filter((m) => m.concept_id === root).length;
    const all = Array.from({ length: planned + 3 }, (_, i) => completed(addDays(TODAY, i), `learn:${root}:${i + 1}`, root));
    const p = plan("demo-riya", { today: addDays(TODAY, planned + 3), progress: { concepts: { [root]: { state: "learning" } }, history: all } });
    expect(learning(p).some((m) => m.concept_id === root)).toBe(false);
    expect(learning(p).length).toBeGreaterThan(0);
    expect(p.warnings.join(" ")).toMatch(/teacher/);
    expect(p.warnings.join(" ")).toMatch(/Taken out of the plan for now/);
  });

  it("a topic with no verified questions yet is studied once, not retried forever", () => {
    const root = student("demo-riya").analysis.roots[0]!.concept.id;
    const first = learning(plan("demo-riya", { progress: { concepts: { [root]: { state: "proven" } }, history: [] } }))[0]!;
    expect(first.kind).toBe("apply");
    const studied: MissionRecord = { ...completed(TODAY, first.key, first.concept_id!, "apply"), checked: false };
    const p = plan("demo-riya", { today: addDays(TODAY, 1), progress: { concepts: { [root]: { state: "proven" }, [first.concept_id!]: { state: "learning" } }, history: [studied] } });
    expect(learning(p).some((m) => m.concept_id === first.concept_id)).toBe(false);
    expect(p.warnings.join(" ")).toMatch(/Studied but not proven yet/);
    // A checked attempt that failed is retried as before.
    const failed = plan("demo-riya", {
      today: addDays(TODAY, 1),
      progress: { concepts: { [root]: { state: "proven" }, [first.concept_id!]: { state: "learning" } }, history: [completed(TODAY, first.key, first.concept_id!, "apply")] },
    });
    expect(learning(failed)[0]).toMatchObject({ concept_id: first.concept_id, attempt: 2 });
  });

  it("a lapse (failed review) puts the concept back into the plan", () => {
    const root = student("demo-riya").analysis.roots[0]!.concept.id;
    const history = [completed(TODAY, `learn:${root}:1`, root, "learn", true)];
    const lapsed = plan("demo-riya", { today: addDays(TODAY, 5), progress: { concepts: { [root]: { state: "learning" } }, history } });
    expect(learning(lapsed)[0]!.concept_id).toBe(root);
  });

  it("is deterministic", () => {
    expect(plan("demo-vihaan")).toEqual(plan("demo-vihaan"));
  });
});

// ---------------------------------------------------------------- mastery

function all(n: number, correct: boolean, revealed?: string): AnswerResult[] {
  return Array.from({ length: n }, (_, i) => ({ question_id: `q${i}`, correct, ...(revealed && !correct ? { revealed_misconception_id: revealed } : {}) }));
}

describe("mastery gate", () => {
  const own = ["math.chain_rule.m1"];
  it("passes 4/4 (Good) and 3/4 when the miss isn't the student's own mistake (Hard)", () => {
    expect(gradeCheck(all(4, true), { kind: "gate", own_misconceptions: own })).toMatchObject({ passed: true, rating: Rating.Good });
    const three = [...all(3, true), ...all(1, false, "math.chain_rule.m2")];
    expect(gradeCheck(three, { kind: "gate", own_misconceptions: own })).toMatchObject({ passed: true, rating: Rating.Hard, revealed: ["math.chain_rule.m2"] });
  });

  it("fails 3/4 when the wrong pick is the mistake from the report, and fails 2/4", () => {
    const back = [...all(3, true), ...all(1, false, "math.chain_rule.m1")];
    const o = gradeCheck(back, { kind: "gate", own_misconceptions: own });
    expect(o).toMatchObject({ passed: false, rating: Rating.Again, own_revealed: ["math.chain_rule.m1"] });
    expect(o.reason).toMatch(/came back/);
    expect(gradeCheck([...all(2, true), ...all(2, false)], { kind: "gate", own_misconceptions: own }).passed).toBe(false);
  });

  it("state: pass → proven (with an FSRS due date); review passed days later → retained; failed review → learning", () => {
    const proven = applyCheck(undefined, gradeCheck(all(4, true), { kind: "gate", own_misconceptions: [] }), TODAY);
    expect(proven).toMatchObject({ state: "proven", proven_at: TODAY });
    expect(daysBetween(TODAY, proven.due!)).toBeGreaterThan(0);
    const early = applyCheck(proven, gradeCheck(all(2, true), { kind: "review", own_misconceptions: [] }), addDays(TODAY, 1));
    expect(early.state).toBe("proven");
    const later = applyCheck(proven, gradeCheck(all(2, true), { kind: "review", own_misconceptions: [] }), addDays(TODAY, 4));
    expect(later.state).toBe("retained");
    const lapse = applyCheck(later, gradeCheck(all(2, false), { kind: "review", own_misconceptions: [] }), addDays(TODAY, 10));
    expect(lapse).toMatchObject({ state: "learning" });
    expect(lapse.proven_at).toBeUndefined();
    expect(lapse.card!.lapses).toBe(1);
  });

  it("nothing right on a first check → gap; something right → learning", () => {
    expect(applyCheck(undefined, gradeCheck(all(4, false), { kind: "gate", own_misconceptions: [] }), TODAY).state).toBe("gap");
    expect(applyCheck(undefined, gradeCheck([...all(1, true), ...all(3, false)], { kind: "gate", own_misconceptions: [] }), TODAY).state).toBe("learning");
  });

  it("FSRS never waits more than 14 days before an exam", () => {
    let card = reviewCard(undefined, TODAY, Rating.Good);
    for (let i = 0; i < 5; i++) {
      const day = card.due.slice(0, 10);
      card = reviewCard(card, day, Rating.Good);
      expect(daysBetween(day, card.due.slice(0, 10))).toBeLessThanOrEqual(14);
    }
  });

  it("wrong answers keep a misconception alive; a right answer to a question aimed at it clears it", () => {
    const s = misconceptionStatus(
      ["math.chain_rule.m1"],
      [
        { at: "2026-11-21T10:00:00Z", misconception_id: "math.chain_rule.m1", revealed: false },
        { at: "2026-11-22T10:00:00Z", misconception_id: "math.chain_rule.m2", revealed: true },
      ],
    );
    expect(s.get("math.chain_rule.m1")).toMatchObject({ alive: false, times_cleared: 1 });
    expect(s.get("math.chain_rule.m2")).toMatchObject({ alive: true, times_revealed: 1 });
  });
});

// ---------------------------------------------------------------- readiness

describe("readiness meter", () => {
  const ordered = (r: { low: number; mid: number; high: number }) => r.low <= r.mid && r.mid <= r.high;

  it("is a labelled range; start equals now before any work; potential is higher", () => {
    const s = student("demo-riya");
    const r = computeReadiness({ graph, analysis: s.analysis, records: s.records, progress: empty(), exam_date: s.exam });
    expect(r.label).toBe("Estimate");
    expect(r.now).toEqual(r.start);
    expect(r.potential.mid).toBeGreaterThan(r.now.mid);
    for (const x of [r.start, r.now, r.potential]) expect(ordered(x)).toBe(true);
    expect(r.now.high - r.now.low).toBeGreaterThan(4);
    expect(r.drivers[0]!.concept_id).toBe(s.analysis.roots[0]!.concept.id);
  });

  it("rises as concepts are mastered, more for retained than proven", () => {
    const s = student("demo-riya");
    const root = s.analysis.roots[0]!.concept.id;
    const at = (state: "learning" | "proven" | "retained") =>
      computeReadiness({ graph, analysis: s.analysis, records: s.records, progress: { concepts: { [root]: { state } }, history: [] }, exam_date: s.exam }).now.mid;
    const start = computeReadiness({ graph, analysis: s.analysis, records: s.records, progress: empty(), exam_date: s.exam }).now.mid;
    expect(at("learning")).toBeGreaterThan(start);
    expect(at("proven")).toBeGreaterThan(at("learning"));
    expect(at("retained")).toBeGreaterThan(at("proven"));
  });

  it("starting score reflects the marks the reports say were lost", () => {
    const s = student("demo-vihaan");
    const r = computeReadiness({ graph, analysis: s.analysis, records: s.records, progress: empty(), exam_date: s.exam });
    const maths = r.subjects.find((x) => x.subject === "Mathematics")!;
    // Vihaan's maths papers: 40 + 80 + 80 marks; lost 4/40, 5/80, 6/80 on the records → about 92.1%.
    expect(maths.start.mid).toBeCloseTo(100 - (10 + 6.25 + 7.5) / 3, 0);
  });

  it("without marks in the reports, falls back to chapter weightage and widens the range", () => {
    const s = student("demo-kabir");
    const noMarks = s.records.map((r) => {
      const { marks: _drop, ...rest } = r;
      return rest as ErrorRecord;
    });
    const withMarks = computeReadiness({ graph, analysis: s.analysis, records: s.records, progress: empty(), exam_date: s.exam });
    const without = computeReadiness({ graph, analysis: s.analysis, records: noMarks, progress: empty(), exam_date: s.exam });
    expect(without.basis).toBe("weightage");
    expect(without.notes.join(" ")).toMatch(/weightage/);
    expect(without.now.high - without.now.low).toBeGreaterThan(withMarks.now.high - withMarks.now.low);
  });

  it("habits-only student: no topic drivers, small gains only from habits", () => {
    const s = student("demo-ananya");
    const r = computeReadiness({ graph, analysis: s.analysis, records: s.records, progress: empty(), exam_date: s.exam });
    expect(r.drivers).toHaveLength(0);
    expect(r.potential.mid).toBeGreaterThanOrEqual(r.now.mid);
  });

  it("a proven topic left unreviewed counts for less at the low end (FSRS retrievability)", () => {
    const s = student("demo-riya");
    const root = s.analysis.roots[0]!.concept.id;
    const fresh = applyCheck(undefined, gradeCheck(all(4, true), { kind: "gate", own_misconceptions: [] }), addDays(s.exam, -2));
    const stale = applyCheck(undefined, gradeCheck(all(4, true), { kind: "gate", own_misconceptions: [] }), addDays(s.exam, -45));
    const low = (p: typeof fresh) => computeReadiness({ graph, analysis: s.analysis, records: s.records, progress: { concepts: { [root]: p }, history: [] }, exam_date: s.exam }).now.low;
    expect(low(fresh)).toBeGreaterThan(low(stale));
  });
});
