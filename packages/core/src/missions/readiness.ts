/**
 * Readiness meter: a projected score RANGE for the next exam, always labelled
 * as an estimate.
 *
 * Model (per subject, as a percentage of the paper):
 *  - Each diagnosed mistake costs, on an average paper, its marks lost as a
 *    share of its exam's maximum, averaged over the subject's exams.
 *    Starting score = 100 − the sum of those costs (what the reports show).
 *  - Each mistake is won back with the probability that its cause is fixed:
 *    for a root-explained mistake, mostly the root's mastery (and partly the
 *    tested topic's); for a one-off, its topic's mastery. Mastery levels map
 *    to probabilities (params.fixProbability); proven topics are discounted
 *    by FSRS retrievability at the exam date for the low end (if reviews stop).
 *  - When a record has no marks, its cost is estimated from the unit's board
 *    weightage, and the range widens by half that estimate.
 *  - Exam-to-exam noise widens every range by params.examNoisePct.
 * Subjects are averaged with equal weight.
 */
import type { ErrorRecord } from "../error-record/schema";
import { marksLost } from "../error-record/schema";
import type { ConceptGraph } from "../graph/graph";
import type { RootCauseAnalysis } from "../root-cause/types";
import { retrievability } from "./mastery";
import { DEFAULT_MISSION_PARAMS, type MissionParams } from "./params";
import type { ConceptProgress, ProgressState } from "./types";
import type { IsoDay } from "./dates";

export interface ScoreRange {
  low: number;
  mid: number;
  high: number;
}

export interface SubjectReadiness {
  subject: string;
  start: ScoreRange;
  now: ScoreRange;
  potential: ScoreRange;
  /** How the marks at stake were measured. */
  basis: "marks" | "weightage" | "mixed";
  exams: number;
}

export interface ReadinessDriver {
  concept_id: string;
  name: string;
  /** Percentage points of an average paper that ride on this topic. */
  at_stake: number;
  /** Points already won back (mid estimate). */
  won_back: number;
  state: ConceptProgress["state"] | "none";
}

export interface Readiness {
  label: "Estimate";
  start: ScoreRange;
  now: ScoreRange;
  /** If every topic in the plan is proven and held to the exam. */
  potential: ScoreRange;
  basis: "marks" | "weightage" | "mixed";
  subjects: SubjectReadiness[];
  drivers: ReadinessDriver[];
  notes: string[];
}

type Prob = { low: number; mid: number; high: number };

const SLIP_TYPES = new Set(["careless", "calculation", "notation", "incomplete"]);

export function conceptFixProbability(p: ConceptProgress | undefined, examDate: IsoDay, params: MissionParams): Prob {
  if (!p) return { low: 0, mid: 0, high: params.fixProbability.none.high };
  const base = params.fixProbability[p.state];
  if (p.state === "proven" || p.state === "retained") {
    const r = p.card ? retrievability(p.card, examDate, params) : 0.9;
    return { low: base.low * r, mid: base.mid, high: base.high };
  }
  return base;
}

interface Cost {
  subject: string;
  /** Percentage points of an average paper. */
  pct: number;
  estimated: boolean;
  /** Who fixes it: [concept, weight] pairs, or "habit". */
  fixers: [string, number][] | "habit" | "none";
}

