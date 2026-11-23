import type { ErrorRecord } from "../error-record/schema";
import type { ConceptGraph } from "../graph/graph";

export interface MisconceptionFrequency {
  misconception_id: string;
  concept_id: string;
  subject: string;
  /** Students whose reports show it. */
  students: number;
  /** Error records that name it. */
  records: number;
}

/**
 * Misconceptions named in the students' reports, most frequent first (by
 * students, then records, then id). Videos are made per misconception, so
 * the most shared mistakes are animated first and reused by every student.
 */
export function rankMisconceptions(graph: ConceptGraph, students: { id: string; records: ErrorRecord[] }[]): MisconceptionFrequency[] {
  const out = new Map<string, MisconceptionFrequency & { who: Set<string> }>();
  for (const s of students) {
    for (const r of s.records) {
      const id = r.misconception?.misconception_id;
      const m = id ? graph.misconceptions.get(id) : undefined;
      if (!id || !m || !graph.has(m.concept_id)) continue;
      const e = out.get(id) ?? { misconception_id: id, concept_id: m.concept_id, subject: graph.get(m.concept_id).subject, students: 0, records: 0, who: new Set<string>() };
      e.records++;
      e.who.add(s.id);
      e.students = e.who.size;
      out.set(id, e);
    }
  }
  return [...out.values()]
    .map(({ who: _who, ...rest }) => rest)
    .sort((a, b) => b.students - a.students || b.records - a.records || a.misconception_id.localeCompare(b.misconception_id));
}
