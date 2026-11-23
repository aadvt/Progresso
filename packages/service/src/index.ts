/**
 * @progresso/service: server-side student data, shared by the web app and the
 * MCP server. This is the single data seam: the only place that knows where
 * students, error records, the concept graph and the database come from.
 *
 * Both apps call the same functions on the same SQLite file, so progress made
 * in one (a mission in the browser, an answer in Claude) shows up in the other.
 *
 * Until Phase P everything comes from the demo fixtures (SAMPLE DATA). In
 * Phase P, swap `demoStudents()` / `analysed()` for the real parser and the
 * database; nothing downstream changes.
 */
import { join } from "node:path";
import {
  addDays,
  analyseStudent,
  buildConstellation,
  findRepoRoot,
  layoutConstellation,
  loadAppConfig,
  loadConceptGraph,
  loadLessons,
  loadQuestionBank,
  loadVideoLibrary,
  localDay,
  type AppConfig,
  type ConceptGraph,
  type ConstellationLayout,
  type ConstellationModel,
  type ErrorRecord,
  type IsoDay,
  type LessonLibrary,
  type LoadedBank,
  type RootCauseAnalysis,
  type VideoLibrary,
} from "@progresso/core";
import { loadDemoFixtures, type DemoStudent } from "@progresso/core/demo-fixtures";
import { ensureDemoData, getConceptMastery, getPlanSettings, isSampleStudent, openDb, runMigrations, type Db, type StudentContext } from "@progresso/db";

export { SAMPLE_DATA_NOTICE, type DemoStudent } from "@progresso/core/demo-fixtures";

export interface Store {
  config: AppConfig;
  graph: ConceptGraph;
  /** SAMPLE DATA students (Phase P: real students come from the database). */
  demo: DemoStudent[];
  /** Verified prove-it questions, generated offline (pnpm questions:generate); never generated at runtime. */
  bank: LoadedBank;
  /** Mistake Recaps and step explainers, generated and verified offline (pnpm lessons:generate). */
  lessons: LessonLibrary;
  /** Explainer videos, generated and checked offline (pnpm videos:generate). Only passing ones are served. */
  videos: VideoLibrary;
}

let loaded: Store | undefined;

/** Everything read from files, loaded once per process. */
export function store(): Store {
  if (!loaded) {
    const config = loadAppConfig(findRepoRoot());
    const { graph } = loadConceptGraph(config.conceptGraphDir);
    loaded = {
      config,
      graph,
      demo: loadDemoFixtures(config.fixturesDir),
      bank: loadQuestionBank(config.questionBankDir, graph),
      lessons: loadLessons(config, graph),
      videos: loadVideoLibrary(config.videosDir, graph),
    };
  }
  return loaded;
}

let handle: Db | undefined;

/**
 * The SQLite handle, opened once per process, migrated, and (until Phase P)
 * seeded with the demo students when they are missing. The web app and the
 * MCP server each open the same file; SQLite (WAL) handles the two processes.
 */
export function db(): Db {
  if (handle) return handle;
  const s = store();
  const { db: d } = openDb(s.config.databasePath);
  // Bundlers move @progresso/db's files, so point at its migrations from the repo root.
  runMigrations(d, join(/*turbopackIgnore: true*/ s.config.repoRoot, "packages", "db", "drizzle"));
  ensureDemoData(d, s.demo, s.graph);
  handle = d;
  return d;
}

export function demoStudent(id: string): DemoStudent | undefined {
  return store().demo.find((d) => d.student.id === id);
}

export function studentIds(): string[] {
  return store().demo.map((d) => d.student.id);
}

/** Records and their analysis for one student. Phase P: read records from the database. */
export function analysed(studentId: string): { s: DemoStudent; analysis: RootCauseAnalysis } | undefined {
  const { graph } = store();
  const s = demoStudent(studentId);
  if (!s) return undefined;
  return { s, analysis: { ...analyseStudent({ graph, records: s.records }), student_id: s.student.id } };
}

export type Ctx = StudentContext & { records: ErrorRecord[]; next_exam?: { name: string; date: string } };

/** Everything the mission service needs about one student. */
export function studentContext(studentId: string): Ctx | undefined {
  const a = analysed(studentId);
  if (!a) return undefined;
  return {
    student_id: studentId,
    graph: store().graph,
    analysis: a.analysis,
    records: a.s.records,
    bank: store().bank,
    ...(a.s.student.next_exam ? { next_exam: a.s.student.next_exam } : {}),
  };
}

/** The student's "today". SAMPLE DATA students can move their clock forward to demo the plan re-flowing. */
export function studentToday(studentId: string, now = new Date()): IsoDay {
  const offset = getPlanSettings(db(), studentId)?.demo_day_offset ?? 0;
  return addDays(localDay(now), offset);
}

export function isSample(studentId: string): boolean {
  return isSampleStudent(db(), studentId);
}

const layouts = new Map<string, ConstellationLayout>();

/** The layout depends only on the graph and the subjects shown, so it is computed once. */
function layoutFor(subjects: readonly string[]): ConstellationLayout {
  const graph = store().graph;
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
 * database on every call, so missions (web or MCP) change the map just by
 * writing `concept_mastery`.
 */
export function constellation(studentId: string): ConstellationModel | undefined {
  const a = analysed(studentId);
  if (!a) return undefined;
  const graph = store().graph;
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
