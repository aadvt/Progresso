/**
 * DEMO FIXTURES — SAMPLE DATA ONLY.
 *
 * Loads the hand-written demo students in data/fixtures/demo/. These are
 * structured error records written by the team, NOT real reports and NOT a
 * real student's work. This whole module and data/fixtures/ are deleted in
 * Phase P, when real reports arrive.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import {
  ERROR_RECORD_SCHEMA_VERSION,
  ErrorRecordSchema,
  ErrorTypeSchema,
  type ErrorRecord,
} from "../error-record/schema";
import { StudentSchema, ExamSchema, type Student, type Exam } from "../student";

export const SAMPLE_DATA_NOTICE =
  "SAMPLE DATA: hand-written demo fixture, not a real student or a real Inferentics report.";

/** A record as authored in a fixture file; the loader fills in student, exam and provenance. */
const FixtureRecordSchema = z
  .object({
    id: z.string().min(1),
    exam_id: z.string().min(1),
    question: z.unknown(),
    diagnosis: z.unknown(),
    error_type: ErrorTypeSchema,
    error_type_original: z.string().optional(),
    student_working: z.unknown().optional(),
    marks: z.unknown().optional(),
    concepts: z.array(
      z
        .object({
          concept_id: z.string(),
          confidence: z.number(),
          role: z.enum(["primary", "secondary"]),
        })
        .strict(),
    ),
    misconception: z.object({ misconception_id: z.string(), confidence: z.number() }).strict().optional(),
    notes: z.string().optional(),
  })
  .strict();

const FixtureFileSchema = z
  .object({
    sample_data: z.literal(true),
    notice: z.string().min(1),
    student: StudentSchema.extend({ story: z.string().min(1) }),
    exams: z.array(ExamSchema.omit({ student_id: true })).min(1),
    records: z.array(FixtureRecordSchema).min(1),
  })
  .strict();

export interface DemoStudent {
  file: string;
  student: Student;
  /** The narrative this student is meant to showcase (for humans, not the engine). */
  story: string;
  exams: Exam[];
  records: ErrorRecord[];
}

export class FixtureError extends Error {
  override name = "FixtureError";
}

/** Load and validate every *.json fixture in `dir`. Throws FixtureError on any problem. */
export function loadDemoFixtures(dir: string): DemoStudent[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  if (files.length === 0) throw new FixtureError(`no fixture files in ${dir}`);
  const students = files.map((f) => parseFixtureFile(f, readFileSync(join(dir, f), "utf8")));

  const seen = new Map<string, string>();
  for (const s of students) {
    for (const id of [s.student.id, ...s.exams.map((e) => e.id), ...s.records.map((r) => r.id)]) {
      const prev = seen.get(id);
      if (prev) throw new FixtureError(`duplicate id "${id}" in ${s.file} (also in ${prev})`);
      seen.set(id, s.file);
    }
  }
  return students;
}

export function parseFixtureFile(file: string, text: string): DemoStudent {
  const name = basename(file);
  const parsed = FixtureFileSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new FixtureError(`${name}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const { student: studentWithStory, exams: rawExams, records: rawRecords } = parsed.data;
  const { story, ...student } = studentWithStory;
  const exams: Exam[] = rawExams.map((e) => ({ ...e, student_id: student.id }));
  const examById = new Map(exams.map((e) => [e.id, e]));

  const records = rawRecords.map((r): ErrorRecord => {
    const exam = examById.get(r.exam_id);
    if (!exam) throw new FixtureError(`${name}: record ${r.id} references unknown exam "${r.exam_id}"`);
    const { exam_id: _examId, concepts, misconception, ...rest } = r;
    const candidate = {
      schema_version: ERROR_RECORD_SCHEMA_VERSION,
      ...rest,
      student: { id: student.id },
      exam: { id: exam.id, name: exam.name, date: exam.date, subject: exam.subject, max_marks: exam.max_marks },
      concepts: concepts.map((c) => ({ ...c, mapped_by: "fixture" as const })),
      ...(misconception ? { misconception: { ...misconception, mapped_by: "fixture" as const } } : {}),
      provenance: { kind: "demo_fixture" as const, fixture_file: `data/fixtures/demo/${name}`, sample_data: true as const },
    };
    const result = ErrorRecordSchema.safeParse(candidate);
    if (!result.success) {
      throw new FixtureError(
        `${name}: record ${r.id}: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
    }
    return result.data;
  });
  return { file: name, student, story, exams, records };
}

/** Answer key: the roots each demo student was written to have. Tests only; never read by the engine. */
export const ExpectedRootsSchema = z
  .object({
    sample_data: z.literal(true),
    purpose: z.string(),
    students: z.record(
      z.string(),
      z
        .object({
          expected_roots: z.array(
            z
              .object({
                concept_id: z.string(),
                acceptable_alternatives: z.array(z.string()),
                explains_records: z.array(z.string()),
                rationale: z.string(),
              })
              .strict(),
          ),
          standalone_records: z.array(z.string()),
          expected_pattern: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export type ExpectedRoots = z.infer<typeof ExpectedRootsSchema>;

export { DemoFixtureParser, type DemoParserOptions } from "./demo-parser";
