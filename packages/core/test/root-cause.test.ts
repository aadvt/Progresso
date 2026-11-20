import { describe, expect, it } from "vitest";
import { analyseStudent, wordExplanations, wordingPrompt, type ObjectGenerator } from "../src";
import { graphOf, rec } from "./helpers/root-cause";

/**
 * Hand-built graphs with planted roots. Concept ids are made up; nothing here
 * mirrors the provisional graph.
 *
 *            base
 *     /    |     |     \
 *    r1    r2    s1    s2          (s1, s2: branches the student never errs in)
 *  / | \   / | \  / \   / \
 * a1 b1 c1 a2 b2 c2 x1 x2 y1 y2
 *  |
 *  d1
 */
const tree = graphOf({
  base: [],
  r1: ["base"],
  r2: ["base"],
  s1: ["base"],
  s2: ["base"],
  a1: ["r1"],
  b1: ["r1"],
  c1: ["r1"],
  d1: ["a1"],
  a2: ["r2"],
  b2: ["r2"],
  c2: ["r2"],
  x1: ["s1"],
  x2: ["s1"],
  y1: ["s2"],
  y2: ["s2"],
});

const rootIds = (a: ReturnType<typeof analyseStudent>) => a.roots.map((r) => r.concept.id).sort();

describe("root-cause engine: planted roots", () => {
  it("one root explains everything, through multi-step paths", () => {
    const records = ["a1", "b1", "c1", "d1"].map((primary) => rec({ primary }));
    const a = analyseStudent({ graph: tree, records });
    expect(rootIds(a)).toEqual(["r1"]);
    const root = a.roots[0]!;
    expect(root.explains).toHaveLength(4);
    expect(a.standalone).toEqual([]);
    const d1 = root.explains.find((e) => e.anchor.id === "d1")!;
    expect(d1.tested_path!.map((c) => c.id)).toEqual(["r1", "a1", "d1"]);
    expect(d1.hops).toBe(2);
    expect(root.marks.lost).toBe(8);
    expect(root.explanation).toMatch(/trace back to Concept r1. Those topics are all built on Concept r1/);
    expect(a.headline).toMatch(/^Fix this 1 thing → explains 4 of your 4 errors → about 8 marks at stake\.$/);
  });

  it("two independent roots are found separately, not merged into their shared ancestor", () => {
    const records = [
      rec({ primary: "a1", exam: "e1" }),
      rec({ primary: "c1", exam: "e1" }),
      rec({ primary: "b1", exam: "e2" }),
      rec({ primary: "a2", exam: "e1" }),
      rec({ primary: "b2", exam: "e2" }),
      rec({ primary: "c2", exam: "e2" }),
    ];
    const a = analyseStudent({ graph: tree, records });
    expect(rootIds(a)).toEqual(["r1", "r2"]);
    expect(a.roots.every((r) => r.explains.length === 3)).toBe(true);
    expect(a.headline).toMatch(/^Fix these 2 things → explains 6 of your 6 errors/);
  });

  it("only careless-type errors: no conceptual root, habits reported instead", () => {
    const records = [
      rec({ primary: "a1", type: "careless" }),
      rec({ primary: "b1", type: "careless" }),
      rec({ primary: "c1", type: "calculation" }),
      rec({ primary: "d1", type: "notation", misconception: undefined }),
      rec({ primary: "a2", type: "notation" }),
    ];
    const a = analyseStudent({ graph: tree, records });
    expect(a.roots).toEqual([]);
    expect(a.standalone).toEqual([]);
    expect(a.summary.habit_errors).toBe(5);
    expect(a.habits.map((h) => h.kind).sort()).toEqual(["calculation", "careless", "notation"]);
    expect(a.headline).toMatch(/No single knowledge gap/);
  });

  it("the same slip named twice becomes one repeated-slip habit", () => {
    const g = graphOf({ p: [], q: ["p"] }, { misconceptions: { p: ["m1"] } });
    const records = [
      rec({ primary: "p", type: "notation", misconception: { id: "p.m1", confidence: 0.9 } }),
      rec({ primary: "q", type: "incomplete", misconception: { id: "p.m1", confidence: 0.9 } }),
    ];
    const a = analyseStudent({ graph: g, records });
    expect(a.roots).toEqual([]);
    expect(a.habits).toHaveLength(1);
    expect(a.habits[0]!.kind).toBe("repeated_slip");
    expect(a.habits[0]!.records).toHaveLength(2);
  });
});

