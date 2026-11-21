/**
 * Mastery gating and spaced repetition.
 *
 * The rule ("prove it"):
 *  - A mastery check has `checkQuestions` questions aimed at the concept's
 *    misconceptions, the student's own (from the report) first.
 *  - It passes when at least `passShare` of the answers are right AND none of
 *    the wrong answers is one of the student's own report misconceptions.
 *    Getting 3 of 4 right by picking your old mistake on the fourth is not
 *    proof the mistake is gone.
 *  - Pass → `proven`. Fail → `learning` (or stays a gap if nothing was right),
 *    and every wrong pick is recorded with the misconception it reveals.
 *  - A spaced review (FSRS) checks a proven concept again. Passing one at least
 *    `retainAfterDays` after it was proven → `retained`. Failing → back to
 *    `learning` (an FSRS lapse) and the plan adds a re-learn mission.
 *
 * FSRS (ts-fsrs) schedules the reviews: every check is one FSRS review, rated
 * Again (fail), Hard (pass with a miss) or Good (all right).
 */
import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type FSRS, type Grade } from "ts-fsrs";
import type { MasteryLevel } from "../constellation/types";
import { dayToInstant, daysBetween, instantToDay, type IsoDay } from "./dates";
import { DEFAULT_MISSION_PARAMS, type MissionParams } from "./params";
import type { ConceptProgress, SerializedCard } from "./types";

export { Rating };

/** One answered question. */
export interface AnswerResult {
  question_id: string;
  /** The misconception the question was built to catch. */
  target_misconception_id?: string;
  correct: boolean;
  /** When wrong: the misconception the chosen option (or numeric answer) stands for, if known. */
  revealed_misconception_id?: string;
}

export type CheckKind = "gate" | "review";

export interface CheckOutcome {
  kind: CheckKind;
  passed: boolean;
  correct: number;
  total: number;
  /** Misconceptions revealed by wrong answers (distinct, in order). */
  revealed: string[];
  /** Of those, the ones the report already showed in this student's work. */
  own_revealed: string[];
  rating: Grade;
  /** Plain-language reason, shown to the student. */
  reason: string;
}

export function gradeCheck(
  answers: AnswerResult[],
  opts: { kind: CheckKind; own_misconceptions: readonly string[] },
  params: MissionParams = DEFAULT_MISSION_PARAMS,
): CheckOutcome {
  const total = answers.length;
  const correct = answers.filter((a) => a.correct).length;
  const revealed = [...new Set(answers.filter((a) => !a.correct && a.revealed_misconception_id).map((a) => a.revealed_misconception_id!))];
  const own = new Set(opts.own_misconceptions);
  const own_revealed = revealed.filter((m) => own.has(m));
  if (total === 0) return { kind: opts.kind, passed: false, correct, total, revealed, own_revealed, rating: Rating.Again, reason: "No questions were answered." };

  const need = opts.kind === "gate" ? Math.ceil(params.passShare * total - 1e-9) : Math.ceil(total / 2);
  const enough = correct >= need;
  const passed = enough && own_revealed.length === 0;
  const rating: Grade = !passed ? Rating.Again : correct === total ? Rating.Good : Rating.Hard;
  const reason = passed
    ? correct === total
      ? `All ${total} right.`
      : `${correct} of ${total} right, and the mistake from your report didn't come back.`
    : own_revealed.length > 0 && enough
      ? `${correct} of ${total} right, but the mistake from your report came back, so not yet.`
      : `${correct} of ${total} right; ${need} needed.`;
  return { kind: opts.kind, passed, correct, total, revealed, own_revealed, rating, reason };
}

// ---------------------------------------------------------------- FSRS

const schedulers = new Map<string, FSRS>();

/** Day-level FSRS: no fuzz (deterministic plans) and no intra-day learning steps (missions are daily). */
export function scheduler(params: MissionParams = DEFAULT_MISSION_PARAMS): FSRS {
  const key = `${params.requestRetention}|${params.maximumIntervalDays}`;
  let f = schedulers.get(key);
  if (!f) {
    f = fsrs(
      generatorParameters({
        enable_fuzz: false,
        enable_short_term: false,
        request_retention: params.requestRetention,
        maximum_interval: params.maximumIntervalDays,
      }),
    );
    schedulers.set(key, f);
  }
  return f;
}

export function serializeCard(c: Card): SerializedCard {
  return {
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    ...(c.last_review ? { last_review: c.last_review.toISOString() } : {}),
  };
}

