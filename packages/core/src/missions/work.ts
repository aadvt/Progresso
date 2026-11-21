/**
 * From diagnosis to work: which learning missions the student needs, in what
 * order. Pure; re-run on every change, so the plan re-flows by construction.
 *
 * Order:
 *  1. Blocks: each root (all of its missions), then each one-off conceptual
 *     gap. Roots go highest marks-per-study-hour first, except that a root
 *     never comes before another root it is built on (deepest root first).
 *     One-off gaps follow, also by marks per hour: fixing a root is the lever.
 *  2. Inside a root: re-learn the root (gate), then apply it in each topic
 *     where the mistakes surfaced, nearest topics first (prerequisite order).
 *
 * Progress (mastery and past missions) removes finished work: a gate passed
 * early drops the remaining learn missions for that concept; a failed last
 * attempt adds one more go (up to maxRetries, then one last flagged go, then
 * the concept is parked for a teacher). A concept whose missions had no
 * verified questions to check counts as studied once its missions are done.
 */
import type { ErrorRecord } from "../error-record/schema";
import type { ConceptGraph } from "../graph/graph";
import type { RootCauseAnalysis, RootFinding } from "../root-cause/types";
import { isMastered } from "./mastery";
import { DEFAULT_MISSION_PARAMS, type MissionParams } from "./params";
import type { ProgressState, WorkItem } from "./types";

const SLIP_TYPES = new Set(["careless", "calculation", "notation"]);

interface Target {
  kind: "learn" | "apply";
  concept_id: string;
  root_id?: string;
  record_ids: string[];
  misconception_ids: string[];
  planned: number;
  reason: string;
}

interface Block {
  id: string;
  priority: number;
  root_id?: string;
  targets: Target[];
}

function recordMisconceptions(records: readonly ErrorRecord[], ids: readonly string[]): string[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  const out: string[] = [];
  for (const id of ids) {
    const m = byId.get(id)?.misconception?.misconception_id;
    if (m && !out.includes(m)) out.push(m);
  }
  return out;
}

/** The root's own misconceptions first (those the report saw), then the rest of the concept's. */
function rootMisconceptions(graph: ConceptGraph, root: RootFinding): string[] {
  const own = root.misconceptions.filter((m) => graph.has(root.concept.id) && graph.get(root.concept.id).misconceptions.some((x) => x.id === m.id)).map((m) => m.id);
  const all = graph.has(root.concept.id) ? graph.get(root.concept.id).misconceptions.map((m) => m.id) : [];
  return [...new Set([...own, ...all])];
}

