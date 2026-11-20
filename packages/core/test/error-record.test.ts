import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkRecordAgainstGraph,
  ErrorRecordSchema,
  errorRecordJsonSchema,
  loadConceptGraph,
  marksLost,
  type ErrorRecord,
} from "../src";

/** A minimal valid record: only the required fields. */
const minimal = (): Record<string, unknown> => ({
  schema_version: "1.0",
  id: "r1",
  student: { id: "s1" },
  exam: { id: "e1", name: "Pre-Board 1", date: "2026-11-10", subject: "Testing" },
  question: { ref: "Q7" },
  diagnosis: { text: "Forgot the inner derivative." },
  error_type: "conceptual",
  concepts: [],
  provenance: { kind: "demo_fixture", fixture_file: "x.json", sample_data: true },
});

const parse = (r: unknown) => ErrorRecordSchema.safeParse(r);
const messages = (r: unknown) => {
  const res = parse(r);
  return res.success ? [] : res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("error record schema", () => {
  it("accepts a minimal record with only required fields", () => {
    expect(parse(minimal()).success).toBe(true);
  });

  it("accepts a full record with every optional field", () => {
    const full = {
      ...minimal(),
      exam: { id: "e1", name: "Pre-Board 1", date: "2026-11-10", subject: "Testing", max_marks: 80 },
      question: { ref: "Q7(b)", section: "B", text: "Differentiate sin(x^2).", max_marks: 2 },
      diagnosis: { text: "Missing 2x.", correct_approach: "2x cos(x^2)" },
      error_type_original: "Concept error",
      student_working: { text: "cos(x^2)", format: "plain", origin: "report_quote" },
      marks: { max: 2, awarded: 1, lost: 1 },
      concepts: [
        { concept_id: "x.top", confidence: 0.9, role: "primary", mapped_by: "parser_llm", graph_fingerprint: "abc" },
        { concept_id: "x.root", confidence: 0.5, role: "secondary", mapped_by: "parser_llm" },
      ],
      misconception: { misconception_id: "x.root.m1", confidence: 0.7, mapped_by: "parser_llm" },
      provenance: {
        kind: "report",
        report_id: "rep-001",
        location: "Section B, item 4",
        parser: { name: "report-parser", version: "0.1.0" },
        extracted_at: "2027-01-05T10:00:00Z",
      },
      notes: "n",
    };
    expect(messages(full)).toEqual([]);
  });

  it.each(["schema_version", "id", "student", "exam", "question", "diagnosis", "error_type", "concepts", "provenance"])(
    "rejects a record missing required field %s",
    (field) => {
      const r = minimal();
      delete r[field];
      expect(parse(r).success).toBe(false);
    },
  );

  it("rejects unknown keys (catches typos and leaked fields such as a student name)", () => {
    expect(parse({ ...minimal(), student: { id: "s1", name: "Real Name" } }).success).toBe(false);
    expect(parse({ ...minimal(), diagnoses: "typo" }).success).toBe(false);
  });

  it("rejects an unknown error type and invalid dates", () => {
    expect(parse({ ...minimal(), error_type: "silly" }).success).toBe(false);
    expect(parse({ ...minimal(), exam: { id: "e", name: "n", date: "2026-02-30", subject: "S" } }).success).toBe(false);
    expect(parse({ ...minimal(), exam: { id: "e", name: "n", date: "10/11/2026", subject: "S" } }).success).toBe(false);
  });

  it("only allows student working that is quoted from the report", () => {
    expect(parse({ ...minimal(), student_working: { text: "x", format: "plain", origin: "generated" } }).success).toBe(false);
  });

  it("checks marks are consistent", () => {
    expect(messages({ ...minimal(), marks: { max: 2, lost: 3 } })).toContain("marks.lost: marks lost exceed max marks");
    expect(messages({ ...minimal(), marks: { max: 3, lost: 1, awarded: 1 } })).toContain(
      "marks: awarded + lost must equal max when all three are given",
    );
    expect(messages({ ...minimal(), question: { ref: "Q1", max_marks: 2 }, marks: { max: 3 } })).toContain(
      "marks.max: marks.max disagrees with question.max_marks",
    );
    expect(parse({ ...minimal(), marks: { lost: 2 } }).success).toBe(true); // marks lost without max is fine
  });

  it("requires a primary concept when mapped, and no duplicates", () => {
    const sec = { concept_id: "a", confidence: 0.5, role: "secondary", mapped_by: "manual" };
    expect(messages({ ...minimal(), concepts: [sec] })).toContain("concepts: mapped records need at least one primary concept");
    const pri = { ...sec, role: "primary" };
    expect(messages({ ...minimal(), concepts: [pri, pri] })).toContain("concepts: a concept is mapped twice");
    expect(parse({ ...minimal(), concepts: [{ ...pri, confidence: 1.5 }] }).success).toBe(false);
  });

  it("derives marks lost from awarded and max", () => {
    const r = (marks: unknown) => ErrorRecordSchema.parse({ ...minimal(), marks }) as ErrorRecord;
    expect(marksLost(r({ max: 3, awarded: 1 }))).toBe(2);
    expect(marksLost(r({ lost: 1.5 }))).toBe(1.5);
    expect(marksLost(r({ max: 3 }))).toBeUndefined();
    expect(marksLost(ErrorRecordSchema.parse(minimal()))).toBeUndefined();
  });

  it("exports a JSON Schema for the parser to target", () => {
    const schema = errorRecordJsonSchema();
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(
      expect.arrayContaining(["schema_version", "id", "student", "exam", "question", "diagnosis", "error_type", "concepts", "provenance"]),
    );
  });
});

describe("checking records against the graph", () => {
  const { graph } = loadConceptGraph(join(import.meta.dirname, "fixtures-graphs", "tiny"));
  const rec = (patch: Record<string, unknown>) => ErrorRecordSchema.parse({ ...minimal(), ...patch });

  it("passes a record whose ids exist", () => {
    const r = rec({
      concepts: [{ concept_id: "x.root", confidence: 0.9, role: "primary", mapped_by: "manual" }],
      misconception: { misconception_id: "x.root.m1", confidence: 0.9, mapped_by: "manual" },
    });
    expect(checkRecordAgainstGraph(r, graph)).toEqual([]);
  });

  it("flags unknown concept and misconception ids as errors, unmapped records as warnings", () => {
    const bad = rec({
      concepts: [{ concept_id: "x.nope", confidence: 0.9, role: "primary", mapped_by: "manual" }],
      misconception: { misconception_id: "x.nope.m1", confidence: 0.9, mapped_by: "manual" },
    });
    expect(checkRecordAgainstGraph(bad, graph).filter((i) => i.severity === "error")).toHaveLength(2);
    expect(checkRecordAgainstGraph(rec({}), graph)).toEqual([
      expect.objectContaining({ severity: "warning", message: expect.stringMatching(/unmapped/) }),
    ]);
  });
});
