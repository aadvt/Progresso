/**
 * The comeback plan: the remaining work (work.ts) placed on days, from today
 * to the day before the exam, inside the student's daily time budget.
 *
 *  - Each day has floor(daily_minutes / 25) mission slots (at least one).
 *  - Learning missions fill slots in work order.
 *  - Spaced reviews come from FSRS: concepts already proven are due on their
 *    card's due day; concepts the plan expects to prove get their reviews
 *    projected from that day. A review takes a slot when enough are due or
 *    one is going stale; spare minutes (≥ 10) take a quick review.
 *  - The last buffer days before the exam have no new learning: a rehearsal
 *    across everything fixed so far, plus any due reviews.
 *  - Whatever doesn't fit before the buffer is listed as unscheduled (lowest
 *    marks-per-hour last, so those are what's dropped).
 *
 * Pure and deterministic. Call it again after any change (a mission done or
 * skipped, a gate passed early, a lapse) and the plan re-flows.
 */
import type { ErrorRecord } from "../error-record/schema";
import type { ConceptGraph } from "../graph/graph";
import type { RootCauseAnalysis } from "../root-cause/types";
import { addDays, dayRange, daysBetween, instantToDay, type IsoDay } from "./dates";
import { isMastered, Rating, reviewCard } from "./mastery";
import { DEFAULT_MISSION_PARAMS, type MissionParams } from "./params";
import type {
  ComebackPlan,
  MissionRecord,
  MissionStep,
  PlanDay,
  PlannedMission,
  PlanSettings,
  ProgressState,
  SerializedCard,
  WorkItem,
} from "./types";
import { deriveWork } from "./work";

export interface PlanInput {
  student_id: string;
  graph: ConceptGraph;
  analysis: RootCauseAnalysis;
  records: readonly ErrorRecord[];
  settings: PlanSettings;
  today: IsoDay;
  progress: ProgressState;
  params?: Partial<MissionParams>;
}

export function missionSteps(kind: PlannedMission["kind"], params: MissionParams, minutes = params.missionMinutes): MissionStep[] {
  if (kind === "review" || kind === "rehearsal") return [{ kind: "prove_it", minutes, content: "ready" }];
  return [
    { kind: "recap", minutes: params.stepMinutes.recap, content: "placeholder" },
    { kind: "explainer", minutes: params.stepMinutes.explainer, content: "placeholder" },
    { kind: "prove_it", minutes: params.stepMinutes.prove_it, content: "ready" },
  ];
}

export function bufferDaysFor(daysLeft: number, params: MissionParams): number {
  if (daysLeft >= params.bufferDays.longPlanDays) return params.bufferDays.long;
  if (daysLeft >= params.bufferDays.shortPlanDays) return params.bufferDays.short;
  return 0;
}

interface PendingReview {
  concept_id: string;
  due: IsoDay;
  card?: SerializedCard;
}

