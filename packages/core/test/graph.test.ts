import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildConceptGraph, GraphValidationError, loadAppConfig, loadConceptGraph } from "../src";

const here = import.meta.dirname;
const TINY = join(here, "fixtures-graphs", "tiny");
const BROKEN = join(here, "fixtures-graphs", "broken");

const unit = { id: "u", name: "U", class: 11, board_marks: 1 };
const concept = (id: string, prerequisites: string[] = [], extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  class: 11,
  unit_id: "u",
  chapter: "c",
  prerequisites,
  aliases: [],
  misconceptions: [],
  ...extra,
});
const file = (concepts: unknown[], subject = "S", units: unknown[] = [unit]) => ({
  name: `${subject}.json`,
  text: JSON.stringify({ subject, syllabus_source: "test", units, concepts }),
});

function errorsOf(files: { name: string; text: string }[]): string[] {
  try {
    buildConceptGraph(files);
  } catch (e) {
    if (e instanceof GraphValidationError) return e.errors.map((x) => x.message);
    throw e;
  }
  throw new Error("expected the graph to be rejected");
}

describe("graph loading", () => {
  it("loads a valid graph and answers structural queries", () => {
    const { graph, warnings } = loadConceptGraph(TINY);
    expect(warnings).toEqual([]);
    expect(graph.concepts.size).toBe(4);
    expect(graph.roots().map((c) => c.id).sort()).toEqual(["x.root", "x.side"]);
    expect([...graph.ancestorsOf("x.top")].sort()).toEqual(["x.mid", "x.root", "x.side"]);
    expect([...graph.descendantsOf("x.root")].sort()).toEqual(["x.mid", "x.top"]);
    expect(graph.depthOf("x.top")).toBe(2);
    expect(graph.deepestChainTo("x.top")).toEqual(["x.root", "x.mid", "x.top"]);
    expect(graph.misconceptions.get("x.root.m1")?.concept_id).toBe("x.root");
    expect(graph.findByName("The Base")?.id).toBe("x.root");
    const order = graph.topologicalOrder();
    expect(order.indexOf("x.root")).toBeLessThan(order.indexOf("x.mid"));
    expect(order.indexOf("x.mid")).toBeLessThan(order.indexOf("x.top"));
  });

  it("fingerprint is stable and changes with content", () => {
    const a = buildConceptGraph([file([concept("a")])]).graph.fingerprint;
    const b = buildConceptGraph([file([concept("a")])]).graph.fingerprint;
    const c = buildConceptGraph([file([concept("a", [], { name: "renamed" })])]).graph.fingerprint;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("graph validation rejects broken graphs", () => {
  it("rejects the deliberately broken graph on disk and reports every fault", () => {
    expect(() => loadConceptGraph(BROKEN)).toThrow(GraphValidationError);
    try {
      loadConceptGraph(BROKEN);
    } catch (e) {
      const messages = (e as GraphValidationError).errors.map((x) => x.message).join("\n");
      expect(messages).toMatch(/missing prerequisite id "t\.does_not_exist"/);
      expect(messages).toMatch(/duplicate concept id/);
      expect(messages).toMatch(/unknown unit_id "t\.no_such_unit"/);
      expect(messages).toMatch(/prerequisite cycle: t\.a -> t\.c -> t\.b -> t\.a/);
    }
  });

  it("rejects a cycle", () => {
    const errors = errorsOf([file([concept("a", ["b"]), concept("b", ["a"])])]);
    expect(errors.some((m) => m.startsWith("prerequisite cycle"))).toBe(true);
  });

  it("rejects a self-prerequisite", () => {
    expect(errorsOf([file([concept("a", ["a"])])])).toContain("concept lists itself as a prerequisite");
  });

  it("rejects missing prerequisite ids", () => {
    expect(errorsOf([file([concept("a", ["ghost"])])])).toContain('missing prerequisite id "ghost"');
  });

  it("rejects duplicate ids across files, including misconception ids", () => {
    const m = { id: "a.m1", description: "x" };
    const errors = errorsOf([
      file([concept("a", [], { misconceptions: [m], unit_id: "u1" })], "S1", [{ ...unit, id: "u1" }]),
      file([concept("a", [], { unit_id: "u2" }), concept("b", [], { misconceptions: [m], unit_id: "u2" })], "S2", [{ ...unit, id: "u2" }]),
    ]);
    expect(errors).toContain("duplicate concept id (also defined in S1.json)");
    expect(errors).toContain("duplicate misconception id (also defined in S1.json)");
  });

  it("rejects schema violations such as a misspelt key", () => {
    const bad = { ...concept("a"), prerequisite: [] } as Record<string, unknown>;
    delete bad.prerequisites;
    const errors = errorsOf([file([bad])]);
    expect(errors.join("\n")).toMatch(/prerequisites/);
  });

  it("rejects invalid JSON and an empty directory", () => {
    expect(errorsOf([{ name: "bad.json", text: "{ nope" }])[0]).toMatch(/invalid JSON/);
    expect(() => loadConceptGraph(join(here, "does-not-exist"))).toThrow(/not found/);
  });

  it("rejects a concept whose unit belongs to another subject", () => {
    const errors = errorsOf([
      { name: "A.json", text: JSON.stringify({ subject: "A", syllabus_source: "t", units: [{ ...unit, id: "ua" }], concepts: [{ ...concept("a"), unit_id: "ub" }] }) },
      { name: "B.json", text: JSON.stringify({ subject: "B", syllabus_source: "t", units: [{ ...unit, id: "ub" }], concepts: [{ ...concept("b"), unit_id: "ub" }] }) },
    ]);
    expect(errors).toContain('unit_id "ub" belongs to another subject');
  });
});

describe("provisional graph", () => {
  const config = loadAppConfig();
  const { graph, warnings } = loadConceptGraph(config.conceptGraphDir);

  it("is read from the configured directory and validates", () => {
    expect(config.conceptGraphDir.replace(/\\/g, "/")).toMatch(/data\/concept-graph/);
    expect(warnings).toEqual([]);
    expect(graph.subjects).toEqual(["Chemistry", "Mathematics"]);
  });

  it("covers the required slice", () => {
    const has = (id: string) => expect(graph.has(id), id).toBe(true);
    ["math.chain_rule", "math.composite_functions", "math.integration_substitution", "math.trig_multiple_angles", "math.algebraic_identities"].forEach(has);
    ["chem.inductive_effect", "chem.resonance_effect", "chem.carbocation_stability", "chem.sn1_mechanism", "chem.electrophilic_aromatic_substitution"].forEach(has);
    // Foundations below Class 11 exist where they are the real root.
    expect(graph.list("Mathematics").some((c) => c.class < 11)).toBe(true);
    expect(graph.list("Chemistry").some((c) => c.class < 11)).toBe(true);
    // Calculus reaches all the way down to pre-Class-11 algebra.
    expect(graph.ancestorsOf("math.partial_fractions").has("math.algebraic_identities")).toBe(true);
  });

  it("is substantial in each subject", () => {
    for (const s of graph.stats().subjects) {
      expect(s.concepts, s.subject).toBeGreaterThanOrEqual(40);
      expect(s.maxDepth, s.subject).toBeGreaterThanOrEqual(6);
    }
  });
});