export function computeReadiness(input: {
  graph: ConceptGraph;
  analysis: RootCauseAnalysis;
  records: readonly ErrorRecord[];
  progress: ProgressState;
  exam_date: IsoDay;
  /** Concepts the plan targets (for the potential). */
  targeted?: readonly string[];
  params?: Partial<MissionParams>;
}): Readiness {
  const params: MissionParams = { ...DEFAULT_MISSION_PARAMS, ...input.params };
  const { graph, analysis, records, progress } = input;

  // Exams per subject, with their max marks.
  const examMax = new Map<string, number>();
  const examsBySubject = new Map<string, Set<string>>();
  for (const r of records) {
    if (r.exam.max_marks) examMax.set(r.exam.id, r.exam.max_marks);
    examsBySubject.set(r.exam.subject, (examsBySubject.get(r.exam.subject) ?? new Set()).add(r.exam.id));
  }
  for (const e of analysis.exams) examsBySubject.set(e.subject, (examsBySubject.get(e.subject) ?? new Set()).add(e.id));

  // Who fixes each record.
  const fixers = new Map<string, Cost["fixers"]>();
  for (const root of analysis.roots)
    for (const e of root.explains) {
      const tested = e.tested?.id ?? e.anchor.id;
      fixers.set(e.record_id, tested === root.concept.id ? [[root.concept.id, 1]] : [[root.concept.id, params.rootWeight], [tested, 1 - params.rootWeight]]);
    }
  for (const s of analysis.standalone) if (s.concept) fixers.set(s.record_id, [[s.concept.id, 1]]);
  for (const h of analysis.habits) for (const r of h.records) fixers.set(r.record_id, "habit");

  const costs: Cost[] = [];
  for (const r of records) {
    const subject = r.exam.subject;
    const nExams = examsBySubject.get(subject)?.size ?? 1;
    const max = examMax.get(r.exam.id);
    const lost = marksLost(r);
    let pct: number;
    let estimated = false;
    if (lost !== undefined && max) pct = (lost / max) * 100;
    else {
      estimated = true;
      pct = weightageCost(graph, r, params) ?? (max ? (Math.max(1, (r.question.max_marks ?? 2) * 0.5) / max) * 100 : 2);
    }
    const f = fixers.get(r.id) ?? (SLIP_TYPES.has(r.error_type) ? "habit" : "none");
    costs.push({ subject, pct: pct / nExams, estimated, fixers: f });
  }

  // "start" = the same model with no progress at all (so start equals now on day one).
  const probOf = (c: string, mode: "start" | "now" | "potential"): Prob => {
    if (mode === "start") return conceptFixProbability(undefined, input.exam_date, params);
    if (mode === "potential") {
      const targeted = input.targeted ? input.targeted.includes(c) : true;
      if (targeted) return params.fixProbability.retained;
    }
    return conceptFixProbability(progress.concepts[c], input.exam_date, params);
  };
  const recordProb = (c: Cost, mode: "start" | "now" | "potential"): Prob => {
    if (c.fixers === "none") return { low: 0, mid: 0, high: params.fixProbability.none.high };
    if (c.fixers === "habit") return mode === "potential" ? params.habitFix : { low: 0, mid: 0, high: params.habitFix.high };
    const out = { low: 0, mid: 0, high: 0 };
    for (const [concept, w] of c.fixers) {
      const p = probOf(concept, mode);
      out.low += w * p.low;
      out.mid += w * p.mid;
      out.high += w * p.high;
    }
    return out;
  };

  const subjects: SubjectReadiness[] = [];
  for (const subject of [...examsBySubject.keys()].sort()) {
    const sc = costs.filter((c) => c.subject === subject);
    const range = (mode: "start" | "now" | "potential"): ScoreRange => {
      let lossMid = 0;
      let lossLow = 0; // loss at the optimistic end
      let lossHigh = 0; // loss at the pessimistic end
      let widen = 0;
      for (const c of sc) {
        const p = recordProb(c, mode);
        lossMid += c.pct * (1 - p.mid);
        lossLow += c.pct * (1 - p.high);
        lossHigh += c.pct * (1 - p.low);
        if (c.estimated) widen += 0.5 * c.pct * (1 - p.mid);
      }
      const mid = 100 - lossMid;
      return clampRange({
        low: 100 - lossHigh - params.examNoisePct - widen,
        mid,
        high: 100 - lossLow + params.examNoisePct + widen,
      });
    };
    const estShare = sc.length ? sc.filter((c) => c.estimated).reduce((s, c) => s + c.pct, 0) / Math.max(1e-9, sc.reduce((s, c) => s + c.pct, 0)) : 0;
    subjects.push({
      subject,
      start: range("start"),
      now: range("now"),
      potential: range("potential"),
      basis: estShare === 0 ? "marks" : estShare >= 0.999 ? "weightage" : "mixed",
      exams: examsBySubject.get(subject)?.size ?? 0,
    });
  }

  const avg = (k: "start" | "now" | "potential"): ScoreRange => {
    if (subjects.length === 0) return { low: 100 - params.examNoisePct, mid: 100, high: 100 };
    const n = subjects.length;
    return clampRange({
      low: subjects.reduce((s, x) => s + x[k].low, 0) / n,
      mid: subjects.reduce((s, x) => s + x[k].mid, 0) / n,
      high: subjects.reduce((s, x) => s + x[k].high, 0) / n,
    });
  };

  // Drivers: which topics carry the most marks, and how much is already won back.
  const nSubjects = Math.max(1, subjects.length);
  const stake = new Map<string, number>();
  for (const c of costs) {
    if (!Array.isArray(c.fixers)) continue;
    for (const [concept, w] of c.fixers) stake.set(concept, (stake.get(concept) ?? 0) + (c.pct * w) / nSubjects);
  }
  const drivers: ReadinessDriver[] = [...stake.entries()]
    .map(([concept_id, at_stake]) => ({
      concept_id,
      name: graph.has(concept_id) ? graph.get(concept_id).name : concept_id,
      at_stake: round1(at_stake),
      won_back: round1(at_stake * probOf(concept_id, "now").mid),
      state: progress.concepts[concept_id]?.state ?? ("none" as const),
    }))
    .sort((a, b) => b.at_stake - a.at_stake || a.concept_id.localeCompare(b.concept_id));

  const basis = subjects.every((s) => s.basis === "marks") ? "marks" : subjects.every((s) => s.basis === "weightage") ? "weightage" : "mixed";
  const notes = [
    "Estimate from the mistakes in your reports and how much of each you've fixed. Not a promise.",
    ...(basis !== "marks" ? ["Some reports didn't say how many marks a mistake cost, so those are estimated from the chapter's board weightage and the range is wider."] : []),
  ];
  return { label: "Estimate", start: avg("start"), now: avg("now"), potential: avg("potential"), basis, subjects, drivers, notes };
}

/** An error with no stated marks: a share of its unit's board weight within its class, capped at a typical long question. */
function weightageCost(graph: ConceptGraph, r: ErrorRecord, params: MissionParams): number | undefined {
  const primary = r.concepts.find((c) => c.role === "primary") ?? r.concepts[0];
  if (!primary || !graph.has(primary.concept_id)) return undefined;
  const concept = graph.get(primary.concept_id);
  const units = [...graph.units.values()].filter((u) => u.subject === concept.subject);
  const unit = units.find((u) => u.id === concept.unit_id);
  if (!unit) return undefined;
  const classTotal = units.filter((u) => u.class === unit.class).reduce((s, u) => s + u.board_marks, 0);
  if (classTotal <= 0 || unit.board_marks <= 0) return undefined;
  return Math.min(4, (unit.board_marks / classTotal) * 100 * params.weightageLossShare);
}

function clampRange(r: ScoreRange): ScoreRange {
  const c = (x: number) => Math.round(Math.max(0, Math.min(100, x)) * 10) / 10;
  const mid = c(r.mid);
  return { low: Math.min(c(r.low), mid), mid, high: Math.max(c(r.high), mid) };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
