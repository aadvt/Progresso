import { describe, expect, it } from "vitest";
import {
  gradeAnswer,
  loadAppConfig,
  loadConceptGraph,
  loadQuestionBank,
  makeBank,
  parseNumber,
  ProveItQuestionSchema,
  selectQuestions,
  type ProveItQuestion,
} from "../src";

const config = loadAppConfig();
const { graph } = loadConceptGraph(config.conceptGraphDir);

function q(id: string, concept: string, target: string, kind: "mcq" | "numeric" = "mcq"): ProveItQuestion {
  const base = {
    schema_version: "1.0" as const,
    id,
    subject: "Mathematics",
    concept_id: concept,
    target_misconception_id: target,
    stem: "s",
    solution: "w",
    difficulty: 1 as const,
    verification: { status: "verified" as const, checks: [{ method: "llm_solve" as const, passed: true, detail: "t" }], verified_at: "x" },
    provenance: { generator: { provider: "t", model: "t" }, generated_at: "x", prompt_version: "t", distractors_from: { misconceptions: [target], report_mistakes: 0 } },
  };
  return ProveItQuestionSchema.parse(
    kind === "mcq"
      ? {
          ...base,
          kind,
          options: [
            { id: "a", text: "1", correct: false, misconception_id: target, feedback: "slip A" },
            { id: "b", text: "2", correct: true, feedback: "yes" },
            { id: "c", text: "3", correct: false, misconception_id: "x.m9", feedback: "slip C" },
          ],
        }
      : { ...base, kind, answer: { value: 0.75, tolerance: 0.01, display: "3/4", feedback: "yes" }, numeric_wrong: [{ value: 1.5, misconception_id: target, feedback: "doubled" }] },
  );
}

describe("prove-it answers", () => {
  it("a wrong option reveals the misconception it was built from", () => {
    const question = q("q1", "math.chain_rule", "math.chain_rule.m1");
    expect(gradeAnswer(question, "b")).toMatchObject({ correct: true, feedback: "yes" });
    expect(gradeAnswer(question, "a")).toMatchObject({ correct: false, revealed_misconception_id: "math.chain_rule.m1", feedback: "slip A", correct_option_id: "b", matched: true });
  });

  it("numeric answers: fractions and decimals are equal; an anticipated wrong value reveals its misconception", () => {
    const question = q("q2", "math.chain_rule", "math.chain_rule.m1", "numeric");
    expect(gradeAnswer(question, "3/4").correct).toBe(true);
    expect(gradeAnswer(question, "0.75").correct).toBe(true);
    expect(gradeAnswer(question, "1.5")).toMatchObject({ correct: false, revealed_misconception_id: "math.chain_rule.m1" });
    expect(gradeAnswer(question, "2")).toMatchObject({ correct: false, matched: false });
  });

  it("parses typed numbers", () => {
    expect(parseNumber(" -3.5 ")).toBe(-3.5);
    expect(parseNumber("3/4")).toBe(0.75);
    expect(parseNumber("0,5")).toBe(0.5);
    expect(parseNumber("1e-3")).toBe(0.001);
    expect(parseNumber("+12")).toBe(12);
    expect(parseNumber("1/0")).toBeUndefined();
    expect(parseNumber("twelve")).toBeUndefined();
    expect(parseNumber("")).toBeUndefined();
  });
});

describe("choosing a check's questions", () => {
  const bank = makeBank([
    q("on-own-1", "math.chain_rule", "math.chain_rule.m1"),
    q("on-own-2", "math.chain_rule", "math.chain_rule.m1"),
    q("on-other", "math.chain_rule", "math.chain_rule.m2"),
    q("elsewhere-own", "math.parametric_differentiation", "math.chain_rule.m1"),
    q("unrelated", "math.continuity", "math.continuity.m1"),
    q("numeric", "math.chain_rule", "math.chain_rule.m3", "numeric"),
  ]);

  it("prefers the concept and the student's own misconceptions, spreads coverage, and includes a numeric", () => {
    const picked = selectQuestions(bank, {
      concept_id: "math.chain_rule",
      misconception_ids: ["math.chain_rule.m1", "math.chain_rule.m2", "math.chain_rule.m3"],
      own: new Set(["math.chain_rule.m1"]),
      n: 4,
      seed: "s",
    }).map((x) => x.id);
    expect(picked).toHaveLength(4);
    expect(picked).not.toContain("unrelated");
    expect(picked[0]).toMatch(/^on-own/);
    expect(picked).toContain("on-other");
    expect(picked[picked.length - 1]).toBe("numeric");
  });

  it("avoids questions already seen and is deterministic per seed", () => {
    const opts = { concept_id: "math.chain_rule", misconception_ids: ["math.chain_rule.m1"], n: 2, seed: "a" };
    expect(selectQuestions(bank, opts)).toEqual(selectQuestions(bank, opts));
    const fresh = selectQuestions(bank, { ...opts, seen: new Map([["on-own-1", 1], ["on-own-2", 1]]) }).map((x) => x.id);
    expect(fresh).not.toContain("on-own-1");
    expect(fresh).not.toContain("on-own-2");
  });
});

describe("the verified question bank (data/question-bank)", () => {
  const loaded = loadQuestionBank(config.questionBankDir, graph);

  it("loads cleanly against the current graph", () => {
    expect(loaded.warnings).toEqual([]);
  });

  it("every question was verified independently, and every wrong answer maps to a real misconception", () => {
    for (const x of loaded.questions) {
      const checks = x.verification.checks;
      expect(checks.every((c) => c.passed), x.id).toBe(true);
      const cas = checks.some((c) => c.method === "cas_sympy");
      const solves = checks.filter((c) => c.method === "llm_solve").length;
      // Maths with a symbolic proof plus one solver, or two solvers otherwise.
      expect(cas ? solves >= 1 : solves >= 2, x.id).toBe(true);
      for (const o of x.options ?? []) if (!o.correct) expect(graph.misconceptions.has(o.misconception_id!), `${x.id} ${o.id}`).toBe(true);
      for (const w of x.numeric_wrong ?? []) expect(graph.misconceptions.has(w.misconception_id), x.id).toBe(true);
      expect(graph.misconceptions.has(x.target_misconception_id)).toBe(true);
    }
  });
});
