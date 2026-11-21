/**
 * The knowledge constellation: the student's syllabus as a star map.
 *
 * Browser-safe (no node: imports) so client components can import the ripple
 * helpers from `@progresso/core/constellation`. The model is plain JSON: the
 * server builds it, the web app (Phase 4) and MCP App widget (Phase 10) draw it.
 */
import type { ReportEvidence } from "../diagnosis-view";

/**
 * Visual state of one concept.
 * - unassessed: no evidence either way (dim)
 * - weak:       the report shows mistakes here (warm red/orange)
 * - root:       a root gap from the engine, the source of other mistakes (pulsing)
 * - learning:   work in progress: a mission has started, or its root is fixed
 *               and the mistakes here are expected to clear (warming to green)
 * - mastered:   proven in a mission (calm green/white)
 */
export type StarState = "unassessed" | "weak" | "root" | "learning" | "mastered";
export const STAR_STATES: readonly StarState[] = ["root", "weak", "learning", "mastered", "unassessed"];

/** Per-student mastery, as stored in the `concept_mastery` table (Phase 5 writes it). */
export type MasteryLevel = "gap" | "learning" | "proven" | "retained";
export interface ConceptMasteryState {
  concept_id: string;
  state: MasteryLevel;
  updated_at?: string;
}

/** Layout coordinates. The disc lies in the x/y plane; h is height above it (3D only). */
export interface StarPosition {
  x: number;
  y: number;
  h: number;
}

export interface ConstellationNode extends StarPosition {
  id: string;
  name: string;
  subject: string;
  unit_id: string;
  class: number;
  chapter: string;
  state: StarState;
  /** Downstream of a mastered root: brightened by the chain reaction. */
  lit: boolean;
  /** Lies on a path from a root to one of the mistakes it explains. */
  on_chain: boolean;
  mastery?: MasteryLevel;
  /** Records mapped to this concept (any role), for the detail panel. */
  record_ids: string[];
  /** Records whose mistake surfaced here (or on the root itself), traced to a root. */
  error_count: number;
  marks_lost: number;
  /** Roots whose explained mistakes pass through this concept. */
  root_ids: string[];
  /** Set on root gaps: the engine's rank. */
  root_rank?: number;
  /** Concepts (in the whole graph) that build on this one, transitively. */
  downstream_count: number;
  board_marks_dependent: number;
  /** Indices into `nodes`. */
  prerequisites: number[];
  dependents: number[];
}

/** Prerequisite thread: `from` is the prerequisite, `to` builds on it. Indices into `nodes`. */
export interface ConstellationEdge {
  from: number;
  to: number;
  /** On a root → mistake path: drawn as a warm, flowing thread. */
  chain: boolean;
}

export interface ConstellationUnit {
  id: string;
  name: string;
  subject: string;
  class: number;
  board_marks: number;
  /** Ring index within the subject disc (0 = foundations core). */
  ring: number;
  /** Sector centre and half-width, radians. A whole-ring unit has half_width = PI. */
  angle: number;
  half_width: number;
  /** 0..360: the unit's tint, so clusters read as clusters. */
  hue: number;
  /** Where the unit's name is drawn: just outside its ring, at the sector centre. */
  label: StarPosition;
  concept_count: number;
}

export interface ConstellationRing {
  label: string;
  inner: number;
  outer: number;
}

export interface ConstellationSubject {
  name: string;
  center: { x: number; y: number };
  radius: number;
  rings: ConstellationRing[];
}

export interface ConstellationRoot {
  id: string;
  rank: number;
  name: string;
  subject: string;
  class: number;
  mastered: boolean;
  explanation: string;
  error_count: number;
  exam_count: number;
  marks_lost: number;
  marks_estimated: boolean;
  /** Concepts in this map that build on the root (what lights up when it is fixed). */
  downstream_count: number;
  board_marks_dependent: number;
  record_ids: string[];
}

export interface ConstellationLayout {
  graph_fingerprint: string;
  subjects: ConstellationSubject[];
  units: ConstellationUnit[];
  positions: Record<string, StarPosition>;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

export interface ConstellationModel {
  student_id: string;
  graph_fingerprint: string;
  subjects: ConstellationSubject[];
  units: ConstellationUnit[];
  nodes: ConstellationNode[];
  edges: ConstellationEdge[];
  roots: ConstellationRoot[];
  /** The report's own words, by record id (verbatim, never rewritten). */
  evidence: Record<string, ReportEvidence>;
  counts: Record<StarState, number>;
  bounds: ConstellationLayout["bounds"];
  /** Changes whenever any star's state changes: the client animates the difference. */
  state_key: string;
}
