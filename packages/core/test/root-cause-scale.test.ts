import { describe, expect, it } from "vitest";
import { analyseStudent } from "../src";
import { plantStudent, randomGraph } from "./helpers/random-graph";
import { rng } from "./helpers/root-cause";

/**
 * Scale test: random valid graphs of several hundred concepts across
 * subjects, a student with planted roots plus noise, and timings.
 * Nothing here is tuned to the provisional graph or the fixtures.
 */

describe("root-cause engine at scale", () => {
  it("recovers planted roots on random 600-concept graphs, fast", () => {
    const SEEDS = 40;
    let planted = 0;
    let recovered = 0;
    let falseRoots = 0;
    let correctlyExplained = 0;
    let plantedErrors = 0;
    const times: number[] = [];
    let concepts = 0;
    let edges = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rand = rng(seed);
      const graph = randomGraph(rand);
      concepts = graph.concepts.size;
      edges = graph.stats().totals.edges;
      const s = plantStudent(graph, rand, 3, 4, 6, 6);
      const t0 = performance.now();
      const a = analyseStudent({ graph, records: s.records });
      times.push(performance.now() - t0);
      const found = new Set(a.roots.map((r) => r.concept.id));
      planted += s.planted.length;
      recovered += s.planted.filter((p) => found.has(p)).length;
      falseRoots += a.roots.filter((r) => !s.planted.includes(r.concept.id)).length;
      for (const r of a.roots) {
        if (!s.planted.includes(r.concept.id)) continue;
        correctlyExplained += r.explains.filter((e) => graph.descendantsOf(r.concept.id).has(e.anchor.id) || e.anchor.id === r.concept.id).length;
      }
      plantedErrors += s.planted.length * 4;
    }
    times.sort((a, b) => a - b);
    const summary = {
      graphs: SEEDS,
      concepts_per_graph: concepts,
      edges_last_graph: edges,
      planted_roots: planted,
      recovered_exactly: recovered,
      recall: +(recovered / planted).toFixed(3),
      false_roots_total: falseRoots,
      planted_errors_attributed: `${correctlyExplained}/${plantedErrors}`,
      ms_median: +times[Math.floor(times.length / 2)]!.toFixed(1),
      ms_max: +times[times.length - 1]!.toFixed(1),
    };
    console.log(`SCALE ${JSON.stringify(summary)}`);
    expect(recovered / planted).toBeGreaterThanOrEqual(0.85);
    expect(falseRoots / SEEDS).toBeLessThanOrEqual(0.4);
    expect(times[Math.floor(times.length / 2)]!).toBeLessThan(100);
    expect(times[times.length - 1]!).toBeLessThan(500);
  });

  it("stays fast for a heavy student (150 errors) on a 600-concept graph", () => {
    const rand = rng(99);
    const graph = randomGraph(rand);
    const s = plantStudent(graph, rand, 8, 6, 0, 30, 150);
    const t0 = performance.now();
    const a = analyseStudent({ graph, records: s.records });
    const ms = performance.now() - t0;
    const found = new Set(a.roots.map((r) => r.concept.id));
    console.log(
      `SCALE-HEAVY ${JSON.stringify({ errors: s.records.length, planted: s.planted.length, recovered: s.planted.filter((p) => found.has(p)).length, roots: a.roots.length, ms: +ms.toFixed(1) })}`,
    );
    expect(s.records.length).toBe(150);
    expect(s.planted.filter((p) => found.has(p)).length).toBeGreaterThanOrEqual(s.planted.length - 1);
    expect(ms).toBeLessThan(2000);
  });
});