describe("root-cause engine: a basic concept that is demonstrably fine is not blamed", () => {
  const fan = graphOf({ b: [], c1: ["b"], c2: ["b"], c3: ["b"] });
  const fanErrors = () => ["c1", "c2", "c3"].map((primary) => rec({ primary }));

  it("without counter-evidence the shared prerequisite is the root (sanity check)", () => {
    expect(rootIds(analyseStudent({ graph: fan, records: fanErrors() }))).toEqual(["b"]);
  });

  it("explicit mastery evidence clears it: the errors stand alone", () => {
    const a = analyseStudent({
      graph: fan,
      records: fanErrors(),
      mastery: [{ concept_id: "b", strength: 0.9, source: "correct_answer" }],
    });
    expect(a.roots).toEqual([]);
    expect(a.standalone.map((s) => s.concept?.id).sort()).toEqual(["c1", "c2", "c3"]);
  });

  // base -> rr -> {a, b, c};  base -> {d, e, f, g}
  const deep = graphOf({ base: [], rr: ["base"], a: ["rr"], b: ["rr"], c: ["rr"], d: ["base"], e: ["base"], f: ["base"], g: ["base"] });
  const deepErrors = () => ["a", "b", "c", "d", "e"].map((primary) => rec({ primary }));

  it("without counter-evidence, errors spread over base's branches are blamed on base", () => {
    expect(rootIds(analyseStudent({ graph: deep, records: deepErrors() }))).toEqual(["base"]);
  });

  it("careless slips in other branches show base works: blame moves down to rr", () => {
    const slips = [rec({ primary: "f", type: "careless" }), rec({ primary: "g", type: "calculation" })];
    const a = analyseStudent({ graph: deep, records: [...deepErrors(), ...slips] });
    expect(rootIds(a)).toEqual(["rr"]);
    expect(a.standalone.map((s) => s.concept?.id).sort()).toEqual(["d", "e"]);
    expect(a.roots[0]!.evidence_against).toEqual([]);
  });

  it("explicit mastery of base does the same", () => {
    const a = analyseStudent({
      graph: deep,
      records: deepErrors(),
      mastery: [{ concept_id: "base", strength: 0.8, source: "report_strength" }],
    });
    expect(rootIds(a)).toEqual(["rr"]);
  });

  it("partial counter-evidence keeps the root but lowers confidence, and is shown", () => {
    const wide = graphOf({ b: [], c1: ["b"], c2: ["b"], c3: ["b"], c4: ["b"] });
    const records = ["c1", "c2", "c3", "c4"].map((primary) => rec({ primary }));
    const plain = analyseStudent({ graph: wide, records });
    const doubted = analyseStudent({ graph: wide, records, mastery: [{ concept_id: "c4", strength: 0.5, source: "mission" }] });
    expect(rootIds(doubted)).toEqual(["b"]);
    const root = doubted.roots[0]!;
    expect(root.confidence).toBeLessThan(plain.roots[0]!.confidence);
    expect(root.evidence_against.map((e) => e.concept_id)).toEqual(["c4"]);
    expect(root.explanation).toMatch(/likely cause rather than a certain one/);
    expect(plain.roots[0]!.evidence_against).toEqual([]);
  });
});

describe("root-cause engine: multiple exams", () => {
  it("the same root repeated across exams is stronger than within one exam", () => {
    const sameExam = analyseStudent({ graph: tree, records: ["a1", "b1", "c1"].map((primary) => rec({ primary, exam: "e1" })) });
    const twoExams = analyseStudent({
      graph: tree,
      records: [rec({ primary: "a1", exam: "e1" }), rec({ primary: "b1", exam: "e2" }), rec({ primary: "c1", exam: "e2" })],
    });
    expect(rootIds(sameExam)).toEqual(["r1"]);
    expect(rootIds(twoExams)).toEqual(["r1"]);
    expect(twoExams.roots[0]!.confidence).toBeGreaterThan(sameExam.roots[0]!.confidence);
    expect(twoExams.roots[0]!.exam_ids).toEqual(["e1", "e2"]);
    expect(twoExams.roots[0]!.explanation).toMatch(/2 different exams/);
  });

  it("two errors are not enough in one exam but are across two", () => {
    const pair = (examB: string) => [rec({ primary: "a1", exam: "e1", confidence: 1 }), rec({ primary: "b1", exam: examB, confidence: 1 })];
    const one = analyseStudent({ graph: tree, records: pair("e1") });
    const two = analyseStudent({ graph: tree, records: pair("e2") });
    expect(one.roots).toEqual([]);
    expect(rootIds(two)).toEqual(["r1"]);
  });

  it("older exams count less than recent ones", () => {
    const recent = analyseStudent({
      graph: tree,
      records: ["a1", "b1", "c1"].map((primary, i) => rec({ primary, exam: `e${i}`, date: "2026-11-01" })),
    });
    const old = analyseStudent({
      graph: tree,
      records: [
        rec({ primary: "a1", exam: "e0", date: "2026-01-01" }),
        rec({ primary: "b1", exam: "e1", date: "2026-02-01" }),
        rec({ primary: "c1", exam: "e2", date: "2026-11-01" }),
      ],
    });
    expect(old.roots[0]!.confidence).toBeLessThan(recent.roots[0]!.confidence);
  });
});

