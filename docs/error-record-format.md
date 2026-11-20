# Error-record format (v1.0)

The **error record** is one diagnosed mistake, as stated by an Inferentics AI exam report. It is the contract between the report parser (built in Phase P) and everything downstream: the root-cause engine, missions, UI and MCP server. Nothing downstream reads report text.

- Source of truth: `packages/core/src/error-record/schema.ts` (`ErrorRecordSchema`, zod, strict: unknown keys are rejected).
- JSON Schema: `errorRecordJsonSchema()`. The parser can use it as its structured-output target.
- Version: `schema_version: "1.0"`. Any breaking change bumps the version and adds a migration.

## Design principles

1. **Faithful, not re-diagnosed.** The report's diagnosis is the truth. `diagnosis.text` holds the report's own words verbatim. Our additions (error-type mapping, concept mapping) sit beside it and never replace it.
2. **Re-mappable.** Concept mappings are interpretations that depend on the graph version. Each mapping records who made it (`mapped_by`) and against which graph (`graph_fingerprint`), so records can be re-mapped when the full graph replaces the provisional one.
3. **Optional where reports may vary.** We have not seen a real report yet. Anything a report might leave out is optional (working, marks, question text, the report's own error label). Only what every downstream feature needs is required.
4. **Never invent student work.** `student_working.origin` can only be `"report_quote"`.
5. **Anonymised.** A record identifies the student by pseudonymous id only, and the strict schema rejects extra fields such as a name.

## Fields

| Field | Req. | Type | Notes / why |
|---|---|---|---|
| `schema_version` | **yes** | `"1.0"` | Lets us migrate stored records. |
| `id` | **yes** | id string | Stable and unique. The parser derives it from report id + question ref so re-parsing is idempotent. |
| `student.id` | **yes** | id string | Pseudonymous. No names, ever. |
| `exam.id` | **yes** | id string | Groups records by sitting. |
| `exam.name` | **yes** | string | e.g. "Pre-Board 1". |
| `exam.date` | **yes** | `YYYY-MM-DD` | Ordering and recency weighting need a date. If a report gives only a month, the parser picks the 1st and says so in `notes`. |
| `exam.subject` | **yes** | string | Must match a graph subject ("Mathematics", "Chemistry"). Scopes concept mapping. |
| `exam.max_marks` | no | number | Not every report states it. |
| `question.ref` | **yes** | string | Exactly as the report writes it ("Q14(b)", "Section C, Q29"). It is the student's anchor back to their paper. |
| `question.section` | no | string | |
| `question.text` | no | string | Only if the report quotes the question. Never reconstructed. |
| `question.max_marks` | no | number | |
| `diagnosis.text` | **yes** | string | **Verbatim** report wording of what went wrong. The one field every feature relies on. |
| `diagnosis.correct_approach` | no | string | The correct method or answer, if the report states it. Used by Mistake Recap (Phase 6). |
| `error_type` | **yes** | enum | Our taxonomy, below. `unclassified` is allowed, so the field is always fillable. |
| `error_type_original` | no | string | The report's own label, verbatim, so our mapping can be audited and redone. |
| `student_working` | no | `{ text, format: plain\|latex, origin: "report_quote" }` | Only when the report reproduces the student's working. |
| `marks.lost` / `.awarded` / `.max` | no | numbers ≥ 0 | Any subset. Consistency is checked: lost ≤ max, awarded + lost = max when all three are given. `marksLost(record)` derives lost from awarded and max. Marks recoverable drives Phase 2 ranking, so we use it whenever present but never require it. |
| `concepts[]` | **yes** (may be empty) | `{ concept_id, confidence 0–1, role: primary\|secondary, mapped_by, graph_fingerprint? }` | Which graph concepts the error belongs to. `primary` is what the question tested and where the error sits; `secondary` concepts are also implicated. At least one primary if non-empty; no duplicates. **Empty means unmapped** (nothing in the graph fits). The record is kept and can be re-mapped later. |
| `misconception` | no | `{ misconception_id, confidence, mapped_by }` | When one of the graph's named misconceptions fits. Drives distractors in Phase 5 "prove it" questions. |
| `provenance` | **yes** | union on `kind` | `report`: `report_id`, `location?`, `parser { name, version }`, `extracted_at`. `demo_fixture`: `fixture_file`, `sample_data: true`. Every record says where it came from, so sample data can never pass as real. |
| `notes` | no | string | Parser or author notes. |

`mapped_by` values: `report` (the report named the topic explicitly), `parser_rule`, `parser_llm`, `manual`, `fixture`.

### Error-type taxonomy

The brief suggested conceptual / procedural / careless / notation. We split two more out because they need different remediation, and add two states that reports clearly contain:

| Type | Meaning | Remediation it implies |
|---|---|---|
| `conceptual` | Misunderstands the idea itself | Re-teach the concept (or its root) |
| `procedural` | Knows the idea, applies the method wrongly or skips a required step | Worked examples, step practice |
| `calculation` | Arithmetic/algebraic slip inside otherwise correct working | Checking habits; not a concept gap |
| `careless` | Misread the question, copied wrongly, answered the wrong part | Reading/checking habits |
| `notation` | Wrong notation, units, sign conventions, IUPAC naming, arrow-pushing conventions, missing +C | Presentation checklist |
| `incomplete` | Correct start but stopped, or left out the final step/justification | Time management, finishing habits |
| `unattempted` | Not attempted | Coverage / confidence |
| `unclassified` | The report doesn't let us say | – |

## Example

```json
{
  "schema_version": "1.0",
  "id": "rep-0042.q9",
  "student": { "id": "stu-7f3a" },
  "exam": { "id": "stu-7f3a.pb1.math", "name": "Pre-Board 1", "date": "2026-11-10", "subject": "Mathematics", "max_marks": 80 },
  "question": { "ref": "Q9", "section": "C", "text": "If x = a cos^3(theta), y = a sin^3(theta), find dy/dx." },
  "diagnosis": {
    "text": "The student took d/d(theta) of cos^3(theta) as 3cos^2(theta), missing the derivative of the inner function.",
    "correct_approach": "dy/dx = -tan(theta)."
  },
  "error_type": "conceptual",
  "error_type_original": "Conceptual error",
  "student_working": { "text": "dy/dx = (3a sin^2 theta)/(3a cos^2 theta) = tan^2 theta", "format": "plain", "origin": "report_quote" },
  "marks": { "max": 3, "lost": 2 },
  "concepts": [
    { "concept_id": "math.parametric_differentiation", "confidence": 0.85, "role": "primary", "mapped_by": "parser_llm", "graph_fingerprint": "4fa756f80ab6" },
    { "concept_id": "math.chain_rule", "confidence": 0.7, "role": "secondary", "mapped_by": "parser_llm", "graph_fingerprint": "4fa756f80ab6" }
  ],
  "misconception": { "misconception_id": "math.chain_rule.m1", "confidence": 0.85, "mapped_by": "parser_llm" },
  "provenance": { "kind": "report", "report_id": "rep-0042", "location": "Section C, item 2", "parser": { "name": "report-parser", "version": "0.1.0" }, "extracted_at": "2027-01-05T10:00:00Z" }
}
```

Map records to the concept the question **tested** (here, parametric differentiation), not to a guessed root. Finding the root is the Phase 2 engine's job, which traces the prerequisite graph. Mapping straight to the root would hide the evidence the engine needs.

## Validation layers

1. **Schema** (`ErrorRecordSchema.safeParse`): shape, types, enums, marks consistency, primary-concept rule.
2. **Against a graph** (`checkRecordAgainstGraph(record, graph)`): unknown concept/misconception ids are *errors* (block seeding/ingest), unmapped records and cross-subject primaries are *warnings*. This is separate from the schema on purpose: a record stays valid when the graph changes, it just needs re-mapping.

## Storage

`error_records` keeps the verbatim `diagnosis_text`, key columns for querying, and the full validated record JSON for lossless round-trips. `error_record_concepts` holds the mappings as soft references (no FK to `concepts`), so swapping the graph never deletes student data.