export function buildPlan(input: PlanInput): ComebackPlan {
  const params: MissionParams = { ...DEFAULT_MISSION_PARAMS, ...input.params };
  const { settings, today, progress, graph } = input;
  const examDate = settings.exam_date;
  const slotsPerDay = Math.max(1, Math.floor(settings.daily_minutes / params.missionMinutes));
  const work = deriveWork({ graph, analysis: input.analysis, records: input.records, progress, params });
  const warnings: string[] = [];
  if (settings.daily_minutes < params.missionMinutes)
    warnings.push(`Missions take ${params.missionMinutes} minutes, so the plan uses ${params.missionMinutes} minutes a day even though you set ${settings.daily_minutes}.`);

  const daysLeft = Math.max(0, daysBetween(today, examDate));
  const buffer = bufferDaysFor(daysLeft, params);
  const firstBuffer = addDays(examDate, -buffer);

  // ---- the past, from history
  const days: PlanDay[] = [];
  const byDate = new Map<IsoDay, MissionRecord[]>();
  for (const m of progress.history) byDate.set(m.date, [...(byDate.get(m.date) ?? []), m]);
  const start = settings.start_date < today ? settings.start_date : today;
  for (const date of dayRange(start, today < examDate ? today : examDate)) {
    const ms = (byDate.get(date) ?? []).sort((a, b) => a.slot - b.slot).map((m) => fromRecord(m, params));
    days.push({ date, kind: "past", minutes: ms.reduce((s, m) => s + (m.status === "done" ? m.minutes : 0), 0), missions: ms, ...(ms.every((m) => m.status !== "done") ? { missed: true } : {}) });
  }

  // ---- pending reviews: proven concepts on their FSRS due day
  const pending: PendingReview[] = [];
  for (const [concept_id, p] of Object.entries(progress.concepts)) {
    if (!isMastered(p.state) || !p.due) continue;
    if (p.due < examDate) pending.push({ concept_id, due: p.due, card: p.card });
  }
  const provenSoFar = new Set(Object.entries(progress.concepts).filter(([, p]) => isMastered(p.state)).map(([id]) => id));

  const queue: WorkItem[] = [...work.items];
  const order = [...new Set([...work.targeted, ...[...provenSoFar].sort()])];
  let projectedFinish: IsoDay | undefined;
  let reviewsPlanned = 0;

  // Today's completed missions use up today's slots.
  const doneToday = (byDate.get(today) ?? []).sort((a, b) => a.slot - b.slot);

  for (const date of dayRange(today, examDate)) {
    const isBuffer = date >= firstBuffer;
    const missions: PlannedMission[] = date === today ? doneToday.map((m) => fromRecord(m, params)) : [];
    let used = missions.reduce((s, m) => s + m.minutes, 0);
    const budget = Math.max(settings.daily_minutes, params.missionMinutes);
    const due = () => pending.filter((r) => r.due <= date).sort((a, b) => a.due.localeCompare(b.due) || a.concept_id.localeCompare(b.concept_id));
    let slot = missions.reduce((s, m) => Math.max(s, m.slot + 1), 0);
    const status = date === today ? "today" : "planned";

    const takeReview = (kind: "review" | "rehearsal", maxMinutes: number, maxConcepts: number, extra: string[] = []) => {
      const d = due().slice(0, maxConcepts);
      const concepts = [...d.map((r) => r.concept_id), ...extra.filter((c) => !d.some((r) => r.concept_id === c))].slice(0, maxConcepts);
      if (concepts.length === 0) return false;
      // A review takes about reviewMinutesPerConcept per topic; a rehearsal is a full session.
      const minutes = kind === "rehearsal" ? maxMinutes : Math.min(maxMinutes, Math.max(params.quickReviewMinMinutes, concepts.length * params.reviewMinutesPerConcept));
      for (const r of d) {
        pending.splice(pending.indexOf(r), 1);
        // Project the next review as if this one goes well.
        const card = reviewCard(r.card, date, Rating.Good, params);
        const next = instantToDay(card.due);
        if (next < examDate) pending.push({ concept_id: r.concept_id, due: next, card });
      }
      missions.push({
        key: `${kind}:${date}:${slot}`,
        kind,
        date,
        slot: slot++,
        minutes,
        attempt: 1,
        planned_attempts: 1,
        review_concepts: concepts,
        record_ids: [],
        misconception_ids: [],
        status,
        steps: missionSteps(kind, params, minutes),
        reason:
          kind === "rehearsal"
            ? "Buffer day: no new topics. A mixed check across everything you fixed, exam-style."
            : `Spaced review: ${concepts.length === 1 ? "this topic is" : "these topics are"} due, so ${concepts.length === 1 ? "it holds" : "they hold"} until the exam.`,
      });
      used += minutes;
      reviewsPlanned++;
      return true;
    };

    if (isBuffer) {
      if (used + params.missionMinutes <= budget || missions.length === 0) {
        // Rotate through everything fixed (roots first), a different handful each buffer day.
        const fixed = order.filter((c) => provenSoFar.has(c));
        const k = daysBetween(firstBuffer, date) * params.rehearsalConcepts;
        const rotated = fixed.length > 0 ? [...fixed.slice(k % fixed.length), ...fixed.slice(0, k % fixed.length)] : [];
        takeReview("rehearsal", params.missionMinutes, params.rehearsalConcepts, rotated);
      }
    } else {
      while (used + params.missionMinutes <= budget && missions.length < slotsPerDay) {
        const d = due();
        const stale = d.length > 0 && daysBetween(d[0]!.due, date) >= params.reviewMaxOverdueDays;
        if (d.length > 0 && (d.length >= params.reviewBatchTrigger || stale || queue.length === 0)) {
          takeReview("review", params.missionMinutes, params.reviewMaxConcepts);
          continue;
        }
        const item = queue.shift();
        if (!item) break;
        missions.push(toMission(item, date, slot++, status, params));
        used += params.missionMinutes;
        projectedFinish = date;
        if (item.proves) {
          provenSoFar.add(item.concept_id);
          const card = reviewCard(progress.concepts[item.concept_id]?.card, date, Rating.Good, params);
          const next = instantToDay(card.due);
          if (next < examDate) pending.push({ concept_id: item.concept_id, due: next, card });
        }
      }
    }
    // Spare minutes: a quick review.
    const spare = budget - used;
    if (spare >= params.quickReviewMinMinutes && due().length > 0) {
      const n = Math.max(1, Math.min(params.reviewMaxConcepts, Math.floor(spare / params.reviewMinutesPerConcept)));
      takeReview("review", Math.min(spare, n * params.reviewMinutesPerConcept), n);
    }
    days.push({ date, kind: isBuffer ? "buffer" : "study", minutes: used, missions });
  }
  if (daysLeft >= 0) days.push({ date: examDate, kind: "exam", minutes: 0, missions: [] });

  if (queue.length > 0) {
    const n = queue.length;
    warnings.push(
      `${n} learning ${n === 1 ? "mission doesn't" : "missions don't"} fit before ${settings.exam_name}. ` +
        `More minutes a day would fit ${n === 1 ? "it" : "them"}; otherwise ${n === 1 ? "it is" : "they are"} dropped, lowest marks per hour first.`,
    );
  }
  if (queue.some((q) => q.needs_help) || work.items.some((q) => q.needs_help) || work.parked.length > 0)
    warnings.push("One topic still isn't clicking after several goes. Worth asking a teacher to look at it with you.");
  if (work.parked.length > 0)
    warnings.push(`Taken out of the plan for now, so the rest can go ahead: ${work.parked.map((c) => graph.get(c).name).join(", ")}.`);
  if (work.unchecked.length > 0)
    warnings.push(
      `Studied but not proven yet, because there are no checked questions for ${work.unchecked.length === 1 ? "it" : "them"} so far: ${work.unchecked.map((c) => graph.get(c).name).join(", ")}.`,
    );

  const learningDone = progress.history.filter((m) => m.status === "completed" && (m.kind === "learn" || m.kind === "apply")).length;
  const targeted = [...new Set(work.targeted)];
  return {
    student_id: input.student_id,
    today,
    settings,
    days,
    unscheduled: queue,
    not_covered: work.not_covered,
    totals: {
      learning_done: learningDone,
      learning_remaining: work.items.length - queue.length,
      reviews_planned: reviewsPlanned,
      concepts_proven: targeted.filter((c) => isMastered(progress.concepts[c]?.state)).length,
      concepts_targeted: targeted.length,
      days_left: daysLeft,
      buffer_days: buffer,
      ...(projectedFinish ? { projected_finish: projectedFinish } : {}),
    },
    warnings,
  };
}