describe("root-cause engine: missing and odd data", () => {
  it("records with no marks get a flagged estimate, never NaN", () => {
    const records = [
      rec({ primary: "a1", marks: null }),
      rec({ primary: "b1", marks: null, questionMax: 5 }),
      rec({ primary: "c1", marks: null }),
    ];
    const a = analyseStudent({ graph: tree, records });
    const root = a.roots[0]!;
    expect(root.marks.lost).toBe(2 + 3 + 2); // default 2; 5 x default fraction 0.6
    expect(root.marks.estimated_part).toBe(root.marks.lost);
    expect(a.summary.marks_include_estimates).toBe(true);
    expect(Number.isFinite(root.priority)).toBe(true);
    expect(root.explains.every((e) => e.marks_lost.estimated)).toBe(true);
  });

  it("estimates follow the student's own typical loss when some records have marks", () => {
    const records = [
      rec({ primary: "a1", marks: { lost: 3, max: 4 } }),
      rec({ primary: "b1", marks: { awarded: 1, max: 4 } }),
      rec({ primary: "c1", marks: null, questionMax: 2 }),
    ];
    const a = analyseStudent({ graph: tree, records });
    const c1 = a.roots[0]!.explains.find((e) => e.anchor.id === "c1")!;
    expect(c1.marks_lost).toEqual({ value: 1.5, estimated: true }); // 2 x median(0.75, 0.75)
  });

  it("unmapped records and unknown concept ids stand alone with a warning", () => {
    const records = [rec({ primary: undefined }), rec({ primary: "a1", secondary: [{ id: "gone.concept", confidence: 0.8 }] })];
    const a = analyseStudent({ graph: tree, records });
    expect(a.standalone.map((s) => s.reason).sort()).toEqual(["no_shared_root", "unmapped"]);
    expect(a.warnings.join("\n")).toMatch(/gone\.concept/);
  });

  it("is deterministic and independent of record order", () => {
    const records = [
      rec({ primary: "a1", exam: "e1" }),
      rec({ primary: "c1", exam: "e2" }),
      rec({ primary: "b2", exam: "e1", type: "procedural" }),
      rec({ primary: "a2", exam: "e2" }),
      rec({ primary: "x1", type: "careless" }),
    ];
    const a = analyseStudent({ graph: tree, records });
    const b = analyseStudent({ graph: tree, records: [...records].reverse() });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("handles an empty record list and rejects mixed students", () => {
    expect(analyseStudent({ graph: tree, records: [] }).headline).toMatch(/No errors/);
    expect(() =>
      analyseStudent({ graph: tree, records: [rec({ primary: "a1", student: "s1" }), rec({ primary: "a1", student: "s2" })] }),
    ).toThrow(/one student/);
  });
});

describe("root-cause engine: LLM wording", () => {
  const analysis = analyseStudent({ graph: tree, records: ["a1", "b1", "c1"].map((primary) => rec({ primary, student: "stu-secret-id" })) });

  it("sends only anonymous facts and applies the wording", async () => {
    let seen = "";
    const fake: ObjectGenerator = {
      async generateObject(_task, opts) {
        seen = opts.prompt;
        return { data: opts.schema.parse({ roots: [{ concept_id: "r1", explanation: "Reworded explanation for a student." }] }), cached: false };
      },
    };
    const out = await wordExplanations(analysis, fake);
    expect(seen).not.toMatch(/stu-secret-id/);
    expect(wordingPrompt(analysis)).toBe(seen);
    expect(out.analysis.roots[0]!.explanation).toBe("Reworded explanation for a student.");
    expect(out.analysis.roots[0]!.explanation_source).toBe("llm");
    expect(analysis.roots[0]!.explanation_source).toBe("template");
  });

  it("falls back to the template if the LLM fails", async () => {
    const failing: ObjectGenerator = {
      async generateObject() {
        throw new Error("503 overloaded");
      },
    };
    const out = await wordExplanations(analysis, failing);
    expect(out.error).toMatch(/503/);
    expect(out.analysis.roots[0]!.explanation).toBe(analysis.roots[0]!.explanation);
  });
});
