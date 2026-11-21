/**
 * Per-student concept mastery (`concept_mastery`). The constellation reads it
 * on every request, so whatever writes here (Phase 5 missions, the Phase 10
 * MCP server, the Phase 4 demo trigger) shows up on the map automatically.
 */
import { and, eq } from "drizzle-orm";
import type { ConceptMasteryState, MasteryLevel } from "@progresso/core";
import type { Db } from "./client";
import { conceptMastery, students } from "./schema";

export function getConceptMastery(db: Db, studentId: string): ConceptMasteryState[] {
  return db
    .select({ concept_id: conceptMastery.conceptId, state: conceptMastery.state, updated_at: conceptMastery.updatedAt })
    .from(conceptMastery)
    .where(eq(conceptMastery.studentId, studentId))
    .all()
    .sort((a, b) => a.concept_id.localeCompare(b.concept_id));
}

/** Set one concept's mastery state (insert or update). FSRS fields are left to Phase 5. */
export function setConceptMastery(db: Db, input: { studentId: string; conceptId: string; state: MasteryLevel; at?: string }): void {
  const at = input.at ?? new Date().toISOString();
  db.insert(conceptMastery)
    .values({ studentId: input.studentId, conceptId: input.conceptId, state: input.state, updatedAt: at })
    .onConflictDoUpdate({ target: [conceptMastery.studentId, conceptMastery.conceptId], set: { state: input.state, updatedAt: at } })
    .run();
}

/** Remove mastery for one concept, or (no conceptId) for the whole student. */
export function clearConceptMastery(db: Db, studentId: string, conceptId?: string): number {
  const where = conceptId
    ? and(eq(conceptMastery.studentId, studentId), eq(conceptMastery.conceptId, conceptId))
    : eq(conceptMastery.studentId, studentId);
  return db.delete(conceptMastery).where(where).run().changes;
}

export function isSampleStudent(db: Db, studentId: string): boolean {
  return db.select({ s: students.isSample }).from(students).where(eq(students.id, studentId)).get()?.s === true;
}