function rootBlock(graph: ConceptGraph, records: readonly ErrorRecord[], root: RootFinding, params: MissionParams): Block {
  const rootId = root.concept.id;
  const learnCount = Math.max(1, Math.min(params.maxLearnMissions, Math.round(root.missions * params.learnShare)));

  // Topics where the mistakes surfaced (the tested topic), with their records, marks and distance from the root.
  const symptoms = new Map<string, { records: string[]; marks: number; hops: number }>();
  const onRoot: string[] = [];
  for (const e of root.explains) {
    const at = e.tested?.id ?? e.anchor.id;
    if (at === rootId) {
      onRoot.push(e.record_id);
      continue;
    }
    const s = symptoms.get(at) ?? { records: [], marks: 0, hops: e.tested_path ? e.tested_path.length - 1 : e.hops };
    s.records.push(e.record_id);
    s.marks += e.marks_lost.value;
    symptoms.set(at, s);
  }
  const applyBudget = Math.max(0, root.missions - learnCount);
  const byNearness = [...symptoms.entries()]
    .sort((a, b) => b[1].marks - a[1].marks || a[0].localeCompare(b[0]))
    .slice(0, Math.min(applyBudget, symptoms.size))
    .sort((a, b) => a[1].hops - b[1].hops || b[1].marks - a[1].marks || a[0].localeCompare(b[0]));
  // Prerequisite order inside the block: a topic never comes before one it builds on; nearest to the root first otherwise.
  const chosen: typeof byNearness = [];
  const left = [...byNearness];
  while (left.length > 0) {
    const i = left.findIndex(([id]) => !left.some(([other]) => other !== id && graph.has(id) && graph.ancestorsOf(id).has(other)));
    chosen.push(...left.splice(i >= 0 ? i : 0, 1));
  }

  const allRecords = root.explains.map((e) => e.record_id);
  const misconceptions = rootMisconceptions(graph, root);
  const targets: Target[] = [
    {
      kind: "learn",
      concept_id: rootId,
      root_id: rootId,
      // The recap of a root covers the mistakes on the root itself first, then the rest.
      record_ids: [...onRoot, ...allRecords.filter((r) => !onRoot.includes(r))],
      misconception_ids: misconceptions,
      planned: learnCount,
      reason: `Root gap ${root.rank}: explains ${root.explains.length} of your mistakes.`,
    },
  ];
  for (const [conceptId, s] of chosen) {
    const own = recordMisconceptions(records, s.records);
    const conceptOwn = graph.has(conceptId) ? graph.get(conceptId).misconceptions.map((m) => m.id) : [];
    targets.push({
      kind: "apply",
      concept_id: conceptId,
      root_id: rootId,
      record_ids: s.records,
      misconception_ids: [...new Set([...own, ...misconceptions.slice(0, 1), ...conceptOwn])],
      planned: 1,
      reason: `Your ${graph.has(rootId) ? graph.get(rootId).name : rootId} mistake showed up here.`,
    });
  }
  return { id: `root:${rootId}`, priority: root.priority, root_id: rootId, targets };
}

export interface DerivedWork {
  /** Remaining learning work, in order. */
  items: WorkItem[];
  /** Concepts with a gate in the plan (done or not). */
  targeted: string[];
  not_covered: { record_id: string; question_ref: string; reason: string }[];
  /** Concepts taken out of the plan after every retry failed: a teacher should look at them. */
  parked: string[];
  /** Concepts studied as planned but never checked, because no verified questions exist for them yet. */
  unchecked: string[];
}

