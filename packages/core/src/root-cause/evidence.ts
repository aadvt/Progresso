import { marksLost, type ErrorRecord } from "../error-record/schema";
import type { ConceptGraph } from "../graph/graph";
import type { RootCauseParams } from "./params";
import type { CounterEvidence, LinkVia, MarksValue, MasteryEvidence } from "./types";

/**
 * Step 1 of the engine: turn error records into observations, each linked to
 * every concept that could explain it, with a strength for each link.
 */

export interface Link {
  /** Anchor confidence x hopDecay^hops. */
  strength: number;
  hops: number;
  /** Concept ids from this concept (first) down to the anchor (last). */
  path: string[];
  via: LinkVia;
}

export type ObservationKind = "evidence" | "habit" | "unmapped";

export interface Observation {
  record: ErrorRecord;
  kind: ObservationKind;
  /** errorTypeWeight x recency. 0 for habits. */
  weight: number;
  typeWeight: number;
  recency: number;
  marks: MarksValue;
  /** Every concept that could explain this error (anchors and their ancestors). */
  links: Map<string, Link>;
  primaryConcept?: string;
}

const VIA_ORDER: Record<LinkVia, number> = { primary: 0, misconception: 1, secondary: 2 };

function better(a: Link, b: Link | undefined): boolean {
  if (!b) return true;
  if (a.strength !== b.strength) return a.strength > b.strength;
  if (a.hops !== b.hops) return a.hops < b.hops;
  if (a.via !== b.via) return VIA_ORDER[a.via] < VIA_ORDER[b.via];
  return a.path.join(">") < b.path.join(">");
}

/** Where a record points in the graph, before walking up. Unknown ids are reported, not fatal. */
export function anchorsOf(
  record: ErrorRecord,
  graph: ConceptGraph,
  params: RootCauseParams,
  warn: (msg: string) => void,
): Map<string, { strength: number; via: LinkVia }> {
  const anchors = new Map<string, { strength: number; via: LinkVia }>();
  const offer = (id: string, strength: number, via: LinkVia): void => {
    const prev = anchors.get(id);
    if (!prev || strength > prev.strength) anchors.set(id, { strength, via });
  };
  for (const m of record.concepts) {
    if (!graph.has(m.concept_id)) {
      warn(`${record.id}: concept "${m.concept_id}" is not in the current graph (re-map needed); mapping ignored`);
      continue;
    }
    offer(m.concept_id, m.role === "primary" ? m.confidence : m.confidence * params.secondaryRoleFactor, m.role);
  }
  if (record.misconception) {
    const owner = graph.misconceptions.get(record.misconception.misconception_id);
    if (owner) offer(owner.concept_id, record.misconception.confidence, "misconception");
    else warn(`${record.id}: misconception "${record.misconception.misconception_id}" is not in the current graph; ignored`);
  }
  return anchors;
}

/** Walk up the prerequisite graph from each anchor, keeping the strongest link per concept. */
export function linksFrom(
  anchors: Map<string, { strength: number; via: LinkVia }>,
  graph: ConceptGraph,
  params: RootCauseParams,
): Map<string, Link> {
  const links = new Map<string, Link>();
  for (const [anchor, { strength, via }] of [...anchors].sort(([a], [b]) => a.localeCompare(b))) {
    // Breadth-first, so the first time we reach a concept is by the fewest hops (strongest link from this anchor).
    const seen = new Set<string>([anchor]);
    let frontier: { id: string; path: string[] }[] = [{ id: anchor, path: [anchor] }];
    for (let hops = 0; frontier.length > 0; hops++) {
      const s = strength * params.hopDecay ** hops;
      if (s < params.minLinkStrength) break;
      const next: { id: string; path: string[] }[] = [];
      for (const { id, path } of frontier) {
        const link: Link = { strength: s, hops, path, via };
        if (better(link, links.get(id))) links.set(id, link);
        for (const p of graph.prerequisitesOf(id)) {
          if (seen.has(p)) continue;
          seen.add(p);
          next.push({ id: p, path: [p, ...path] });
        }
      }
      frontier = next;
    }
  }
  return links;
}

function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1]! + s[mid]!) / 2;
}

