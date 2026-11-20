import { asc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { errorRecordConcepts, errorRecords, exams, students } from "./schema";

export interface StudentSummary {
  id: string;
  displayName: string;
  class: number;
  isSample: boolean;
  nextExam?: string;
  exams: { name: string; subject: string; date: string; records: number }[];
  records: number;
  byErrorType: Record<string, number>;
  marksLostKnown: number;
  recordsWithMarks: number;
  recordsWithWorking: number;
  unmapped: number;
  /** Concepts most often mapped (any role). Raw counts only; root-cause analysis is Phase 2. */
  topConcepts: { conceptId: string; records: number }[];
}

/** Read back what is in the database (not the fixture files), per student. */
export function summariseStudents(db: Db): StudentSummary[] {
  return db
    .select()
    .from(students)
    .orderBy(asc(students.id))
    .all()
    .map((s) => {
      const recs = db.select().from(errorRecords).where(eq(errorRecords.studentId, s.id)).all();
      const studentExams = db.select().from(exams).where(eq(exams.studentId, s.id)).orderBy(asc(exams.date)).all();
      const mappings = db
        .select({ recordId: errorRecordConcepts.errorRecordId, conceptId: errorRecordConcepts.conceptId, role: errorRecordConcepts.role })
        .from(errorRecordConcepts)
        .innerJoin(errorRecords, eq(errorRecords.id, errorRecordConcepts.errorRecordId))
        .where(eq(errorRecords.studentId, s.id))
        .all();

      const byErrorType: Record<string, number> = {};
      for (const r of recs) byErrorType[r.errorType] = (byErrorType[r.errorType] ?? 0) + 1;
      const conceptCounts = new Map<string, number>();
      for (const m of mappings) conceptCounts.set(m.conceptId, (conceptCounts.get(m.conceptId) ?? 0) + 1);
      const mapped = new Set(mappings.map((m) => m.recordId));

      return {
        id: s.id,
        displayName: s.displayName,
        class: s.class,
        isSample: s.isSample,
        nextExam: s.nextExamName ? `${s.nextExamName} (${s.nextExamDate})` : undefined,
        exams: studentExams.map((e) => ({
          name: e.name,
          subject: e.subject,
          date: e.date,
          records: recs.filter((r) => r.examId === e.id).length,
        })),
        records: recs.length,
        byErrorType,
        marksLostKnown: recs.reduce((n, r) => n + (r.marksLost ?? 0), 0),
        recordsWithMarks: recs.filter((r) => r.marksLost !== null).length,
        recordsWithWorking: recs.filter((r) => r.studentWorking !== null).length,
        unmapped: recs.filter((r) => !mapped.has(r.id)).length,
        topConcepts: [...conceptCounts.entries()]
          .map(([conceptId, records]) => ({ conceptId, records }))
          .sort((a, b) => b.records - a.records || a.conceptId.localeCompare(b.conceptId))
          .slice(0, 5),
      };
    });
}
