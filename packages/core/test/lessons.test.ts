import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkExplainerStructure,
  checkRecapStructure,
  loadAppConfig,
  loadConceptGraph,
  loadLessons,
  prettyWorking,
  recapFor,
  recapModeFor,
  recapSourceHash,
  type ErrorRecord,
  type MistakeRecap,
} from "../src";
import { loadDemoFixtures } from "../src/demo-fixtures";

const config = loadAppConfig();
const { graph } = loadConceptGraph(config.conceptGraphDir);
const demo = loadDemoFixtures(config.fixturesDir);
const records = demo.flatMap((s) => s.records);
const byId = new Map(records.map((r) => [r.id, r]));
const withWorking = records.find((r) => r.id === "demo-riya.ut1.q7")!;
const withoutWorking = records.find((r) => r.id === "demo-riya.ut1.q11")!;

function recap(r: ErrorRecord, over: Partial<MistakeRecap> = {}): MistakeRecap {
  return {
    schema_version: "1.0",
    record_id: r.id,
    source_hash: recapSourceHash(r),
    subject: r.exam.subject,
    ...(r.misconception ? { misconception_id: r.misconception.misconception_id } : {}),
    mode: recapModeFor(r),
    wrong: r.student_working
      ? {
          format: "plain",
          lines: [
            { text: "d/dx [sin(x^2)]", wrong: false },
            { text: " = cos(x^2)", wrong: true, mark: "cos(x^2)" },
          ],
          note: "n",
        }
      : { format: "latex", lines: [{ text: "$\\frac{dy}{dx} = \\frac{1}{\\cos x}$", wrong: true }], note: "n" },
    fix: { lines: [{ text: "$2x\\cos(x^2)$" }] },
    key_idea: "k",
    verification: { status: "verified", checks: [{ method: "structure", passed: true, detail: "t" }], verified_at: "x" },
    provenance: { generator: { provider: "t", model: "t" }, generated_at: "x", prompt_version: "t" },
    ...over,
  };
}

describe("prettyWorking (display only)", () => {
  it("swaps notation without changing what was written", () => {
    expect(prettyWorking("d/dx [sin(x^2)] = cos(x^2)")).toBe("d/dx [sin(x²)] = cos(x²)");
    expect(prettyWorking("d/dx sin^-1(2x) = 1/sqrt(1 - 4x^2)")).toBe("d/dx sin⁻¹(2x) = 1/√(1 - 4x²)");
    expect(prettyWorking("(3a sin^2 theta)/(3a cos^2 theta) = tan^2 theta")).toBe("(3a sin² θ)/(3a cos² θ) = tan² θ");
    expect(prettyWorking("3pi/4")).toBe("3π/4");
  });
  it("leaves powers it can't superscript alone", () => {
    expect(prettyWorking("e^(x^2)")).toBe("e^(x²)");
    expect(prettyWorking("pivot spin")).toBe("pivot spin");
  });
});

describe("recap structure checks", () => {
  it("accepts the quote cut into lines", () => {
    expect(checkRecapStructure(recap(withWorking), withWorking)).toEqual([]);
    expect(checkRecapStructure(recap(withoutWorking), withoutWorking)).toEqual([]);
  });

  it("rejects working that isn't exactly the report's quote", () => {
    const r = recap(withWorking);
    const altered = { ...r, wrong: { ...r.wrong, lines: [{ text: "d/dx [sin(x^2)]", wrong: false }, { text: " = cos(x^2) * 1", wrong: true, mark: "cos(x^2)" }] } };
    expect(checkRecapStructure(altered, withWorking).join(" ")).toMatch(/do not reproduce the quoted working/);
    const reordered = { ...r, wrong: { ...r.wrong, lines: [...r.wrong.lines].reverse() } };
    expect(checkRecapStructure(reordered, withWorking).join(" ")).toMatch(/not the next part of the quote/);
  });

  it("rejects a mark that isn't in its line, or a wrong line without a mark", () => {
    const r = recap(withWorking);
    const badMark = { ...r, wrong: { ...r.wrong, lines: [r.wrong.lines[0]!, { text: " = cos(x^2)", wrong: true, mark: "2x" }] } };
    expect(checkRecapStructure(badMark, withWorking).join(" ")).toMatch(/does not occur/);
    const noMark = { ...r, wrong: { ...r.wrong, lines: [r.wrong.lines[0]!, { text: " = cos(x^2)", wrong: true }] } };
    expect(checkRecapStructure(noMark, withWorking).join(" ")).toMatch(/no marked part/);
  });

  it("never lets invented working pass as the student's own", () => {
    // A record without quoted working can only get a typical step.
    const fake = recap(withoutWorking, { mode: "student_working", wrong: { format: "plain", lines: [{ text: "1/cos x", wrong: true, mark: "1/cos x" }], note: "n" } });
    expect(checkRecapStructure(fake, withoutWorking).join(" ")).toMatch(/mode must be typical_step/);
    // And a record with quoted working must use it.
    const typical = recap(withWorking, { mode: "typical_step", wrong: { format: "latex", lines: [{ text: "$\\cos(x^2)$", wrong: true }], note: "n" } });
    expect(checkRecapStructure(typical, withWorking).join(" ")).toMatch(/mode must be student_working/);
  });

  it("ignores a recap once its record changes", () => {
    const lib = { recaps: new Map([[withWorking.id, recap(withWorking)]]) };
    expect(recapFor(lib, withWorking)).toBeDefined();
    const changed = { ...withWorking, diagnosis: { ...withWorking.diagnosis, text: withWorking.diagnosis.text + " (re-parsed)" } };
    expect(recapFor(lib, changed)).toBeUndefined();
  });
});

