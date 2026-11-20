import type { ErrorRecord } from "../error-record/schema";
import type { ConceptGraph } from "../graph/graph";
import { buildObservations, MasteryMap, type Observation } from "./evidence";
import { HABIT_TEXT, headline, rootExplanationTemplate, standaloneExplanation } from "./explain";
import { resolveParams, type RootCauseParams } from "./params";
import { RootSelector } from "./select";
import type {
  ConceptRef,
  ExplainedError,
  HabitPattern,
  MasteryEvidence,
  RootCauseAnalysis,
  RootFinding,
  StandaloneError,
} from "./types";

export interface AnalyseInput {
  graph: ConceptGraph;
  /** One student's error records, from any number of exams and subjects. */
  records: readonly ErrorRecord[];
  /** Optional evidence of concepts the student has shown they understand. */
  mastery?: readonly MasteryEvidence[];
  params?: Partial<RootCauseParams>;
}

const round = (n: number, dp = 2): number => Math.round(n * 10 ** dp) / 10 ** dp;
const ceilHalf = (n: number): number => Math.ceil(n * 2 - 1e-9) / 2;

export function conceptRef(graph: ConceptGraph, id: string): ConceptRef {
  const c = graph.get(id);
  return { id: c.id, name: c.name, subject: c.subject, class: c.class, unit_id: c.unit_id, chapter: c.chapter };
}

/** Board marks of syllabus resting on a concept: each unit's marks x the share of its concepts that are the concept or build on it. */
export function boardMarksDependent(graph: ConceptGraph, id: string): number {
  const affected = graph.descendantsOf(id);
  affected.add(id);
  const unitSize = new Map<string, number>();
  const unitHit = new Map<string, number>();
  for (const c of graph.concepts.values()) {
    unitSize.set(c.unit_id, (unitSize.get(c.unit_id) ?? 0) + 1);
    if (affected.has(c.id)) unitHit.set(c.unit_id, (unitHit.get(c.unit_id) ?? 0) + 1);
  }
  let total = 0;
  for (const [unit, hit] of unitHit) total += ((graph.units.get(unit)?.board_marks ?? 0) * hit) / unitSize.get(unit)!;
  return round(total, 1);
}

/**
 * The root-cause engine. Given one student's error records and the
 * prerequisite graph, find the smallest set of root gaps that best explains
 * the mistakes, and rank them by marks recoverable per hour of study.
 * Pure and deterministic: no I/O, no LLM, no clock.
 */
