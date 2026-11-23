/**
 * Per-student concept mastery (`concept_mastery`). The constellation reads it
 * on every request, so whatever writes here (Phase 5 missions, the Phase 10
 * MCP server, the Phase 4 demo trigger) shows up on the map automatically.
 */
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { ConceptMasteryState, MasteryLevel } from "@progresso/core";
import type { Db } from "./client";
import { conceptMastery, missions, planSettings, questionAttempts, students } from "./schema";

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

/**
 * A short fingerprint of everything a student's progress screens show: mastery,
 * answers, missions and plan settings. It changes whenever any process (the web
 * app, the MCP server, the simulator) writes progress, so an open page can poll
 * it cheaply and refresh only when something changed.
 */
export function progressVersion(db: Db, studentId: string): string {
  const one = <T>(q: { get(): T | undefined }) => q.get();
  const m = one(
    db
      .select({ n: sql<number>`count(*)`, at: sql<string>`coalesce(max(${conceptMastery.updatedAt}), '')`, s: sql<string>`coalesce(group_concat(${conceptMastery.state}), '')` })
      .from(conceptMastery)
      .where(eq(conceptMastery.studentId, studentId)),
  );
  const a = one(db.select({ n: sql<number>`count(*)` }).from(questionAttempts).where(eq(questionAttempts.studentId, studentId)));
  const k = one(
    db
      .select({ n: sql<number>`count(*)`, done: sql<number>`coalesce(sum(case when ${missions.status} = 'completed' then 1 else 0 end), 0)` })
      .from(missions)
      .where(eq(missions.studentId, studentId)),
  );
  const p = one(db.select({ at: planSettings.updatedAt, off: planSettings.demoDayOffset, d: planSettings.examDate }).from(planSettings).where(eq(planSettings.studentId, studentId)));
  const raw = JSON.stringify([m, a, k, p ?? null]);
  return createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

export function isSampleStudent(db: Db, studentId: string): boolean {
  return db.select({ s: students.isSample }).from(students).where(eq(students.id, studentId)).get()?.s === true;
}
