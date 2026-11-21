import { describe, expect, it } from "vitest";
import {
  analyseStudent,
  buildConstellation,
  diffConstellation,
  layoutConstellation,
  loadAppConfig,
  loadConceptGraph,
  rippleHops,
  withSavedStates,
  type ConceptMasteryState,
  type ConstellationModel,
} from "../src";
import { loadDemoFixtures } from "../src/demo-fixtures";
import { randomGraph } from "./helpers/random-graph";
import { rng } from "./helpers/root-cause";

const config = loadAppConfig();
const { graph } = loadConceptGraph(config.conceptGraphDir);
const demo = loadDemoFixtures(config.fixturesDir);

function modelFor(studentId: string, mastery: ConceptMasteryState[] = []): ConstellationModel {
  const s = demo.find((d) => d.student.id === studentId)!;
  const analysis = analyseStudent({ graph, records: s.records });
  const layout = layoutConstellation(graph, s.student.subjects);
  return buildConstellation({ student_id: studentId, graph, layout, analysis, records: s.records, mastery });
}

function minDistance(positions: Record<string, { x: number; y: number }>): number {
  const pts = Object.values(positions);
  let min = Infinity;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) min = Math.min(min, Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y));
  return min;
}

describe("constellation layout", () => {
  const layout = layoutConstellation(graph, ["Mathematics", "Chemistry"]);

  it("places every concept of the chosen subjects, deterministically", () => {
    expect(Object.keys(layout.positions)).toHaveLength(graph.concepts.size);
    expect(layoutConstellation(graph, ["Mathematics", "Chemistry"])).toEqual(layout);
    expect(layout.subjects.map((s) => s.name)).toEqual(["Mathematics", "Chemistry"]);
  });

  it("keeps stars apart (readable, not a hairball)", () => {
    expect(minDistance(layout.positions)).toBeGreaterThan(7);
  });

  it("puts foundations at the core and Class 12 at the rim, each unit inside its own ring and sector", () => {
    for (const c of graph.concepts.values()) {
      const p = layout.positions[c.id]!;
      const s = layout.subjects.find((x) => x.name === c.subject)!;
      const u = layout.units.find((x) => x.id === c.unit_id)!;
      const ring = s.rings[u.ring]!;
      const r = Math.hypot(p.x - s.center.x, p.y - s.center.y);
      expect(r).toBeGreaterThanOrEqual(ring.inner);
      expect(r).toBeLessThanOrEqual(ring.outer);
      if (u.half_width < Math.PI - 0.01) {
        const a = Math.atan2(p.y - s.center.y, p.x - s.center.x);
        const off = Math.abs(Math.atan2(Math.sin(a - u.angle), Math.cos(a - u.angle)));
        expect(off).toBeLessThanOrEqual(u.half_width + 1e-6);
      }
    }
    for (const s of layout.subjects) {
      expect(s.rings[0]!.label).toMatch(/Foundations/);
      expect(s.rings[s.rings.length - 1]!.label).toBe("Class 12");
    }
  });

  it("points prerequisite threads outwards: a prerequisite is never on an outer ring", () => {
    const ringOf = (id: string) => layout.units.find((u) => u.id === graph.get(id).unit_id)!.ring;
    for (const c of graph.concepts.values()) for (const p of c.prerequisites) expect(ringOf(p)).toBeLessThanOrEqual(ringOf(c.id));
  });

  it("orders sectors so linked units face each other (threads turn far less than in a shuffled map)", () => {
    const angles = new Map(
      [...graph.concepts.values()].map((c) => {
        const p = layout.positions[c.id]!;
        const s = layout.subjects.find((x) => x.name === c.subject)!;
        return [c.id, Math.atan2(p.y - s.center.y, p.x - s.center.x)];
      }),
    );
    const meanTurn = (angle: (id: string) => number) => {
      let turn = 0;
      let edges = 0;
      for (const c of graph.concepts.values()) {
        for (const p of c.prerequisites) {
          turn += Math.abs(Math.atan2(Math.sin(angle(c.id) - angle(p)), Math.cos(angle(c.id) - angle(p))));
          edges++;
        }
      }
      return turn / edges;
    };
    // Baseline: the same angles, shuffled between concepts.
    const ids = [...angles.keys()];
    const r = rng(3);
    const shuffled = [...ids].sort(() => r() - 0.5);
    const shuffledAngle = new Map(ids.map((id, i) => [id, angles.get(shuffled[i]!)!]));
    const ours = meanTurn((id) => angles.get(id)!);
    const baseline = meanTurn((id) => shuffledAngle.get(id)!);
    expect(ours).toBeLessThan(baseline * 0.6);
  });

  it("scales to a full-size graph (600 concepts) quickly and without overlaps", () => {
    const big = randomGraph(rng(7));
    const t0 = performance.now();
    const l = layoutConstellation(big, big.subjects);
    const ms = performance.now() - t0;
    expect(Object.keys(l.positions)).toHaveLength(big.concepts.size);
    expect(minDistance(l.positions)).toBeGreaterThan(5);
    expect(ms).toBeLessThan(5000);
  });

  it("skips subjects the graph doesn't have", () => {
    expect(layoutConstellation(graph, ["Mathematics", "Physics"]).subjects.map((s) => s.name)).toEqual(["Mathematics"]);
  });
});