/** Marks lost per record, with a documented fallback when the record gives none. */
export function marksEstimator(records: ErrorRecord[], params: RootCauseParams): (r: ErrorRecord) => MarksValue {
  const maxOf = (r: ErrorRecord): number | undefined => r.marks?.max ?? r.question.max_marks;
  const known = records.map((r) => ({ r, lost: marksLost(r) })).filter((x) => x.lost !== undefined);
  const fractions = known.flatMap(({ r, lost }) => {
    const max = maxOf(r);
    return max ? [lost! / max] : [];
  });
  const typicalFraction = median(fractions) ?? params.defaultLostFraction;
  const typicalLost = median(known.map((x) => x.lost!)) ?? params.defaultMarksLost;
  return (r) => {
    const lost = marksLost(r);
    if (lost !== undefined) return { value: lost, estimated: false };
    const max = maxOf(r);
    const value = max !== undefined ? max * typicalFraction : typicalLost;
    return { value: Math.round(value * 2) / 2, estimated: true };
  };
}

const DAY_MS = 86_400_000;

export function buildObservations(
  records: ErrorRecord[],
  graph: ConceptGraph,
  params: RootCauseParams,
  warn: (msg: string) => void,
): Observation[] {
  const latest = Math.max(...records.map((r) => Date.parse(`${r.exam.date}T00:00:00Z`)));
  const estimate = marksEstimator(records, params);
  return records.map((record): Observation => {
    const ageDays = (latest - Date.parse(`${record.exam.date}T00:00:00Z`)) / DAY_MS;
    const recency = params.recencyFloor + (1 - params.recencyFloor) * 0.5 ** (ageDays / params.recencyHalfLifeDays);
    const typeWeight = params.errorTypeWeight[record.error_type];
    const anchors = anchorsOf(record, graph, params, warn);
    const links = linksFrom(anchors, graph, params);
    const primaryConcept = record.concepts.find((c) => c.role === "primary" && graph.has(c.concept_id))?.concept_id;
    const kind: ObservationKind = typeWeight === 0 ? "habit" : anchors.size === 0 ? "unmapped" : "evidence";
    return {
      record,
      kind,
      weight: kind === "evidence" ? typeWeight * recency : 0,
      typeWeight,
      recency,
      marks: estimate(record),
      links,
      primaryConcept: primaryConcept ?? [...anchors.keys()][0],
    };
  });
}

/**
 * Evidence the student understands a concept, spread to its prerequisites
 * with the same per-hop fading. Combined as a noisy-OR per concept:
 * `against(c)` is the share of blame on c that this evidence cancels.
 */
export class MasteryMap {
  private readonly byConcept = new Map<string, CounterEvidence[]>();

  constructor(observations: Observation[], mastery: MasteryEvidence[], graph: ConceptGraph, params: RootCauseParams, warn: (msg: string) => void) {
    const sources: { concept: string; strength: number; source: CounterEvidence["source"]; detail: string }[] = [];
    for (const o of observations) {
      if (o.record.error_type !== "careless" && o.record.error_type !== "calculation") continue;
      for (const m of o.record.concepts) {
        if (m.role === "primary" && graph.has(m.concept_id)) {
          sources.push({ concept: m.concept_id, strength: params.slipMasteryStrength * m.confidence, source: "slip_record", detail: o.record.id });
        }
      }
    }
    for (const m of mastery) {
      if (!graph.has(m.concept_id)) {
        warn(`mastery evidence for unknown concept "${m.concept_id}" ignored`);
        continue;
      }
      sources.push({ concept: m.concept_id, strength: m.strength, source: m.source, detail: m.note ?? m.exam_id ?? m.source });
    }
    for (const s of sources) {
      const links = linksFrom(new Map([[s.concept, { strength: s.strength, via: "primary" as const }]]), graph, params);
      for (const [concept, link] of links) {
        const list = this.byConcept.get(concept) ?? [];
        list.push({ concept_id: s.concept, source: s.source, detail: s.detail, strength: link.strength });
        this.byConcept.set(concept, list);
      }
    }
  }

  against(concept: string): number {
    const list = this.byConcept.get(concept);
    if (!list) return 0;
    return 1 - list.reduce((p, e) => p * (1 - e.strength), 1);
  }

  evidence(concept: string): CounterEvidence[] {
    return [...(this.byConcept.get(concept) ?? [])].sort((a, b) => b.strength - a.strength || a.detail.localeCompare(b.detail));
  }
}
