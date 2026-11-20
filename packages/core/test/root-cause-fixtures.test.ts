import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyseStudent, loadAppConfig, loadConceptGraph } from "../src";
import { ExpectedRootsSchema, loadDemoFixtures } from "../src/demo-fixtures";

/**
 * SAMPLE DATA check: run the engine on every demo student and compare with
 * the answer key written in Phase 1. Only this test reads the answer key;
 * the engine never does. Deleted with the fixtures in Phase P.
 */
const config = loadAppConfig();
const { graph } = loadConceptGraph(config.conceptGraphDir);
const demo = loadDemoFixtures(config.fixturesDir);
const answerKey = ExpectedRootsSchema.parse(
  JSON.parse(readFileSync(join(config.repoRoot, "data", "fixtures", "_answer-key", "expected-roots.json"), "utf8")),
);

describe("root-cause engine on the demo students (vs. answer key)", () => {
  for (const s of demo) {
    const key = answerKey.students[s.student.id]!;

    it(`${s.student.id}: ${key.expected_pattern.split(":")[0]}`, () => {
      const a = analyseStudent({ graph, records: s.records });
      const found = a.roots.map((r) => r.concept.id);

      // Every expected root (or an accepted alternative) is found, and nothing else is.
      for (const exp of key.expected_roots) {
        const ok = [exp.concept_id, ...exp.acceptable_alternatives];
        const root = a.roots.find((r) => ok.includes(r.concept.id));
        expect(root, `expected root ${exp.concept_id}`).toBeDefined();
        expect(root!.explains.map((e) => e.record_id).sort()).toEqual([...exp.explains_records].sort());
      }
      const allowed = key.expected_roots.flatMap((e) => [e.concept_id, ...e.acceptable_alternatives]);
      expect(found.filter((id) => !allowed.includes(id))).toEqual([]);

      // Records meant to stand alone are not pinned on a root.
      const explained = new Set(a.roots.flatMap((r) => r.explains.map((e) => e.record_id)));
      expect(key.standalone_records.filter((id) => explained.has(id))).toEqual([]);
    });
  }

  it("the conceptually strong student gets habits, led by the repeated slip, and no root", () => {
    const ananya = demo.find((s) => answerKey.students[s.student.id]!.expected_roots.length === 0)!;
    const a = analyseStudent({ graph, records: ananya.records });
    expect(a.roots).toEqual([]);
    const repeated = a.habits.find((h) => h.kind === "repeated_slip");
    expect(repeated?.records).toHaveLength(2);
    expect(a.headline).toMatch(/No single knowledge gap/);
  });
});