describe("constellation model", () => {
  it("shows a single-root student's root, mistakes and chain", () => {
    const m = modelFor("demo-riya");
    expect(m.subjects.map((s) => s.name)).toEqual(["Mathematics"]);
    const roots = m.nodes.filter((n) => n.state === "root");
    expect(roots).toHaveLength(1);
    const root = roots[0]!;
    expect(root.root_rank).toBe(1);
    expect(m.roots[0]!.id).toBe(root.id);
    expect(m.roots[0]!.error_count).toBe(8);
    // 3 one-offs + the topics the root's mistakes surfaced in.
    expect(m.counts.weak).toBeGreaterThanOrEqual(m.roots[0]!.error_count - 1);
    // Chain threads start at the root.
    const chainFromRoot = m.edges.filter((e) => e.chain && m.nodes[e.from]!.id === root.id);
    expect(chainFromRoot.length).toBeGreaterThan(0);
    // Every weak star on the chain points back to the root.
    for (const n of m.nodes.filter((x) => x.on_chain && x.id !== root.id)) expect(n.root_ids).toContain(root.id);
    // Report text is carried verbatim.
    const anyRecord = root.record_ids[0]!;
    const original = demo.find((d) => d.student.id === "demo-riya")!.records.find((r) => r.id === anyRecord)!;
    expect(m.evidence[anyRecord]!.diagnosis).toBe(original.diagnosis.text);
  });

  it("habits-only student: no roots, nothing marked weak", () => {
    const m = modelFor("demo-ananya");
    expect(m.roots).toHaveLength(0);
    expect(m.counts.root).toBe(0);
    expect(m.counts.weak).toBe(0);
  });

  it("mastering a root (from the database) lights up everything built on it", () => {
    const before = modelFor("demo-vihaan");
    const rootId = before.roots[0]!.id;
    const after = modelFor("demo-vihaan", [{ concept_id: rootId, state: "proven" }]);

    const root = after.nodes.find((n) => n.id === rootId)!;
    expect(root.state).toBe("mastered");
    expect(after.roots[0]!.mastered).toBe(true);
    const descendants = graph.descendantsOf(rootId);
    for (const n of after.nodes) expect(n.lit).toBe(descendants.has(n.id));
    // Mistakes explained only by this root are now expected to clear.
    const explained = before.nodes.filter((n) => n.state === "weak" && n.root_ids.length > 0 && n.root_ids.every((r) => r === rootId));
    expect(explained.length).toBeGreaterThan(0);
    for (const n of explained) expect(after.nodes.find((x) => x.id === n.id)!.state).toBe("learning");
    // One-offs are untouched.
    const oneOffs = before.nodes.filter((n) => n.state === "weak" && n.root_ids.length === 0);
    for (const n of oneOffs) expect(after.nodes.find((x) => x.id === n.id)!.state).toBe("weak");
    expect(after.state_key).not.toBe(before.state_key);
  });

  it("maps every mastery level", () => {
    const m = modelFor("demo-riya");
    const plain = m.nodes.find((n) => n.state === "unassessed")!.id;
    const states = (level: ConceptMasteryState["state"]) => modelFor("demo-riya", [{ concept_id: plain, state: level }]).nodes.find((n) => n.id === plain)!.state;
    expect(states("gap")).toBe("weak");
    expect(states("learning")).toBe("learning");
    expect(states("proven")).toBe("mastered");
    expect(states("retained")).toBe("mastered");
  });
});

describe("chain reaction", () => {
  it("reaches every concept built on the root, at its shortest hop distance", () => {
    const m = modelFor("demo-vihaan");
    const rootIdx = m.nodes.findIndex((n) => n.id === m.roots[0]!.id);
    const hops = rippleHops(m, rootIdx);
    const inMap = new Set(m.nodes.map((n) => n.id));
    const expected = [...graph.descendantsOf(m.roots[0]!.id)].filter((id) => inMap.has(id));
    expect(hops.size).toBe(expected.length + 1);
    expect(hops.get(rootIdx)).toBe(0);
    for (const [i, h] of hops) {
      if (i === rootIdx) continue;
      // One step further than the closest prerequisite that the light reached.
      const viaPrereqs = m.nodes[i]!.prerequisites.map((p) => hops.get(p)).filter((x): x is number => x !== undefined);
      expect(h).toBe(Math.min(...viaPrereqs) + 1);
    }
  });

  it("diff names the roots that became mastered, and nothing for unchanged models", () => {
    const before = modelFor("demo-kabir");
    const rootId = before.roots[1]!.id;
    const after = modelFor("demo-kabir", [{ concept_id: rootId, state: "proven" }]);
    const diff = diffConstellation(before, after)!;
    expect(diff.roots).toEqual([rootId]);
    expect(diff.changed.length).toBeGreaterThan(1);
    expect(diffConstellation(after, after)).toEqual({ roots: [], changed: [] });
    // Un-mastering (demo reset) is a change but not a ripple.
    expect(diffConstellation(after, before)!.roots).toEqual([]);
    expect(diffConstellation(before, modelFor("demo-riya"))).toBeUndefined();
  });

  it("rebuilds a previous visit from saved states, so the change can replay", () => {
    const before = modelFor("demo-riya");
    const after = modelFor("demo-riya", [{ concept_id: before.roots[0]!.id, state: "proven" }]);
    const saved = Object.fromEntries(before.nodes.map((n) => [n.id, { s: n.state, l: n.lit }]));
    const replay = withSavedStates(after, saved, { [before.roots[0]!.id]: false });
    expect(diffConstellation(replay, after)!.roots).toEqual([before.roots[0]!.id]);
  });
});
