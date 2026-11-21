import { describe, expect, it } from "vitest";
import {
  analyseStudent,
  buildDiagnosisView,
  chainErrorCount,
  compareQuestionRefs,
  loadAppConfig,
  loadConceptGraph,
  type ChainNode,
} from "../src";
import { DemoFixtureParser, loadDemoFixtures, SAMPLE_DATA_NOTICE } from "../src/demo-fixtures";
import { PARSE_STAGES, ReportParseError, type ParseProgress } from "../src/report-parser";

const config = loadAppConfig();
const { graph } = loadConceptGraph(config.conceptGraphDir);
const demo = loadDemoFixtures(config.fixturesDir);
const byId = (id: string) => demo.find((s) => s.student.id === id)!;

function view(id: string) {
  const s = byId(id);
  return buildDiagnosisView(analyseStudent({ graph, records: s.records }), s.records);
}

function chainIds(n: ChainNode, depth = 0): string[] {
  return [`${"  ".repeat(depth)}${n.concept.id}${n.errors.length ? ` [${n.errors.map((e) => e.evidence.record_id).join(",")}]` : ""}`, ...n.children.flatMap((c) => chainIds(c, depth + 1))];
}

describe("demo report parser (SAMPLE DATA)", () => {
  it("reports every stage in order and returns the student's records", async () => {
    const progress: ParseProgress[] = [];
    const parsed = await new DemoFixtureParser(demo).parse({ student_id: "demo-riya" }, { graph, onProgress: (p) => progress.push(p) });
    expect(progress.map((p) => p.stage)).toEqual([...PARSE_STAGES]);
    expect(parsed.records).toEqual(byId("demo-riya").records);
    expect(parsed.parser.mode).toBe("demo");
    expect(parsed.source.kind).toBe("demo_fixture");
    expect(parsed.notices).toEqual([SAMPLE_DATA_NOTICE]);
  });

  it("says plainly that pasted text was not read", async () => {
    const parsed = await new DemoFixtureParser(demo).parse({ student_id: "demo-kabir", text: "some report" }, { graph });
    expect(parsed.notices.some((n) => n.includes("was not read"))).toBe(true);
  });

  it("rejects unknown students and honours abort", async () => {
    await expect(new DemoFixtureParser(demo).parse({ student_id: "nobody" }, { graph })).rejects.toBeInstanceOf(ReportParseError);
    const ac = new AbortController();
    ac.abort();
    await expect(new DemoFixtureParser(demo).parse({ student_id: "demo-riya" }, { graph, signal: ac.signal })).rejects.toThrow();
  });
});

describe("diagnosis view", () => {
  it("Riya: one root, headline numbers match the engine summary", () => {
    const v = view("demo-riya");
    expect(v.headline).toMatchObject({ mode: "roots", fix_count: 1, explained: 8, total: 11, marks: 12 });
    expect(v.breakdown).toEqual({ roots: 8, standalone: 3, habits: 0, total: 11 });
    expect(v.standalone).toHaveLength(3);
  });

  it("every explained error lands exactly once in its root's chain, with the report's verbatim words", () => {
    for (const s of demo) {
      const a = analyseStudent({ graph, records: s.records });
      const v = buildDiagnosisView(a, s.records);
      for (const [i, root] of v.roots.entries()) {
        expect(chainErrorCount(root.chain)).toBe(a.roots[i]!.explains.length);
        const walk = (n: ChainNode): void => {
          for (const e of n.errors) {
            const rec = s.records.find((r) => r.id === e.evidence.record_id)!;
            expect(e.evidence.diagnosis).toBe(rec.diagnosis.text);
            expect(e.evidence.working?.text).toBe(rec.student_working?.text);
          }
          n.children.forEach(walk);
        };
        walk(root.chain);
      }
    }
  });

  it("Vihaan: shared path prefixes merge into one tree under the Class 9 root", () => {
    const tree = chainIds(view("demo-vihaan").roots[0]!.chain);
    expect(tree[0]).toBe("math.algebraic_identities");
    // Factorisation appears once, with every deeper topic below it.
    expect(tree.filter((l) => /^math.factorisation( |$)/.test(l.trim()))).toHaveLength(1);
    expect(tree.find((l) => l.includes("math.differentiability"))).toMatch(/^\s{10}/);
  });

  it("Ananya: no roots, so the headline is about habits", () => {
    const v = view("demo-ananya");
    expect(v.roots).toEqual([]);
    expect(v.headline).toMatchObject({ mode: "habits", explained: 10, total: 10 });
    expect(v.habits.flatMap((h) => h.items)).toHaveLength(10);
  });

  it("report panel lists every record once, exams by date, questions in numeric order", () => {
    for (const s of demo) {
      const v = view(s.student.id);
      expect(v.report.flatMap((sec) => sec.items.map((i) => i.record_id)).sort()).toEqual(s.records.map((r) => r.id).sort());
      const dates = v.report.map((sec) => sec.exam.date);
      expect([...dates].sort()).toEqual(dates);
    }
    expect(["Q11", "Q4", "Q11(b)", "Q2"].sort(compareQuestionRefs)).toEqual(["Q2", "Q4", "Q11", "Q11(b)"]);
  });

  it("refuses an analysis whose records were not passed in", () => {
    const s = byId("demo-riya");
    expect(() => buildDiagnosisView(analyseStudent({ graph, records: s.records }), [])).toThrow(/not passed in/);
  });
});