export function deriveWork(input: {
  graph: ConceptGraph;
  analysis: RootCauseAnalysis;
  records: readonly ErrorRecord[];
  progress: ProgressState;
  params?: MissionParams;
}): DerivedWork {
  const { graph, analysis, records, progress } = input;
  const params = input.params ?? DEFAULT_MISSION_PARAMS;

  const blocks: Block[] = analysis.roots.map((r) => rootBlock(graph, records, r, params));
  const not_covered: DerivedWork["not_covered"] = [];
  // One-off conceptual gaps: one learn mission each. Slips are habits, not gaps.
  const standalone = new Map<string, Block>();
  for (const s of analysis.standalone) {
    if (SLIP_TYPES.has(s.error_type)) continue;
    if (!s.concept || !graph.has(s.concept.id)) {
      not_covered.push({ record_id: s.record_id, question_ref: `${s.exam_name} ${s.question_ref}`, reason: "Its topic isn't in the concept map yet." });
      continue;
    }
    const id = s.concept.id;
    const existing = standalone.get(id);
    if (existing) {
      existing.targets[0]!.record_ids.push(s.record_id);
      existing.priority += s.marks_lost.value / Math.max(0.25, s.study_hours);
      continue;
    }
    const own = recordMisconceptions(records, [s.record_id]);
    standalone.set(id, {
      id: `one-off:${id}`,
      priority: s.marks_lost.value / Math.max(0.25, s.study_hours),
      targets: [
        {
          kind: "learn",
          concept_id: id,
          record_ids: [s.record_id],
          misconception_ids: [...new Set([...own, ...graph.get(id).misconceptions.map((m) => m.id)])],
          planned: 1,
          reason: "A one-off gap: one mission should close it.",
        },
      ],
    });
  }
  // A concept already targeted inside a root block isn't repeated as a one-off.
  const inRoots = new Set(blocks.flatMap((b) => b.targets.map((t) => t.concept_id)));
  for (const b of standalone.values()) {
    const conceptId = b.targets[0]!.concept_id;
    if (inRoots.has(conceptId)) {
      const t = blocks.flatMap((x) => x.targets).find((x) => x.concept_id === conceptId)!;
      t.record_ids.push(...b.targets[0]!.record_ids.filter((r) => !t.record_ids.includes(r)));
    } else blocks.push(b);
  }

  const ordered = [...orderBlocks(graph, blocks.filter((b) => b.root_id)), ...orderBlocks(graph, blocks.filter((b) => !b.root_id))];
  const done = countAttempts(progress);
  const items: WorkItem[] = [];
  const parked: string[] = [];
  const unchecked: string[] = [];
  for (const b of ordered) {
    for (const t of b.targets) {
      if (isMastered(progress.concepts[t.concept_id]?.state)) continue;
      const { count: attempts, lastChecked } = done.get(t.concept_id) ?? { count: 0, lastChecked: true };
      // Nothing to prove it with yet: once its planned missions are studied, it doesn't loop.
      if (attempts >= t.planned && !lastChecked) {
        if (!unchecked.includes(t.concept_id)) unchecked.push(t.concept_id);
        continue;
      }
      // Every retry (and the last, flagged go) failed: stop scheduling it so the rest of the plan isn't blocked.
      if (attempts > t.planned + params.maxRetries) {
        if (!parked.includes(t.concept_id)) parked.push(t.concept_id);
        continue;
      }
      const left = t.planned - attempts;
      const count = left > 0 ? left : 1;
      for (let k = 0; k < count; k++) {
        const attempt = attempts + k + 1;
        items.push({
          key: `${t.kind}:${t.concept_id}:${attempt}`,
          kind: t.kind,
          concept_id: t.concept_id,
          ...(t.root_id ? { root_id: t.root_id } : {}),
          block: b.id,
          attempt,
          planned_attempts: Math.max(t.planned, attempt),
          record_ids: t.record_ids,
          misconception_ids: t.misconception_ids,
          priority: b.priority,
          proves: k === count - 1,
          needs_help: attempt > t.planned + params.maxRetries,
          reason: t.reason,
        });
      }
    }
  }
  return { items, targeted: ordered.flatMap((b) => b.targets.map((t) => t.concept_id)), not_covered, parked, unchecked };
}

/** Learn/apply missions completed per concept (each one was a gate attempt), and whether the latest had questions to check. */
function countAttempts(progress: ProgressState): Map<string, { count: number; lastChecked: boolean }> {
  const out = new Map<string, { count: number; lastChecked: boolean }>();
  for (const m of progress.history) {
    if (m.status !== "completed" || (m.kind !== "learn" && m.kind !== "apply") || !m.concept_id) continue;
    out.set(m.concept_id, { count: (out.get(m.concept_id)?.count ?? 0) + 1, lastChecked: m.checked !== false });
  }
  return out;
}

/**
 * Priority order with one constraint: a root block waits for every root block
 * it is built on (an ancestor root), so the deepest root goes first.
 */
function orderBlocks(graph: ConceptGraph, blocks: Block[]): Block[] {
  const left = [...blocks];
  const out: Block[] = [];
  const ancestorsOf = new Map<string, Set<string>>();
  for (const b of blocks) if (b.root_id && graph.has(b.root_id)) ancestorsOf.set(b.id, graph.ancestorsOf(b.root_id));
  while (left.length > 0) {
    const ready = left.filter((b) => {
      const anc = ancestorsOf.get(b.id);
      if (!anc) return true;
      return !left.some((o) => o !== b && o.root_id !== undefined && anc.has(o.root_id));
    });
    const pool = ready.length > 0 ? ready : left;
    pool.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    const next = pool[0]!;
    out.push(next);
    left.splice(left.indexOf(next), 1);
  }
  return out;
}