describe("explainer structure checks", () => {
  const m = [...graph.misconceptions.values()][0]!;
  const steps = [
    { kind: "wrong" as const, say: "s" },
    { kind: "why" as const, say: "s" },
    { kind: "rule" as const, say: "s" },
    { kind: "example" as const, say: "s" },
  ];
  it("needs to start from the wrong step and state the idea", () => {
    expect(checkExplainerStructure({ misconception_id: m.id, concept_id: m.concept_id, steps }, graph)).toEqual([]);
    expect(checkExplainerStructure({ misconception_id: m.id, concept_id: m.concept_id, steps: [...steps].reverse() }, graph).length).toBeGreaterThan(0);
    expect(checkExplainerStructure({ misconception_id: "nope.m1", concept_id: m.concept_id, steps }, graph).join(" ")).toMatch(/unknown misconception/);
  });
});

describe("the cached lesson library (data/fixtures/demo-recaps, data/explainers)", () => {
  const lib = loadLessons(config, graph);
  const files = (dir: string) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".json") && !f.split(/[\\/]/).pop()!.startsWith("_")) : []);

  it("loads every file without warnings", () => {
    expect(lib.warnings).toEqual([]);
    expect(lib.recaps.size).toBe(files(config.recapsDir).length);
    expect(lib.explainers.size).toBe(files(config.explainersDir).length);
  });

  it("every recap is current, faithful to its record and fully verified", () => {
    for (const r of lib.recaps.values()) {
      const record = byId.get(r.record_id);
      expect(record, r.record_id).toBeDefined();
      expect(recapFor(lib, record!), `${r.record_id} is stale`).toBe(r);
      expect(checkRecapStructure(r, record!), r.record_id).toEqual([]);
      const methods = r.verification.checks.filter((c) => c.passed).map((c) => c.method);
      expect(methods, r.record_id).toContain("llm_review");
      if (r.subject === "Mathematics") expect(methods, r.record_id).toContain("cas_sympy");
      expect(r.verification.checks.every((c) => c.passed), r.record_id).toBe(true);
      expect(r.provenance.reviewer?.model, r.record_id).not.toBe(r.provenance.generator.model);
      expect(r.provenance.sample_data, r.record_id).toBe(true);
    }
  });

  it("every explainer is for a graph misconception and fully verified", () => {
    for (const e of lib.explainers.values()) {
      expect(checkExplainerStructure(e, graph), e.misconception_id).toEqual([]);
      const methods = e.verification.checks.map((c) => c.method);
      expect(methods, e.misconception_id).toContain("llm_review");
      if (e.subject === "Mathematics") expect(methods, e.misconception_id).toContain("cas_sympy");
      expect(e.verification.checks.every((c) => c.passed), e.misconception_id).toBe(true);
      expect(e.provenance.reviewer?.model).not.toBe(e.provenance.generator.model);
    }
  });

  it("explainer files sit at <subject>/<misconception_id>.json", () => {
    for (const e of lib.explainers.values()) expect(existsSync(join(config.explainersDir, e.subject.toLowerCase(), `${e.misconception_id}.json`))).toBe(true);
  });
});
