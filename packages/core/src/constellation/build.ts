/**
 * Joins the layout, the root-cause analysis, the report's records and the
 * student's mastery (from the database) into the constellation model.
 *
 * Pure. The diagnosis stays the engine's: this only decides how each star
 * looks. Mastery is an overlay: a mastered root stays in the analysis (the
 * report said so), it is just drawn as fixed, and everything built on it lights up.
 */
import type { ErrorRecord } from "../error-record/schema";
import type { ConceptGraph } from "../graph/graph";
import { reportEvidence, type ReportEvidence } from "../diagnosis-view";
import { boardMarksDependent } from "../root-cause/engine";
import type { RootCauseAnalysis } from "../root-cause/types";
import type {
  ConceptMasteryState,
  ConstellationEdge,
  ConstellationLayout,
  ConstellationModel,
  ConstellationNode,
  ConstellationRoot,
  MasteryLevel,
  StarState,
} from "./types";
import { STAR_STATES } from "./types";

export interface BuildConstellationInput {
  student_id: string;
  graph: ConceptGraph;
  layout: ConstellationLayout;
  analysis: RootCauseAnalysis;
  records: readonly ErrorRecord[];
  mastery?: readonly ConceptMasteryState[];
}

const MASTERED: ReadonlySet<MasteryLevel> = new Set(["proven", "retained"]);