function toMission(item: WorkItem, date: IsoDay, slot: number, status: PlannedMission["status"], params: MissionParams): PlannedMission {
  return {
    key: item.key,
    kind: item.kind,
    date,
    slot,
    minutes: params.missionMinutes,
    concept_id: item.concept_id,
    ...(item.root_id ? { root_id: item.root_id } : {}),
    attempt: item.attempt,
    planned_attempts: item.planned_attempts,
    review_concepts: [],
    record_ids: item.record_ids,
    misconception_ids: item.misconception_ids,
    status,
    steps: missionSteps(item.kind, params),
    reason: item.reason,
    ...(item.proves ? { proves: true } : {}),
    ...(item.needs_help ? { needs_help: true } : {}),
  };
}

function fromRecord(m: MissionRecord, params: MissionParams): PlannedMission {
  return {
    key: m.key,
    kind: m.kind,
    date: m.date,
    slot: m.slot,
    minutes: m.minutes ?? params.missionMinutes,
    ...(m.concept_id ? { concept_id: m.concept_id } : {}),
    ...(m.root_id ? { root_id: m.root_id } : {}),
    attempt: Number(m.key.split(":").pop()) || 1,
    planned_attempts: 1,
    review_concepts: m.review_concepts ?? [],
    record_ids: [],
    misconception_ids: [],
    status: m.status === "completed" ? "done" : "skipped",
    ...(m.passed !== undefined ? { passed: m.passed } : {}),
    steps: missionSteps(m.kind, params, m.minutes ?? params.missionMinutes),
    reason: m.status === "completed" ? "Done." : "Skipped: the plan moved it to a later day.",
  };
}

/** The missions planned for one day (today's mission list). */
export function missionsOn(plan: ComebackPlan, day: IsoDay): PlannedMission[] {
  return plan.days.find((d) => d.date === day)?.missions ?? [];
}

/** The next mission still to do, today or later. */
export function nextMission(plan: ComebackPlan): PlannedMission | undefined {
  for (const d of plan.days) {
    if (d.date < plan.today) continue;
    const m = d.missions.find((x) => x.status === "today" || x.status === "planned");
    if (m) return m;
  }
  return undefined;
}
