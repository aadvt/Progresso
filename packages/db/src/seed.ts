/**
 * Seeding of DEMO FIXTURES (SAMPLE DATA). Deleted in Phase P together with
 * data/fixtures/ and @progresso/core/demo-fixtures.
 */
import { eq } from "drizzle-orm";
import { checkRecordAgainstGraph, marksLost, type ConceptGraph, type ErrorRecord } from "@progresso/core";
import type { DemoStudent } from "@progresso/core/demo-fixtures";
import type { Db } from "./client";
import { errorRecordConcepts, errorRecords, exams, students } from "./schema";

export class SeedError extends Error {
  override name = "SeedError";
}

/** Replace all sample students with the given fixtures. Real (non-sample) students are never touched. */
export function seedDemoStudents(db: Db, demo: DemoStudent[], graph: ConceptGraph): void {
  const problems = demo
    .flatMap((s) => s.records)
    .flatMap((r) => checkRecordAgainstGraph(r, graph))
    .filter((i) => i.severity === "error");
  if (problems.length > 0) {
    throw new SeedError(`fixtures do not match the concept graph:\n${problems.map((p) => `  ${p.record_id}: ${p.message}`).join("\n")}`);
  }

  db.transaction((tx) => {
    tx.delete(students).where(eq(students.isSample, true)).run(); // cascades to exams and records
    for (const s of demo) {
      tx.insert(students)
        .values({
          id: s.student.id,
          displayName: s.student.display_name,
          class: s.student.class,
          subjects: s.student.subjects,
          nextExamName: s.student.next_exam?.name ?? null,
          nextExamDate: s.student.next_exam?.date ?? null,
          isSample: true,
        })
        .run();
      for (const e of s.exams) {
        tx.insert(exams)
          .values({ id: e.id, studentId: e.student_id, name: e.name, subject: e.subject, date: e.date, maxMarks: e.max_marks ?? null })
          .run();
      }
      for (const r of s.records) insertErrorRecord(tx as unknown as Db, r, graph.fingerprint);
    }
  });
}

export function insertErrorRecord(db: Db, r: ErrorRecord, graphFingerprint: string): void {
  db.insert(errorRecords)
    .values({
      id: r.id,
      schemaVersion: r.schema_version,
      studentId: r.student.id,
      examId: r.exam.id,
      reportId: r.provenance.kind === "report" ? r.provenance.report_id : null,
      questionRef: r.question.ref,
      diagnosisText: r.diagnosis.text,
      errorType: r.error_type,
      errorTypeOriginal: r.error_type_original ?? null,
      studentWorking: r.student_working?.text ?? null,
      marksLost: marksLost(r) ?? null,
      marksMax: r.marks?.max ?? r.question.max_marks ?? null,
      misconceptionId: r.misconception?.misconception_id ?? null,
      provenanceKind: r.provenance.kind,
      record: r,
    })
    .run();
  for (const c of r.concepts) {
    db.insert(errorRecordConcepts)
      .values({
        errorRecordId: r.id,
        conceptId: c.concept_id,
        confidence: c.confidence,
        role: c.role,
        mappedBy: c.mapped_by,
        graphFingerprint: c.graph_fingerprint ?? graphFingerprint,
      })
      .run();
  }
}