export function analyseStudent(input: AnalyseInput): RootCauseAnalysis {
  const { graph } = input;
  const params = resolveParams(input.params);
  const warnings: string[] = [];
  const warn = (m: string): void => void warnings.push(m);
  // Sort so the result never depends on input order.
  const records = [...input.records].sort((a, b) => a.exam.date.localeCompare(b.exam.date) || a.id.localeCompare(b.id));
  const studentIds = [...new Set(records.map((r) => r.student.id))];
  if (studentIds.length > 1) throw new Error(`analyseStudent expects one student's records, got ${studentIds.join(", ")}`);

  const exams = [...new Map(records.map((r) => [r.exam.id, r.exam])).values()].map((e) => ({
    id: e.id,
    name: e.name,
    date: e.date,
    subject: e.subject,
  }));

  if (records.length === 0) {
    const empty = { roots: [], habits: [], summary: emptySummary() };
    return { graph_fingerprint: graph.fingerprint, exams, headline: headline(empty), ...empty, standalone: [], warnings, params };
  }

  const obs = buildObservations(records, graph, params, warn);
  const mastery = new MasteryMap(obs, [...(input.mastery ?? [])], graph, params, warn);
  const coverage = coverageCounter(graph, obs);
  const selector = new RootSelector(obs, mastery, params, (id) => quietShare(coverage(id)));
  const selection = selector.select();

  const explainedObs = new Set<number>();
  const roots: RootFinding[] = selection.roots.map((rootId) => {
    const assigned = selection.assignments.filter((a) => a.root === rootId);
    for (const a of assigned) explainedObs.add(a.obs);
    const explains = assigned
      .map((a) => explainedError(graph, obs[a.obs]!, rootId))
      .sort((x, y) => x.exam_date.localeCompare(y.exam_date) || x.record_id.localeCompare(y.record_id));

    // Noisy-OR: each explained error is an independent chance that the root is really broken;
    // evidence the student knows the concept then scales it down.
    const openness = selector.candidates.get(rootId)!.openness;
    const support =
      1 -
      assigned.reduce((p, a) => {
        const o = obs[a.obs]!;
        return p * (1 - params.confidencePerError * o.typeWeight * o.recency * a.link * a.repeat);
      }, 1);
    const confidence = round(support * openness);

    const lost = assigned.reduce((s, a) => s + obs[a.obs]!.marks.value, 0);
    const estimatedPart = assigned.reduce((s, a) => s + (obs[a.obs]!.marks.estimated ? obs[a.obs]!.marks.value : 0), 0);
    const board = boardMarksDependent(graph, rootId);
    const recoverable = round(confidence * (lost + params.boardMarksFactor * board), 1);
    const topics = new Set(explains.map((e) => (e.tested ?? e.anchor).id).filter((id) => id !== rootId)).size;
    const studyHours = ceilHalf(Math.min(params.rootMaxHours, params.rootBaseHours + params.rootHoursPerTopic * topics));

    const misconceptionCounts = new Map<string, number>();
    for (const a of assigned) {
      const m = obs[a.obs]!.record.misconception;
      if (m && graph.misconceptions.has(m.misconception_id)) {
        misconceptionCounts.set(m.misconception_id, (misconceptionCounts.get(m.misconception_id) ?? 0) + 1);
      }
    }
    const finding: Omit<RootFinding, "explanation" | "explanation_source"> = {
      rank: 0,
      concept: conceptRef(graph, rootId),
      confidence,
      confidence_label: confidence >= 0.75 ? "high" : confidence >= 0.5 ? "medium" : "low",
      explains,
      exam_ids: [...new Set(explains.map((e) => e.exam_id))],
      misconceptions: [...misconceptionCounts]
        .map(([id, count]) => ({ id, description: graph.misconceptions.get(id)!.description, count }))
        .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
      marks: { lost: round(lost, 1), estimated_part: round(estimatedPart, 1), board_marks_dependent: board, recoverable },
      coverage: coverage(rootId),
      study_hours: studyHours,
      missions: Math.ceil((studyHours * 60) / params.missionMinutes),
      priority: round(recoverable / studyHours),
      evidence_against: mastery.evidence(rootId).slice(0, 5).map((e) => ({ ...e, strength: round(e.strength) })),
      close_alternatives: selector
        .alternatives(selection, rootId, params.closeAlternativeRatio)
        .map((alt) => ({ concept: conceptRef(graph, alt.id), relative_fit: round(alt.ratio) })),
    };
    return { ...finding, explanation: rootExplanationTemplate(finding), explanation_source: "template" as const };
  });
  roots.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence || a.concept.id.localeCompare(b.concept.id));
  roots.forEach((r, i) => (r.rank = i + 1));

  // Errors no root explains: knowledge errors stand alone; slips and unfinished answers are habits.
  const standalone: StandaloneError[] = [];
  const habitObs: Observation[] = [];
  obs.forEach((o, i) => {
    if (explainedObs.has(i)) return;
    if (o.kind === "habit" || o.record.error_type === "incomplete") {
      habitObs.push(o);
      return;
    }
    const base: Omit<StandaloneError, "explanation"> = {
      record_id: o.record.id,
      question_ref: o.record.question.ref,
      exam_id: o.record.exam.id,
      exam_name: o.record.exam.name,
      error_type: o.record.error_type,
      ...(o.primaryConcept ? { concept: conceptRef(graph, o.primaryConcept) } : {}),
      reason: o.kind === "unmapped" ? "unmapped" : "no_shared_root",
      marks_lost: o.marks,
      study_hours: params.standaloneHours,
    };
    standalone.push({ ...base, explanation: standaloneExplanation(base) });
  });
  standalone.sort((a, b) => b.marks_lost.value - a.marks_lost.value || a.record_id.localeCompare(b.record_id));

  const habits = habitPatterns(habitObs, graph);
  const sum = (xs: Observation[]): number => xs.reduce((s, o) => s + o.marks.value, 0);
  const summary: RootCauseAnalysis["summary"] = {
    total_errors: records.length,
    explained_by_roots: explainedObs.size,
    standalone: standalone.length,
    habit_errors: habitObs.length,
    marks_lost_total: round(sum(obs), 1),
    marks_explained_by_roots: round(sum([...explainedObs].map((i) => obs[i]!)), 1),
    marks_include_estimates: obs.some((o) => o.marks.estimated),
  };
  return {
    student_id: studentIds[0],
    graph_fingerprint: graph.fingerprint,
    exams,
    headline: headline({ roots, summary, habits }),
    summary,
    roots,
    standalone,
    habits,
    warnings,
    params,
  };
}

/**
 * Branch coverage of a candidate root: how many of the topics built directly
 * on it (in the subjects the records come from, up to the highest class mapped)
 * lead to an error, i.e. are an error's concept or a prerequisite of one.
 */
function coverageCounter(graph: ConceptGraph, obs: Observation[]): (id: string) => RootFinding["coverage"] {
  const subjects = new Set<string>();
  let maxClass = 0;
  const touched = new Set<string>();
  const anchors = new Set<string>();
  for (const o of obs) {
    if (o.kind !== "evidence") continue;
    for (const [id, link] of o.links) {
      touched.add(id);
      if (link.hops === 0) {
        anchors.add(id);
        const c = graph.get(id);
        subjects.add(c.subject);
        maxClass = Math.max(maxClass, c.class);
      }
    }
  }
  return (id) => {
    let branches = 0;
    let hit = 0;
    for (const d of graph.dependentsOf(id)) {
      const c = graph.get(d);
      if (!subjects.has(c.subject) || c.class > maxClass) continue;
      branches++;
      if (touched.has(d)) hit++;
    }
    return { branches, branches_with_errors: hit, root_itself: anchors.has(id) };
  };
}

