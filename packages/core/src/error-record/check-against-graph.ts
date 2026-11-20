import type { ConceptGraph } from "../graph/graph";
import type { ErrorRecord } from "./schema";

export interface RecordGraphIssue {
  record_id: string;
  severity: "error" | "warning";
  message: string;
}

/**
 * Checks a schema-valid record against a concept graph. Unknown ids are NOT a
 * schema error: records outlive graph versions and are re-mapped when the
 * graph changes. Callers decide whether to block on these issues.
 */
export function checkRecordAgainstGraph(record: ErrorRecord, graph: ConceptGraph): RecordGraphIssue[] {
  const issues: RecordGraphIssue[] = [];
  const add = (severity: RecordGraphIssue["severity"], message: string): void => {
    issues.push({ record_id: record.id, severity, message });
  };

  if (!graph.subjects.includes(record.exam.subject)) {
    add("warning", `exam subject "${record.exam.subject}" is not a graph subject`);
  }
  for (const m of record.concepts) {
    if (!graph.has(m.concept_id)) add("error", `unknown concept id "${m.concept_id}"`);
    else if (graph.get(m.concept_id).subject !== record.exam.subject && m.role === "primary") {
      add("warning", `primary concept "${m.concept_id}" is not in subject ${record.exam.subject}`);
    }
  }
  if (record.concepts.length === 0) add("warning", "record is unmapped (no concept in the graph fits)");

  if (record.misconception) {
    const mis = graph.misconceptions.get(record.misconception.misconception_id);
    if (!mis) add("error", `unknown misconception id "${record.misconception.misconception_id}"`);
    else if (!record.concepts.some((c) => c.concept_id === mis.concept_id)) {
      add("warning", `misconception belongs to "${mis.concept_id}", which the record is not mapped to`);
    }
  }
  return issues;
}