export function deserializeCard(s: SerializedCard): Card {
  return {
    ...s,
    due: new Date(s.due),
    state: s.state,
    last_review: s.last_review ? new Date(s.last_review) : undefined,
  };
}

/** Review a card on a day with a rating; returns the new card. */
export function reviewCard(card: SerializedCard | undefined, day: IsoDay, rating: Grade, params: MissionParams = DEFAULT_MISSION_PARAMS): SerializedCard {
  const now = dayToInstant(day);
  const c = card ? deserializeCard(card) : createEmptyCard(now);
  const next = scheduler(params).next(c, now, rating).card;
  // ts-fsrs keeps Good one day longer than Hard, which can overshoot maximum_interval by a day: clamp.
  const maxDue = now.getTime() + params.maximumIntervalDays * 86_400_000;
  if (next.due.getTime() > maxDue) {
    next.due = new Date(maxDue);
    next.scheduled_days = params.maximumIntervalDays;
  }
  return serializeCard(next);
}

/** Probability of recalling the concept on a day (FSRS retrievability). 0 if never reviewed. */
export function retrievability(card: SerializedCard | undefined, day: IsoDay, params: MissionParams = DEFAULT_MISSION_PARAMS): number {
  if (!card || card.reps === 0) return 0;
  return scheduler(params).get_retrievability(deserializeCard(card), dayToInstant(day), false);
}

/**
 * The new progress for a concept after a check. Pure: the caller persists it.
 */
export function applyCheck(
  prev: ConceptProgress | undefined,
  outcome: CheckOutcome,
  day: IsoDay,
  params: MissionParams = DEFAULT_MISSION_PARAMS,
): ConceptProgress {
  const card = reviewCard(prev?.card, day, outcome.rating, params);
  const was: MasteryLevel | undefined = prev?.state;
  let state: MasteryLevel;
  let proven_at = prev?.proven_at;
  if (outcome.passed) {
    if (outcome.kind === "review" && (was === "proven" || was === "retained")) {
      state = was === "retained" || (proven_at !== undefined && daysBetween(proven_at, day) >= params.retainAfterDays) ? "retained" : "proven";
    } else {
      state = was === "retained" ? "retained" : "proven";
      if (was !== "proven" && was !== "retained") proven_at = day;
    }
  } else {
    state = outcome.correct === 0 && (was === undefined || was === "gap") ? "gap" : "learning";
    proven_at = undefined;
  }
  return { state, card, stability: card.stability, due: instantToDay(card.due), ...(proven_at ? { proven_at } : {}) };
}

// ---------------------------------------------------------------- misconceptions

export interface MisconceptionEvent {
  at: string;
  /** A wrong answer revealing it, or a right answer to a question built to catch it. */
  misconception_id: string;
  revealed: boolean;
}

export interface MisconceptionStatus {
  id: string;
  alive: boolean;
  /** Where we last learnt about it. */
  source: "report" | "check";
  times_revealed: number;
  times_cleared: number;
  last_at?: string;
}

/**
 * Which misconceptions are still alive. The report's misconceptions start
 * alive; a wrong pick that reveals one keeps (or makes) it alive; a right
 * answer to a question built to catch it clears it, until it shows up again.
 */
export function misconceptionStatus(fromReport: readonly string[], events: readonly MisconceptionEvent[]): Map<string, MisconceptionStatus> {
  const out = new Map<string, MisconceptionStatus>();
  for (const id of fromReport) out.set(id, { id, alive: true, source: "report", times_revealed: 0, times_cleared: 0 });
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    const s = out.get(e.misconception_id) ?? { id: e.misconception_id, alive: false, source: "check" as const, times_revealed: 0, times_cleared: 0 };
    if (e.revealed) {
      s.alive = true;
      s.times_revealed++;
    } else {
      s.alive = false;
      s.times_cleared++;
    }
    s.source = "check";
    s.last_at = e.at;
    out.set(e.misconception_id, s);
  }
  return out;
}

export function eventsFromAnswers(answers: readonly AnswerResult[], at: string): MisconceptionEvent[] {
  const out: MisconceptionEvent[] = [];
  for (const a of answers) {
    if (a.correct && a.target_misconception_id) out.push({ at, misconception_id: a.target_misconception_id, revealed: false });
    if (!a.correct && a.revealed_misconception_id) out.push({ at, misconception_id: a.revealed_misconception_id, revealed: true });
  }
  return out;
}

export const isMastered = (s: MasteryLevel | undefined): boolean => s === "proven" || s === "retained";
