/**
 * Every tunable in the mission engine (plan, mastery gate, spaced review,
 * readiness), with the reason for its value. None depend on a particular
 * graph, subject or student.
 */
export interface MissionParams {
  /** Length of one mission. The whole product is built around short daily sessions. */
  missionMinutes: number;
  /** Fixed mission structure: Mistake Recap → explainer → prove-it, in minutes (sums to missionMinutes). */
  stepMinutes: { recap: number; explainer: number; prove_it: number };
  /** Share of a root's estimated missions spent re-learning the root itself; the rest apply it where the mistakes surfaced. */
  learnShare: number;
  /** Bounds on learn missions per root: at least one, and at most this many before moving on to applying it. */
  maxLearnMissions: number;
  /** Extra attempts at a gate the student keeps failing before the plan moves on and flags it for a teacher. */
  maxRetries: number;
  /** A review session holds at most this many concepts (about 5 minutes each). */
  reviewMaxConcepts: number;
  reviewMinutesPerConcept: number;
  /** Take a whole slot for review when this many reviews are due… */
  reviewBatchTrigger: number;
  /** …or when the oldest due review is this many days overdue (memory is fading). */
  reviewMaxOverdueDays: number;
  /** Leftover daily minutes of at least this much host a quick review (e.g. 40 min/day = 1 mission + 15 min review). */
  quickReviewMinMinutes: number;
  /** Days before the exam kept free of new learning: rehearsal and review only. */
  bufferDays: { long: number; short: number; longPlanDays: number; shortPlanDays: number };
  /** Concepts per rehearsal session on buffer days. */
  rehearsalConcepts: number;

  // ---- prove-it gate
  /** Questions in a mastery check, and the share that must be right. */
  checkQuestions: number;
  passShare: number;
  /** Questions per concept in a spaced review. */
  reviewQuestions: number;
  /** A proven concept counts as retained after passing a review at least this many days after it was proven. */
  retainAfterDays: number;

  // ---- FSRS
  requestRetention: number;
  /** Longest gap between reviews. FSRS would happily wait months; before an exam nothing should go two weeks unchecked. */
  maximumIntervalDays: number;

  // ---- readiness
  /** Probability that an error's cause is fixed, by mastery level (point estimate, low, high). */
  fixProbability: Record<"none" | "gap" | "learning" | "proven" | "retained", { mid: number; low: number; high: number }>;
  /** Weight of the root vs the tested topic for a root-explained error. */
  rootWeight: number;
  /** Habits are not taught by missions: chance they are fixed by exam day anyway (tips on the diagnosis page). */
  habitFix: { mid: number; low: number; high: number };
  /** An error with no stated marks is assumed to risk this share of its unit's board weight. */
  weightageLossShare: number;
  /** Exam-to-exam noise, in percentage points either side. */
  examNoisePct: number;
}

export const DEFAULT_MISSION_PARAMS: MissionParams = {
  missionMinutes: 25,
  stepMinutes: { recap: 5, explainer: 10, prove_it: 10 },
  learnShare: 0.35,
  maxLearnMissions: 3,
  maxRetries: 2,
  reviewMaxConcepts: 5,
  reviewMinutesPerConcept: 5,
  reviewBatchTrigger: 3,
  reviewMaxOverdueDays: 2,
  quickReviewMinMinutes: 10,
  bufferDays: { long: 2, short: 1, longPlanDays: 14, shortPlanDays: 5 },
  rehearsalConcepts: 5,

  checkQuestions: 4,
  passShare: 0.75,
  reviewQuestions: 2,
  retainAfterDays: 3,

  requestRetention: 0.9,
  maximumIntervalDays: 14,

  fixProbability: {
    none: { mid: 0, low: 0, high: 0.1 },
    gap: { mid: 0, low: 0, high: 0.1 },
    learning: { mid: 0.35, low: 0.2, high: 0.5 },
    proven: { mid: 0.75, low: 0.6, high: 0.9 },
    retained: { mid: 0.88, low: 0.78, high: 0.95 },
  },
  rootWeight: 0.7,
  habitFix: { mid: 0.25, low: 0.1, high: 0.45 },
  weightageLossShare: 0.15,
  examNoisePct: 3,
};

export function missionParams(overrides: Partial<MissionParams> = {}): MissionParams {
  return { ...DEFAULT_MISSION_PARAMS, ...overrides };
}