export function buildConstellation(input: BuildConstellationInput): ConstellationModel {
  const { graph, layout, analysis, records } = input;
  const mastery = new Map((input.mastery ?? []).map((m) => [m.concept_id, m.state]));

  const ids = Object.keys(layout.positions)
    .filter((id) => graph.has(id))
    .sort((a, b) => {
      const sa = layout.subjects.findIndex((s) => s.name === graph.get(a).subject);
      const sb = layout.subjects.findIndex((s) => s.name === graph.get(b).subject);
      return sa - sb || a.localeCompare(b);
    });
  const index = new Map(ids.map((id, i) => [id, i]));

  // ---- evidence and per-concept records
  const recordIds = new Map<string, string[]>();
  for (const r of records) {
    for (const c of r.concepts) {
      if (!index.has(c.concept_id)) continue;
      const list = recordIds.get(c.concept_id) ?? [];
      if (!list.includes(r.id)) list.push(r.id);
      recordIds.set(c.concept_id, list);
    }
  }
  const evidence: Record<string, ReportEvidence> = {};
  for (const r of records) evidence[r.id] = reportEvidence(r);

  // ---- what the engine found
  const errorCount = new Map<string, number>();
  const marks = new Map<string, number>();
  const rootIdsOf = new Map<string, Set<string>>();
  const onChain = new Set<string>();
  const chainPairs = new Set<string>();
  const addError = (id: string, m: number) => {
    errorCount.set(id, (errorCount.get(id) ?? 0) + 1);
    marks.set(id, (marks.get(id) ?? 0) + m);
  };
  for (const root of analysis.roots) {
    for (const e of root.explains) {
      const path = e.tested_path ?? e.path;
      path.forEach((c, i) => {
        onChain.add(c.id);
        const set = rootIdsOf.get(c.id) ?? new Set<string>();
        set.add(root.concept.id);
        rootIdsOf.set(c.id, set);
        const prev = path[i - 1];
        if (prev) chainPairs.add(`${prev.id}>${c.id}`);
      });
      const surfaced = e.tested ?? path[path.length - 1];
      if (surfaced) addError(surfaced.id, e.marks_lost.value);
    }
  }
  for (const s of analysis.standalone) if (s.concept) addError(s.concept.id, s.marks_lost.value);

  const rootRank = new Map(analysis.roots.map((r) => [r.concept.id, r.rank]));
  const rootMastered = (id: string) => MASTERED.has(mastery.get(id) as MasteryLevel);
  const lit = new Set<string>();
  for (const r of analysis.roots) {
    if (!rootMastered(r.concept.id)) continue;
    for (const d of graph.descendantsOf(r.concept.id)) lit.add(d);
  }

  const stateOf = (id: string): StarState => {
    const m = mastery.get(id);
    if (m && MASTERED.has(m)) return "mastered";
    if (m === "learning") return "learning";
    if (rootRank.has(id)) return "root";
    if ((errorCount.get(id) ?? 0) > 0) {
      const roots = [...(rootIdsOf.get(id) ?? [])];
      // Every root behind these mistakes is fixed: they are expected to clear.
      if (roots.length > 0 && roots.every(rootMastered)) return "learning";
      return "weak";
    }
    if (m === "gap") return "weak";
    return "unassessed";
  };

  const nodes: ConstellationNode[] = ids.map((id) => {
    const c = graph.get(id);
    const pos = layout.positions[id]!;
    const m = mastery.get(id);
    const rank = rootRank.get(id);
    return {
      id,
      name: c.name,
      subject: c.subject,
      unit_id: c.unit_id,
      class: c.class,
      chapter: c.chapter,
      x: pos.x,
      y: pos.y,
      h: pos.h,
      state: stateOf(id),
      lit: lit.has(id),
      on_chain: onChain.has(id),
      ...(m ? { mastery: m } : {}),
      record_ids: recordIds.get(id) ?? [],
      error_count: errorCount.get(id) ?? 0,
      marks_lost: Math.round((marks.get(id) ?? 0) * 10) / 10,
      root_ids: [...(rootIdsOf.get(id) ?? [])].sort((a, b) => (rootRank.get(a) ?? 0) - (rootRank.get(b) ?? 0)),
      ...(rank !== undefined ? { root_rank: rank } : {}),
      downstream_count: graph.descendantsOf(id).size,
      board_marks_dependent: boardMarksDependent(graph, id),
      prerequisites: c.prerequisites.filter((p) => index.has(p)).map((p) => index.get(p)!),
      dependents: graph
        .dependentsOf(id)
        .filter((d) => index.has(d))
        .map((d) => index.get(d)!),
    };
  });

  const edges: ConstellationEdge[] = [];
  nodes.forEach((n, to) => {
    for (const from of n.prerequisites) edges.push({ from, to, chain: chainPairs.has(`${nodes[from]!.id}>${n.id}`) });
  });

  const roots: ConstellationRoot[] = analysis.roots
    .filter((r) => index.has(r.concept.id))
    .map((r) => ({
      id: r.concept.id,
      rank: r.rank,
      name: r.concept.name,
      subject: r.concept.subject,
      class: r.concept.class,
      mastered: rootMastered(r.concept.id),
      explanation: r.explanation,
      error_count: r.explains.length,
      exam_count: r.exam_ids.length,
      marks_lost: r.marks.lost,
      marks_estimated: r.marks.estimated_part > 0,
      downstream_count: [...graph.descendantsOf(r.concept.id)].filter((d) => index.has(d)).length,
      board_marks_dependent: r.marks.board_marks_dependent,
      record_ids: r.explains.map((e) => e.record_id),
    }));

  const counts = Object.fromEntries(STAR_STATES.map((s) => [s, 0])) as Record<StarState, number>;
  for (const n of nodes) counts[n.state]++;

  return {
    student_id: input.student_id,
    graph_fingerprint: layout.graph_fingerprint,
    subjects: layout.subjects,
    units: layout.units,
    nodes,
    edges,
    roots,
    evidence,
    counts,
    bounds: layout.bounds,
    state_key: stateKey(nodes),
  };
}

/** A short fingerprint of every star's state, so clients notice any change. */
export function stateKey(nodes: readonly Pick<ConstellationNode, "id" | "state" | "lit">[]): string {
  let h = 0x811c9dc5;
  for (const n of nodes) {
    const s = `${n.id}:${n.state}:${n.lit ? 1 : 0};`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(36);
}
