import type { Observation, MasteryMap } from "./evidence";
import type { RootCauseParams } from "./params";

/**
 * Step 2 of the engine: choose the set of roots.
 *
 * Objective for a set S of roots:
 *   each error is assigned to the root in S that explains it most strongly;
 *   each root earns the evidence of the errors assigned to it
 *     (error weight x link strength x (1 - evidence the student knows it),
 *      repeats inside one exam discounted);
 *   each root costs `rootCost` (more if few of the topics built on it show errors), must explain >= minRecordsPerRoot errors, and
 *   must keep >= minSharedEvidence once its strongest error is set aside.
 * We maximise it with greedy addition followed by remove/swap local search.
 * Plain arithmetic over a small candidate set, so it is deterministic and fast.
 */

/** Max candidates tried in pairs when splitting a root (pairs grow quadratically). */
const SPLIT_POOL_SIZE = 25;

export interface Candidate {
  id: string;
  /** 1 - mastery evidence: the share of blame left on this concept. */
  openness: number;
  /** obs index -> link strength (only links strong enough to count as explained). */
  links: Map<number, number>;
  /** rootCost plus branchCost x share of its direct branches with no errors. */
  cost: number;
  /** Most this candidate can ever add to the objective (all its links, no discounts, minus cost). */
  upperBound: number;
}

export interface Assignment {
  root: string;
  obs: number;
  link: number;
  /** 1, or sameExamRepeatFactor for a second or later error on this root in the same exam. */
  repeat: number;
  /** weight x link x openness x repeat. */
  contribution: number;
}

export interface Selection {
  roots: string[];
  objective: number;
  assignments: Assignment[];
}

export class RootSelector {
  readonly candidates: Map<string, Candidate>;
  private readonly memo = new Map<string, Selection>();

  constructor(
    private readonly obs: Observation[],
    mastery: MasteryMap,
    private readonly params: RootCauseParams,
    quietShare: (concept: string) => number,
  ) {
    const byConcept = new Map<string, Map<number, number>>();
    obs.forEach((o, i) => {
      if (o.kind !== "evidence") return;
      for (const [concept, link] of o.links) {
        if (link.strength < params.minExplainedLink) continue;
        const m = byConcept.get(concept) ?? new Map<number, number>();
        m.set(i, link.strength);
        byConcept.set(concept, m);
      }
    });
    this.candidates = new Map();
    for (const id of [...byConcept.keys()].sort()) {
      const links = byConcept.get(id)!;
      if (links.size < params.minRecordsPerRoot) continue;
      const cost = params.rootCost + params.branchCost * quietShare(id);
      const openness = 1 - mastery.against(id);
      let total = 0;
      for (const [i, link] of links) total += obs[i]!.weight * link * openness;
      this.candidates.set(id, { id, openness, links, cost, upperBound: total - cost });
    }
  }

  /** Objective value and assignments for a set of roots. -Infinity if any root is too thin to stand. */
  evaluate(roots: readonly string[]): Selection {
    const sorted = [...roots].sort();
    const key = sorted.join("|");
    const memo = this.memo.get(key);
    if (memo) return memo;
    const result = this.compute(sorted);
    this.memo.set(key, result);
    return result;
  }

  private compute(sorted: string[]): Selection {
    const best = new Map<number, { root: string; value: number; link: number }>();
    for (const r of sorted) {
      const c = this.candidates.get(r)!;
      for (const [i, link] of c.links) {
        const value = this.obs[i]!.weight * link * c.openness;
        const prev = best.get(i);
        if (!prev || value > prev.value) best.set(i, { root: r, value, link });
      }
    }
    const perRoot = new Map<string, { i: number; value: number; link: number }[]>(sorted.map((r) => [r, []]));
    for (const [i, b] of best) perRoot.get(b.root)!.push({ i, value: b.value, link: b.link });

    let objective = 0;
    const assignments: Assignment[] = [];
    for (const r of sorted) {
      const items = perRoot.get(r)!;
      if (items.length < this.params.minRecordsPerRoot) return { roots: sorted, objective: -Infinity, assignments: [] };
      const seenExam = new Set<string>();
      items.sort((a, b) => b.value - a.value || a.i - b.i);
      let evidence = 0;
      for (const it of items) {
        const exam = this.obs[it.i]!.record.exam.id;
        const repeat = seenExam.has(exam) ? this.params.sameExamRepeatFactor : 1;
        seenExam.add(exam);
        evidence += it.value * repeat;
        assignments.push({ root: r, obs: it.i, link: it.link, repeat, contribution: it.value * repeat });
      }
      const strongest = items[0]!.value;
      if (evidence - strongest < this.params.minSharedEvidence) return { roots: sorted, objective: -Infinity, assignments: [] };
      objective += evidence - this.candidates.get(r)!.cost;
    }
    return { roots: sorted, objective, assignments };
  }