/** Share of a root's branches (itself counted as one if an error sits there) that show no errors. */
export function quietShare(c: RootFinding["coverage"]): number {
  const total = c.branches + (c.root_itself ? 1 : 0);
  return total === 0 ? 0 : 1 - (c.branches_with_errors + (c.root_itself ? 1 : 0)) / total;
}

function explainedError(graph: ConceptGraph, o: Observation, rootId: string): ExplainedError {
  const link = o.links.get(rootId)!;
  const anchor = link.path[link.path.length - 1]!;
  const tested = o.primaryConcept;
  const testedPath = tested ? prerequisitePath(graph, rootId, tested) : undefined;
  return {
    record_id: o.record.id,
    question_ref: o.record.question.ref,
    exam_id: o.record.exam.id,
    exam_name: o.record.exam.name,
    exam_date: o.record.exam.date,
    error_type: o.record.error_type,
    anchor: conceptRef(graph, anchor),
    path: link.path.map((id) => conceptRef(graph, id)),
    hops: link.hops,
    link_strength: round(link.strength),
    via: link.via,
    ...(tested ? { tested: conceptRef(graph, tested) } : {}),
    ...(testedPath ? { tested_path: testedPath.map((id) => conceptRef(graph, id)) } : {}),
    marks_lost: o.marks,
  };
}

/** Shortest prerequisite chain from `ancestor` down to `concept` (ancestor first), if there is one. */
export function prerequisitePath(graph: ConceptGraph, ancestor: string, concept: string): string[] | undefined {
  const parent = new Map<string, string | null>([[concept, null]]);
  const queue = [concept];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    if (id === ancestor) {
      const path: string[] = [];
      for (let at: string | null = id; at !== null; at = parent.get(at)!) path.push(at);
      return path;
    }
    for (const p of graph.prerequisitesOf(id)) {
      if (!parent.has(p)) {
        parent.set(p, id);
        queue.push(p);
      }
    }
  }
  return undefined;
}

function habitPatterns(habitObs: Observation[], graph: ConceptGraph): HabitPattern[] {
  const toRecord = (o: Observation): HabitPattern["records"][number] => ({
    record_id: o.record.id,
    question_ref: o.record.question.ref,
    exam_name: o.record.exam.name,
    error_type: o.record.error_type,
    ...(o.primaryConcept ? { concept_id: o.primaryConcept } : {}),
    marks_lost: o.marks,
  });
  const make = (kind: HabitPattern["kind"], members: Observation[], misconception?: HabitPattern["misconception"]): HabitPattern => ({
    kind,
    label: misconception ? `${HABIT_TEXT.repeated_slip.label}: ${misconception.description.replace(/\.$/, "")}` : HABIT_TEXT[kind].label,
    tip: HABIT_TEXT[kind].tip,
    ...(misconception ? { misconception } : {}),
    records: members.map(toRecord),
    marks_lost: round(members.reduce((s, o) => s + o.marks.value, 0), 1),
    estimated_part: round(members.reduce((s, o) => s + (o.marks.estimated ? o.marks.value : 0), 0), 1),
  });

  const patterns: HabitPattern[] = [];
  const used = new Set<Observation>();
  // The same named slip twice or more is its own pattern, whatever its error type.
  const byMisconception = new Map<string, Observation[]>();
  for (const o of habitObs) {
    const id = o.record.misconception?.misconception_id;
    if (id && graph.misconceptions.has(id)) byMisconception.set(id, [...(byMisconception.get(id) ?? []), o]);
  }
  for (const [id, members] of [...byMisconception].sort(([a], [b]) => a.localeCompare(b))) {
    if (members.length < 2) continue;
    members.forEach((m) => used.add(m));
    patterns.push(make("repeated_slip", members, { id, description: graph.misconceptions.get(id)!.description }));
  }
  const byType = new Map<HabitPattern["kind"], Observation[]>();
  for (const o of habitObs) {
    if (used.has(o)) continue;
    byType.set(o.record.error_type, [...(byType.get(o.record.error_type) ?? []), o]);
  }
  for (const [kind, members] of byType) patterns.push(make(kind, members));
  return patterns.sort((a, b) => b.marks_lost - a.marks_lost || b.records.length - a.records.length || a.label.localeCompare(b.label));
}

function emptySummary(): RootCauseAnalysis["summary"] {
  return {
    total_errors: 0,
    explained_by_roots: 0,
    standalone: 0,
    habit_errors: 0,
    marks_lost_total: 0,
    marks_explained_by_roots: 0,
    marks_include_estimates: false,
  };
}
