import { buildConceptGraph, ErrorRecordSchema, type ErrorRecord, type ErrorType } from "../../src";

/** Build a validated graph from { conceptId: [prerequisites] }. Ids are made up for tests. */
export function graphOf(
  spec: Record<string, string[]>,
  opts: { subject?: string; boardMarks?: number; misconceptions?: Record<string, string[]>; classOf?: Record<string, number> } = {},
) {
  const subject = opts.subject ?? "Testing";
  const units = [{ id: "t.unit", name: "Unit", class: 12, board_marks: opts.boardMarks ?? 20 }];
  const concepts = Object.entries(spec).map(([id, prerequisites]) => ({
    id,
    name: `Concept ${id}`,
    class: opts.classOf?.[id] ?? 12,
    unit_id: "t.unit",
    chapter: "c",
    prerequisites,
    aliases: [],
    misconceptions: (opts.misconceptions?.[id] ?? []).map((m) => ({ id: `${id}.${m}`, description: `misconception ${m} of ${id}` })),
  }));
  return buildConceptGraph([{ name: "t.json", text: JSON.stringify({ subject, syllabus_source: "test", units, concepts }) }]).graph;
}

export interface RecSpec {
  exam?: string;
  date?: string;
  type?: ErrorType;
  primary?: string;
  confidence?: number;
  secondary?: { id: string; confidence: number }[];
  misconception?: { id: string; confidence: number };
  marks?: { lost?: number; awarded?: number; max?: number } | null;
  questionMax?: number;
  student?: string;
}

let counter = 0;

export function rec(spec: RecSpec): ErrorRecord {
  const exam = spec.exam ?? "e1";
  const id = `rec${++counter}`;
  return ErrorRecordSchema.parse({
    schema_version: "1.0",
    id,
    student: { id: spec.student ?? "stu-test" },
    exam: { id: exam, name: `Exam ${exam}`, date: spec.date ?? "2026-11-01", subject: "Testing" },
    question: { ref: `Q-${id}`, ...(spec.questionMax ? { max_marks: spec.questionMax } : {}) },
    diagnosis: { text: "test diagnosis" },
    error_type: spec.type ?? "conceptual",
    ...(spec.marks === null ? {} : { marks: spec.marks ?? { lost: 2 } }),
    concepts: spec.primary
      ? [
          { concept_id: spec.primary, confidence: spec.confidence ?? 0.9, role: "primary", mapped_by: "manual" },
          ...(spec.secondary ?? []).map((s) => ({ concept_id: s.id, confidence: s.confidence, role: "secondary", mapped_by: "manual" })),
        ]
      : [],
    ...(spec.misconception ? { misconception: { misconception_id: spec.misconception.id, confidence: spec.misconception.confidence, mapped_by: "manual" } } : {}),
    provenance: { kind: "demo_fixture", fixture_file: "test", sample_data: true },
  });
}

/** Small deterministic PRNG (mulberry32) so random tests are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