  select(): Selection {
    let current = this.evaluate([]);
    // Strongest-possible first, so the bound below can stop the add scan early.
    const ids = [...this.candidates.values()]
      .sort((a, b) => b.upperBound - a.upperBound || a.id.localeCompare(b.id))
      .map((c) => c.id);
    const improves = (s: Selection): boolean => s.objective > current.objective + 1e-9;

    for (let round = 0; round < 50; round++) {
      let bestMove: Selection | undefined;
      const consider = (roots: string[]): void => {
        const s = this.evaluate(roots);
        if (improves(s) && (!bestMove || s.objective > bestMove.objective + 1e-12)) bestMove = s;
      };
      // Add one root. Adding c raises the objective by at most c.upperBound (the roots it
      // takes errors from only lose), so stop once no remaining candidate can beat the best move.
      for (const c of ids) {
        const bound = current.objective + this.candidates.get(c)!.upperBound;
        if (bound <= (bestMove?.objective ?? current.objective) + 1e-9) break;
        if (!current.roots.includes(c)) consider([...current.roots, c]);
      }
      // Remove one root, or swap it for another candidate.
      for (const r of current.roots) {
        const rest = current.roots.filter((x) => x !== r);
        consider(rest);
        const restObjective = this.evaluate(rest).objective;
        const beats = (bound: number): boolean => restObjective + bound > (bestMove?.objective ?? current.objective) + 1e-9;
        const ub = (c: string): number => this.candidates.get(c)!.upperBound;
        // Swap only to candidates that could explain some of the same errors; an unrelated
        // swap is just a remove plus an add, which the other moves already cover.
        for (const c of this.related(current, r, 1)) if (beats(ub(c))) consider([...rest, c]);
        // Split: replace one broad root by two narrower ones that share its errors.
        // Without this, a common ancestor picked first can block two better, separate roots.
        const pool = this.related(current, r, this.params.minRecordsPerRoot).slice(0, SPLIT_POOL_SIZE);
        for (let i = 0; i < pool.length; i++) {
          for (let j = i + 1; j < pool.length; j++) {
            if (beats(ub(pool[i]!) + ub(pool[j]!))) consider([...rest, pool[i]!, pool[j]!]);
          }
        }
      }
      if (!bestMove) break;
      current = bestMove;
    }
    return current;
  }

  /** Candidates that could take over at least `minShared` of root r's errors, strongest first. */
  private related(current: Selection, r: string, minShared: number): string[] {
    const mine = current.assignments.filter((a) => a.root === r).map((a) => a.obs);
    const scored: { id: string; score: number }[] = [];
    for (const c of this.candidates.values()) {
      if (current.roots.includes(c.id)) continue;
      let score = 0;
      let count = 0;
      for (const i of mine) {
        const link = c.links.get(i);
        if (link !== undefined) {
          score += this.obs[i]!.weight * link * c.openness;
          count++;
        }
      }
      if (count >= minShared) scored.push({ id: c.id, score });
    }
    return scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).map((s) => s.id);
  }

  /** How much of root r's contribution a swap to c would keep, for each c that comes close. */
  alternatives(selection: Selection, r: string, minRatio: number): { id: string; ratio: number }[] {
    const rest = selection.roots.filter((x) => x !== r);
    const without = this.evaluate(rest).objective;
    const marginal = selection.objective - without;
    if (!(marginal > 0)) return [];
    const out: { id: string; ratio: number }[] = [];
    for (const [c, cand] of this.candidates) {
      if (selection.roots.includes(c) || cand.upperBound < minRatio * marginal) continue;
      const ratio = (this.evaluate([...rest, c]).objective - without) / marginal;
      if (ratio >= minRatio) out.push({ id: c, ratio });
    }
    return out.sort((a, b) => b.ratio - a.ratio || a.id.localeCompare(b.id)).slice(0, 2);
  }
}
