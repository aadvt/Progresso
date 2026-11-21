/**
 * The chain reaction: when a root is mastered, light travels outwards along the
 * prerequisite threads to everything built on it. Browser-safe helpers shared
 * by the 3D scene and the 2D fallback.
 */
import type { ConstellationModel, StarState } from "./types";

/** Hop distance from the root (0) to every concept that builds on it, by index. */
export function rippleHops(model: Pick<ConstellationModel, "nodes">, rootIndex: number): Map<number, number> {
  const hops = new Map<number, number>([[rootIndex, 0]]);
  let frontier = [rootIndex];
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const i of frontier) {
      for (const d of model.nodes[i]?.dependents ?? []) {
        if (hops.has(d)) continue;
        hops.set(d, hops.get(i)! + 1);
        next.push(d);
      }
    }
    frontier = next;
  }
  return hops;
}

export interface RippleChange {
  /** Roots that became mastered, in rank order. */
  roots: string[];
  /** Every star whose look changed. */
  changed: { id: string; from: StarState; to: StarState; litFrom: boolean; litTo: boolean }[];
}

/**
 * What changed between two models of the same student and graph. Roots that
 * became mastered get a ripple; other changes are applied as quiet fades.
 * Returns undefined when the models can't be compared (different graph or student).
 */
export function diffConstellation(prev: ConstellationModel, next: ConstellationModel): RippleChange | undefined {
  if (prev.student_id !== next.student_id || prev.graph_fingerprint !== next.graph_fingerprint) return undefined;
  if (prev.state_key === next.state_key) return { roots: [], changed: [] };
  const before = new Map(prev.nodes.map((n) => [n.id, n]));
  const changed: RippleChange["changed"] = [];
  for (const n of next.nodes) {
    const b = before.get(n.id);
    if (!b) continue;
    if (b.state !== n.state || b.lit !== n.lit) changed.push({ id: n.id, from: b.state, to: n.state, litFrom: b.lit, litTo: n.lit });
  }
  const roots = next.roots
    .filter((r) => r.mastered && !prev.roots.find((p) => p.id === r.id)?.mastered)
    .sort((a, b) => a.rank - b.rank)
    .map((r) => r.id);
  return { roots, changed };
}

/** Rebuild a previous model from a saved map of states (for "since your last visit"). */
export function withSavedStates(
  model: ConstellationModel,
  saved: Record<string, { s: StarState; l: boolean }>,
  savedRoots: Record<string, boolean>,
): ConstellationModel {
  const nodes = model.nodes.map((n) => {
    const s = saved[n.id];
    return s ? { ...n, state: s.s, lit: s.l } : n;
  });
  return {
    ...model,
    nodes,
    roots: model.roots.map((r) => (r.id in savedRoots ? { ...r, mastered: savedRoots[r.id]! } : r)),
    state_key: `saved:${model.state_key}`,
  };
}

export const STATE_LABEL: Record<StarState, string> = {
  root: "Root gap",
  weak: "Mistakes here",
  learning: "In progress",
  mastered: "Mastered",
  unassessed: "Not assessed yet",
};
