/**
 * Server-side data access for the web app. The only module that knows where
 * students, records and the concept graph come from.
 *
 * Until Phase P everything comes from the demo fixtures (SAMPLE DATA). In
 * Phase P, swap `getReportParser()` for the real parser and the record lookups
 * for the database; pages and components don't change.
 */
import {
  analyseStudent,
  buildConstellation,
  buildDiagnosisView,
  layoutConstellation,
  findRepoRoot,
  loadAppConfig,
  loadConceptGraph,
  type ConceptGraph,
  type ConstellationLayout,
  type ConstellationModel,
  type DiagnosisView,
  type RootCauseAnalysis,
  type ReportParser,
} from "@progresso/core";
import { DemoFixtureParser, loadDemoFixtures, SAMPLE_DATA_NOTICE, type DemoStudent } from "@progresso/core/demo-fixtures";
import { clearConceptMastery, getConceptMastery, isSampleStudent, setConceptMastery, type Db } from "@progresso/db";
import type { StudentSummary } from "@/lib/types";
import { daysUntil } from "@/lib/format";
import { getDb } from "./db";

interface Loaded {
  graph: ConceptGraph;
  demo: DemoStudent[];
  repoRoot: string;
  databasePath: string;
}

let loaded: Loaded | undefined;

function load(): Loaded {
  if (!loaded) {
    const config = loadAppConfig(findRepoRoot());
    const { graph } = loadConceptGraph(config.conceptGraphDir);
    loaded = { graph, demo: loadDemoFixtures(config.fixturesDir), repoRoot: config.repoRoot, databasePath: config.databasePath };
  }
  return loaded;
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
  const s = load().demo.find((d) => d.student.id === id);
  return s ? summarise(s, today) : undefined;
}

/** The parser behind "Add exam report". Phase P: return the real parser here. */
export function getReportParser(): ReportParser {
  const delay = Number(process.env.PARSER_STAGE_DELAY_MS ?? 550);
  return new DemoFixtureParser(load().demo, { stageDelayMs: Number.isFinite(delay) ? delay : 550 });
}

function db(): Db {
  const l = load();
  return getDb({ repoRoot: l.repoRoot, databasePath: l.databasePath, graph: l.graph, demo: l.demo });
}

/** Records and their analysis for one student. Phase P: read records from the database. */
function analysed(studentId: string): { s: DemoStudent; analysis: RootCauseAnalysis } | undefined {
  const { graph, demo } = load();
  const s = demo.find((d) => d.student.id === studentId);
  if (!s) return undefined;
  return { s, analysis: { ...analyseStudent({ graph, records: s.records }), student_id: s.student.id } };
}

/** The student's diagnosis from every report added so far. */
export function getDiagnosis(studentId: string): DiagnosisView | undefined {
  const a = analysed(studentId);
  return a ? buildDiagnosisView(a.analysis, a.s.records) : undefined;
}

const layouts = new Map<string, ConstellationLayout>();

/** The layout depends only on the graph and the subjects shown, so it is computed once. */
function layoutFor(subjects: readonly string[]): ConstellationLayout {
  const graph = getGraph();
  const key = `${graph.fingerprint}|${subjects.join(",")}`;
  let layout = layouts.get(key);
  if (!layout) {
    layout = layoutConstellation(graph, subjects);
    layouts.set(key, layout);
  }
  return layout;
}

/**
 * The knowledge constellation: the diagnosis plus mastery read from the
 * database on every request, so missions (Phase 5) and the MCP server
 * (Phase 10) change the map just by writing `concept_mastery`.
 */
export function getConstellation(studentId: string): ConstellationModel | undefined {
  const a = analysed(studentId);
  if (!a) return undefined;
  const graph = getGraph();
  const subjects = a.s.student.subjects.filter((x) => graph.subjects.includes(x));
  return buildConstellation({
    student_id: studentId,
    graph,
    layout: layoutFor(subjects.length > 0 ? subjects : graph.subjects),
    analysis: a.analysis,
    records: a.s.records,
    mastery: getConceptMastery(db(), studentId),
  });
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
