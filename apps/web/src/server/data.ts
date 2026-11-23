/**
 * Server-side data access for the web app. Students, records, the concept
 * graph and the database come from @progresso/service, the data seam shared
 * with the MCP server (both read and write the same SQLite file, so progress
 * made in Claude shows up here).
 *
 * Until Phase P everything comes from the demo fixtures (SAMPLE DATA). In
 * Phase P, swap `getReportParser()` for the real parser and the record lookups
 * in @progresso/service for the database; pages and components don't change.
 */
import { buildDiagnosisView, type ConceptGraph, type ConstellationModel, type DiagnosisView, type ErrorRecord, type IsoDay, type LessonLibrary, type ReportParser, type VideoLibrary } from "@progresso/core";
import { DemoFixtureParser, SAMPLE_DATA_NOTICE, type DemoStudent } from "@progresso/core/demo-fixtures";
import { clearConceptMastery, isSampleStudent, progressVersion, setConceptMastery, type Db } from "@progresso/db";
import * as service from "@progresso/service";
import type { StudentSummary } from "@/lib/types";
import { daysUntil } from "@/lib/format";

/** Files (graph, fixtures, bank, lessons, videos), loaded once per process by the shared service. */
const load = service.store;
const analysed = service.analysed;

/** Passing explainer videos by misconception (failed ones are never served; the step explainer covers them). */
export function getVideos(): VideoLibrary {
  return load().videos;
}

/** Cached Mistake Recaps (per record; demo ones are SAMPLE DATA) and step explainers (per misconception). */
export function getLessons(): LessonLibrary {
  return load().lessons;
}

export function getGraph(): ConceptGraph {
  return load().graph;
}

/** Display names stay on this server: they never go to an LLM. */
function displayName(raw: string): string {
  return raw.replace(/\s*\(sample\)\s*$/i, "");
}

function summarise(s: DemoStudent, today: Date): StudentSummary {
  const dates = s.exams.map((e) => e.date).sort();
  return {
    id: s.student.id,
    name: displayName(s.student.display_name),
    is_sample: true,
    sample_notice: SAMPLE_DATA_NOTICE,
    class: s.student.class,
    subjects: s.student.subjects,
    ...(s.student.next_exam
      ? { next_exam: { ...s.student.next_exam, days_left: daysUntil(s.student.next_exam.date, today) } }
      : {}),
    exam_count: s.exams.length,
    first_exam_date: dates[0] ?? "",
    last_exam_date: dates[dates.length - 1] ?? "",
  };
}

export function listStudents(today = new Date()): StudentSummary[] {
  return load().demo.map((s) => summarise(s, today));
}

export function getStudent(id: string, today = new Date()): StudentSummary | undefined {
  const s = service.demoStudent(id);
  return s ? summarise(s, today) : undefined;
}

/** The parser behind "Add exam report". Phase P: return the real parser here. */
export function getReportParser(): ReportParser {
  const delay = Number(process.env.PARSER_STAGE_DELAY_MS ?? 550);
  return new DemoFixtureParser(load().demo, { stageDelayMs: Number.isFinite(delay) ? delay : 550 });
}

/** The shared SQLite handle (opened, migrated and seeded once per process). */
export function db(): Db {
  return service.db();
}

/** Changes whenever this student's progress changes, from any process: open pages poll it to stay in sync. */
export function getProgressVersion(studentId: string): string | undefined {
  return service.demoStudent(studentId) ? progressVersion(db(), studentId) : undefined;
}

/** The student's diagnosis from every report added so far. */
export function getDiagnosis(studentId: string): DiagnosisView | undefined {
  const a = analysed(studentId);
  return a ? buildDiagnosisView(a.analysis, a.s.records) : undefined;
}

/**
 * The knowledge constellation: the diagnosis plus mastery read from the
 * database on every request, so missions (web or MCP) change the map just by
 * writing `concept_mastery`.
 */
export function getConstellation(studentId: string): ConstellationModel | undefined {
  return service.constellation(studentId);
}

/**
 * Demo trigger (SAMPLE DATA students only): record a root as mastered, as a
 * passed Phase 5 "prove it" check will. Only the student's own roots qualify.
 */
export function demoMasterRoot(studentId: string, conceptId: string): boolean {
  const a = analysed(studentId);
  if (!a || !a.analysis.roots.some((r) => r.concept.id === conceptId)) return false;
  const d = db();
  if (!isSampleStudent(d, studentId)) return false;
  setConceptMastery(d, { studentId, conceptId, state: "proven" });
  return true;
}

/** Demo trigger: forget all mastery for a SAMPLE DATA student. */
export function demoResetMastery(studentId: string): boolean {
  const d = db();
  if (!analysed(studentId) || !isSampleStudent(d, studentId)) return false;
  clearConceptMastery(d, studentId);
  return true;
}

// ---------------------------------------------------------------- missions (Phase 5)

/** Everything the mission service needs about one student. Phase P: records from the database. */
export function studentContext(studentId: string): (service.Ctx & { records: ErrorRecord[] }) | undefined {
  return service.studentContext(studentId);
}

/** The student's "today". SAMPLE DATA students can move their clock forward to demo the plan re-flowing. */
export function studentToday(studentId: string, now = new Date()): IsoDay {
  return service.studentToday(studentId, now);
}

export function isSample(studentId: string): boolean {
  return isSampleStudent(db(), studentId);
}
