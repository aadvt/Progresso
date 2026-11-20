import type { ErrorType } from "../error-record/schema";

/**
 * Every tunable number in the root-cause engine, in one place, with the
 * reason for its value. None of these depend on a particular graph, subject
 * or student: they describe how much to trust each kind of evidence.
 */
export interface RootCauseParams {
  /**
   * How strongly an error of each type points at a knowledge gap.
   * Slips (careless, calculation, notation) are 0: they are habits, not gaps,
   * and are reported as habit patterns instead of starting a root hunt.
   */
  errorTypeWeight: Record<ErrorType, number>;
  /** A secondary concept mapping counts this much relative to its stated confidence. */
  secondaryRoleFactor: number;
  /**
   * Evidence strength kept per prerequisite step. Each step back gives the
   * mistake one more place it could have come from, so blame fades with distance.
   * This is what stops the most basic concept from collecting everything.
   */
  hopDecay: number;
  /** Links weaker than this are dropped while walking up the graph (bounds work on large graphs). */
  minLinkStrength: number;
  /** A record counts as "explained" by a root only if its link to that root is at least this strong. */
  minExplainedLink: number;
  /** A root must explain at least this many separate questions; otherwise the error stands alone. */
  minRecordsPerRoot: number;
  /**
   * A root must be a SHARED explanation: after removing its single strongest
   * error, the rest must still add at least this much evidence. Stops one
   * strongly mapped error plus a few faint, distant links from forming a root.
   */
  minSharedEvidence: number;
  /**
   * The evidence a root must add before we name it (Occam's razor). In units of
   * "one confidently mapped conceptual error at the concept itself".
   */
  rootCost: number;
  /**
   * Extra cost, scaled by the share of a concept's direct branches with NO
   * mistakes. If a concept were really broken, trouble would show up across
   * the topics built directly on it (in the subjects and classes examined),
   * not in one corner. "Mistakes in 5 of the 6 topics built on it" is a
   * strong suspect; "1 of 5" is weaker than the concept heading that one branch.
   * An error mapped to the concept itself counts as one more branch.
   */
  branchCost: number;
  /**
   * Second and later errors on the same root in the same exam count this much.
   * The same mistake repeated in different exams is stronger evidence than
   * twice in one paper (could be one bad day).
   */
  sameExamRepeatFactor: number;
  /** Older exams count less, never below `recencyFloor`. Measured from the student's latest exam, not the clock. */
  recencyHalfLifeDays: number;
  recencyFloor: number;
  /**
   * A careless or calculation slip says the method was right, which is evidence
   * the concept (and, fading by hopDecay, its prerequisites) is understood.
   */
  slipMasteryStrength: number;
  /** Per-error reliability in the noisy-OR confidence: one strong error alone gives at most this. */
  confidencePerError: number;
  /** In "marks recoverable", each board mark resting on the root counts this much (lost marks count 1). */
  boardMarksFactor: number;
  /** Fallbacks when a record has no marks: fraction of max marks, or a flat number when max is unknown too. */
  defaultLostFraction: number;
  defaultMarksLost: number;
  /** Study-time estimate: base hours to re-learn a root, plus per downstream topic to practise applying it. */
  rootBaseHours: number;
  rootHoursPerTopic: number;
  rootMaxHours: number;
  standaloneHours: number;
  missionMinutes: number;
  /** A swap that keeps at least this share of the objective is reported as a close alternative. */
  closeAlternativeRatio: number;
}

export const DEFAULT_ROOT_CAUSE_PARAMS: RootCauseParams = {
  errorTypeWeight: {
    conceptual: 1,
    procedural: 0.7,
    unclassified: 0.5,
    incomplete: 0.4,
    unattempted: 0.3,
    calculation: 0,
    careless: 0,
    notation: 0,
  },
  secondaryRoleFactor: 0.85,
  hopDecay: 0.65,
  minLinkStrength: 0.05,
  minExplainedLink: 0.2,
  minRecordsPerRoot: 2,
  minSharedEvidence: 0.4,
  rootCost: 1,
  branchCost: 0.6,
  sameExamRepeatFactor: 0.75,
  recencyHalfLifeDays: 120,
  recencyFloor: 0.6,
  slipMasteryStrength: 0.3,
  confidencePerError: 0.6,
  boardMarksFactor: 0.1,
  defaultLostFraction: 0.6,
  defaultMarksLost: 2,
  rootBaseHours: 1.5,
  rootHoursPerTopic: 0.5,
  rootMaxHours: 6,
  standaloneHours: 0.5,
  missionMinutes: 25,
  closeAlternativeRatio: 0.9,
};

export function resolveParams(overrides: Partial<RootCauseParams> = {}): RootCauseParams {
  return {
    ...DEFAULT_ROOT_CAUSE_PARAMS,
    ...overrides,
    errorTypeWeight: { ...DEFAULT_ROOT_CAUSE_PARAMS.errorTypeWeight, ...overrides.errorTypeWeight },
  };
}
