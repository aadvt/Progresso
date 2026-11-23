import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkRecordAgainstGraph, loadAppConfig, loadConceptGraph } from "../src";
import { ExpectedRootsSchema, FixtureError, loadDemoFixtures, parseFixtureFile } from "../src/demo-fixtures";

const config = loadAppConfig();
const { graph } = loadConceptGraph(config.conceptGraphDir);
const demo = loadDemoFixtures(config.fixturesDir);
const answerKey = ExpectedRootsSchema.parse(
  JSON.parse(readFileSync(join(config.repoRoot, "data", "fixtures", "_answer-key", "expected-roots.json"), "utf8")),
);

describe("demo fixtures", () => {
  it("loads 3-4 demo students, all labelled as sample data", () => {
    expect(demo.length).toBeGreaterThanOrEqual(3);
    expect(demo.length).toBeLessThanOrEqual(4);
    for (const s of demo) {
      expect(s.student.display_name).toMatch(/sample/i);
      expect(s.records.every((r) => r.provenance.kind === "demo_fixture" && r.provenance.sample_data)).toBe(true);
    }
  });

  it("every record's concept and misconception ids exist in the graph", () => {
    const issues = demo.flatMap((s) => s.records).flatMap((r) => checkRecordAgainstGraph(r, graph));
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("varies like real reports will: with/without working, with/without marks, unmapped, several error types", () => {
    const records = demo.flatMap((s) => s.records);
    expect(records.some((r) => r.student_working)).toBe(true);
    expect(records.some((r) => !r.student_working)).toBe(true);
    expect(records.some((r) => r.marks)).toBe(true);
    expect(records.some((r) => !r.marks)).toBe(true);
    expect(records.some((r) => r.concepts.length === 0)).toBe(true);
    expect(new Set(records.map((r) => r.error_type)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(records.map((r) => r.exam.subject))).toEqual(new Set(["Mathematics", "Chemistry"]));
  });

  it("rejects a malformed fixture", () => {
    const good = readFileSync(join(config.fixturesDir, readdirSync(config.fixturesDir)[0]!), "utf8");
    const noLabel = JSON.parse(good);
    noLabel.sample_data = false;
    expect(() => parseFixtureFile("x.json", JSON.stringify(noLabel))).toThrow(FixtureError);
    const badExam = JSON.parse(good);
    badExam.records[0].exam_id = "nope";
    expect(() => parseFixtureFile("x.json", JSON.stringify(badExam))).toThrow(/unknown exam/);
  });
});

describe("answer key (expected roots)", () => {
  it("covers every demo student and every record exactly once", () => {
    expect(Object.keys(answerKey.students).sort()).toEqual(demo.map((s) => s.student.id).sort());
    for (const s of demo) {
      const key = answerKey.students[s.student.id]!;
      const listed = [...key.expected_roots.flatMap((r) => r.explains_records), ...key.standalone_records];
      expect(listed.sort(), s.student.id).toEqual(s.records.map((r) => r.id).sort());
    }
  });

  it("names roots that exist in the graph and are ancestors of (or equal to) the concepts they explain", () => {
    for (const s of demo) {
      for (const root of answerKey.students[s.student.id]!.expected_roots) {
        expect(graph.has(root.concept_id), root.concept_id).toBe(true);
        root.acceptable_alternatives.forEach((a) => expect(graph.has(a), a).toBe(true));
        for (const recordId of root.explains_records) {
          const record = s.records.find((r) => r.id === recordId)!;
          const reaches = record.concepts.some(
            (c) => c.concept_id === root.concept_id || graph.ancestorsOf(c.concept_id).has(root.concept_id),
          );
          expect(reaches, `${recordId} should trace to ${root.concept_id}`).toBe(true);
        }
      }
    }
  });

  it("is never imported by application source code", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          // Build output and test-results aren't source; skipping them also keeps this fast.
          if (!["node_modules", "test", ".next", "test-results", "playwright-report"].includes(name)) walk(p);
        } else if (/\.(ts|tsx|js)$/.test(name) && /expected-roots|_answer-key/.test(readFileSync(p, "utf8"))) {
          offenders.push(p);
        }
      }
    };
    for (const root of ["packages", "apps"]) {
      try {
        walk(join(config.repoRoot, root));
      } catch {
        // apps/ may be empty in Phase 1
      }
    }
    expect(offenders).toEqual([]);
  }, 30_000);
});
