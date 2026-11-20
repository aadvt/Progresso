import { z } from "zod";

/**
 * The error record: one diagnosed mistake, as stated by an Inferentics AI
 * report. This is the contract between the (Phase P) report parser and
 * everything downstream. See docs/error-record-format.md.
 *
 * Bump ERROR_RECORD_SCHEMA_VERSION on any breaking change and add a migration.
 */
export const ERROR_RECORD_SCHEMA_VERSION = "1.0" as const;

const Id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/, "ids may contain letters, digits and . _ : - only");

export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), "not a real date");

const IsoDateTime = z.iso.datetime({ offset: true });

/**
 * Our error taxonomy. Reports use their own labels; the parser maps them here
 * and keeps the report's label in `error_type_original`.
 */
export const ERROR_TYPES = [
  "conceptual", //   misunderstands the idea itself (wrong rule, wrong model of the concept)
  "procedural", //   knows the idea but applies a method wrongly or skips a required step
  "calculation", //  arithmetic or algebraic slip inside otherwise correct working
  "careless", //     misread the question, copied wrongly, dropped a sign, answered a different part
  "notation", //     wrong notation, units, sign conventions, IUPAC naming, arrow-pushing conventions
  "incomplete", //   started correctly but stopped, or left out a required final step/justification
  "unattempted", //  question or part not attempted
  "unclassified", // the report does not let us say
] as const;
export const ErrorTypeSchema = z.enum(ERROR_TYPES);
export type ErrorType = z.infer<typeof ErrorTypeSchema>;

export const MAPPED_BY = ["report", "parser_rule", "parser_llm", "manual", "fixture"] as const;

export const ConceptMappingSchema = z
  .object({
    concept_id: z.string().min(1),
    /** 0..1: how sure we are that this error belongs to this concept. */
    confidence: z.number().min(0).max(1),
    /** primary = the concept the question tested and the error sits in; secondary = also involved. */
    role: z.enum(["primary", "secondary"]),
    mapped_by: z.enum(MAPPED_BY),
    /** Fingerprint of the concept graph this mapping was made against (re-map when it changes). */
    graph_fingerprint: z.string().optional(),
  })
  .strict();

export const MisconceptionMatchSchema = z
  .object({
    misconception_id: z.string().min(1),
    confidence: z.number().min(0).max(1),
    mapped_by: z.enum(MAPPED_BY),
  })
  .strict();

const ReportProvenance = z
  .object({
    kind: z.literal("report"),
    /** Our id for the source report file (data/reports/, never committed). */
    report_id: Id,
    /** Where in the report this came from, e.g. "Section B, item 4". */
    location: z.string().optional(),
    parser: z.object({ name: z.string().min(1), version: z.string().min(1) }).strict(),
    extracted_at: IsoDateTime,
  })
  .strict();

const FixtureProvenance = z
  .object({
    kind: z.literal("demo_fixture"),
    /** Fixture file the record was authored in. Fixtures are SAMPLE DATA and are deleted in Phase P. */
    fixture_file: z.string().min(1),
    sample_data: z.literal(true),
  })
  .strict();

export const ProvenanceSchema = z.discriminatedUnion("kind", [ReportProvenance, FixtureProvenance]);

export const ErrorRecordSchema = z
  .object({
    schema_version: z.literal(ERROR_RECORD_SCHEMA_VERSION),
    /** Stable, unique id. The parser derives it from report id + question ref. */
    id: Id,
    /** Pseudonymous student id only. Names never appear in error records. */
    student: z.object({ id: Id }).strict(),
    exam: z
      .object({
        id: Id,
        name: z.string().min(1),
        date: IsoDate,
        /** Must match a concept-graph subject name, e.g. "Mathematics". */
        subject: z.string().min(1),
        max_marks: z.number().positive().optional(),
      })
      .strict(),
    question: z
      .object({
        /** Question reference exactly as the report gives it, e.g. "Q14(b)" or "Section C, Q29". */
        ref: z.string().min(1),
        section: z.string().optional(),
        /** Question text, only if the report quotes it. */
        text: z.string().optional(),
        max_marks: z.number().positive().optional(),
      })
      .strict(),
    diagnosis: z
      .object({
        /** What went wrong, in the report's own words. Verbatim; never paraphrased. */
        text: z.string().min(1),
        /** The correct method or answer, if the report states it (report's own words). */
        correct_approach: z.string().optional(),
      })
      .strict(),
    error_type: ErrorTypeSchema,
    /** The report's own label for the error type, verbatim, if it gives one. */
    error_type_original: z.string().optional(),
    /** The student's wrong working, ONLY when the report reproduces it. Never invented. */
    student_working: z
      .object({
        text: z.string().min(1),
        format: z.enum(["plain", "latex"]),
        origin: z.literal("report_quote"),
      })
      .strict()
      .optional(),
    marks: z
      .object({
        lost: z.number().min(0).optional(),
        awarded: z.number().min(0).optional(),
        max: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    /** Concept(s) the error maps to. May be empty when nothing in the graph fits (kept for re-mapping). */
    concepts: z.array(ConceptMappingSchema),
    misconception: MisconceptionMatchSchema.optional(),
    provenance: ProvenanceSchema,
    notes: z.string().optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const ids = r.concepts.map((c) => c.concept_id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["concepts"], message: "a concept is mapped twice" });
    }
    if (r.concepts.length > 0 && !r.concepts.some((c) => c.role === "primary")) {
      ctx.addIssue({ code: "custom", path: ["concepts"], message: "mapped records need at least one primary concept" });
    }
    const m = r.marks;
    const max = m?.max ?? r.question.max_marks;
    if (m && max !== undefined) {
      if (m.lost !== undefined && m.lost > max) {
        ctx.addIssue({ code: "custom", path: ["marks", "lost"], message: "marks lost exceed max marks" });
      }
      if (m.awarded !== undefined && m.awarded > max) {
        ctx.addIssue({ code: "custom", path: ["marks", "awarded"], message: "marks awarded exceed max marks" });
      }
      if (m.lost !== undefined && m.awarded !== undefined && Math.abs(m.lost + m.awarded - max) > 1e-9) {
        ctx.addIssue({ code: "custom", path: ["marks"], message: "awarded + lost must equal max when all three are given" });
      }
    }
    if (m?.max !== undefined && r.question.max_marks !== undefined && m.max !== r.question.max_marks) {
      ctx.addIssue({ code: "custom", path: ["marks", "max"], message: "marks.max disagrees with question.max_marks" });
    }
  });

export type ErrorRecord = z.infer<typeof ErrorRecordSchema>;
export type ConceptMapping = z.infer<typeof ConceptMappingSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;

/** Marks lost if the report gives them directly or they can be derived from awarded/max. */
export function marksLost(r: ErrorRecord): number | undefined {
  const m = r.marks;
  if (!m) return undefined;
  if (m.lost !== undefined) return m.lost;
  const max = m.max ?? r.question.max_marks;
  if (m.awarded !== undefined && max !== undefined) return max - m.awarded;
  return undefined;
}

/** JSON Schema for the record (used in docs and as the parse_report structured-output target). */
export function errorRecordJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ErrorRecordSchema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
}
