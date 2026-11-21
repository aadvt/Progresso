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
  buildDiagnosisView,
  findRepoRoot,
  loadAppConfig,
  loadConceptGraph,
  type ConceptGraph,
  type DiagnosisView,
  type ReportParser,
} from "@progresso/core";
import { DemoFixtureParser, loadDemoFixtures, SAMPLE_DATA_NOTICE, type DemoStudent } from "@progresso/core/demo-fixtures";
import type { StudentSummary } from "@/lib/types";
import { daysUntil } from "@/lib/format";

interface Loaded {
  graph: ConceptGraph;
  demo: DemoStudent[];
}

let loaded: Loaded | undefined;

function load(): Loaded {
  if (!loaded) {
    const config = loadAppConfig(findRepoRoot());
    const { graph } = loadConceptGraph(config.conceptGraphDir);
    loaded = { graph, demo: loadDemoFixtures(config.fixturesDir) };
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

/** The student's diagnosis from every report added so far. */
export function getDiagnosis(studentId: string): DiagnosisView | undefined {
  const { graph, demo } = load();
  const s = demo.find((d) => d.student.id === studentId);
  if (!s) return undefined;
  const analysis = analyseStudent({ graph, records: s.records });
  return buildDiagnosisView({ ...analysis, student_id: s.student.id }, s.records);
}
