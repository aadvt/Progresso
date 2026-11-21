/**
 * Which (concept, misconception) pairs need prove-it questions.
 *
 * Driven by the diagnoses: every misconception of every root, the
 * misconception seen at each topic where a root's mistakes surfaced, and each
 * one-off gap. Questions are cached per misconception, so they are reused by
 * every student who shares it.
 */
import { analyseStudent, deriveWork, type ConceptGraph, type ErrorRecord } from "@progresso/core";

export interface Target {
  concept_id: string;
  misconception_id: string;
  subject: string;
  /** Why it's needed (for the report). */
  for: string[];
  /** How many questions to write. */
  count: number;
}

export function collectTargets(graph: ConceptGraph, students: { id: string; records: ErrorRecord[] }[]): Target[] {
  const out = new Map<string, Target>();
  const add = (concept_id: string, misconception_id: string, why: string, count: number) => {
    if (!graph.has(concept_id) || !graph.misconceptions.has(misconception_id)) return;
    const key = `${concept_id}|${misconception_id}`;
    const t = out.get(key) ?? { concept_id, misconception_id, subject: graph.get(concept_id).subject, for: [], count };
    if (!t.for.includes(why)) t.for.push(why);
    t.count = Math.max(t.count, count);
    out.set(key, t);
  };
  for (const s of students) {
    const analysis = analyseStudent({ graph, records: s.records });
    const work = deriveWork({ graph, analysis, records: s.records, progress: { concepts: {}, history: [] } });
    const seen = new Set<string>();
    for (const item of work.items) {
      if (seen.has(item.concept_id)) continue;
      seen.add(item.concept_id);
      if (item.kind === "learn" && item.root_id) {
        // A root: every misconception of the concept, 4 questions each.
        for (const m of graph.get(item.concept_id).misconceptions) add(item.concept_id, m.id, `root of ${s.id}`, 4);
      } else {
        // Apply / one-off: the misconception the report saw here (else the concept's first), 3 questions.
        const fromRecords = item.misconception_ids.filter((m) => s.records.some((r) => item.record_ids.includes(r.id) && r.misconception?.misconception_id === m));
        const own = graph.get(item.concept_id).misconceptions.map((m) => m.id);
        const pick = fromRecords[0] ?? own[0] ?? item.misconception_ids[0];
        if (pick) add(item.concept_id, pick, `${item.kind} for ${s.id}`, 3);
      }
    }
  }
  return [...out.values()].sort((a, b) => a.subject.localeCompare(b.subject) || a.concept_id.localeCompare(b.concept_id) || a.misconception_id.localeCompare(b.misconception_id));
}
