import type { ErrorType } from "../error-record/schema";
import type { HabitPattern, RootCauseAnalysis, RootFinding, StandaloneError } from "./types";

/**
 * Plain-language wording, written for a 16-year-old. Deterministic templates
 * built only from the engine's facts; the LLM layer may later re-word these
 * (see wording.ts) but never changes the facts.
 */

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function marksPhrase(value: number, estimated: boolean): string {
  const rounded = Math.round(value);
  return `${estimated ? "about " : ""}${rounded} mark${rounded === 1 ? "" : "s"}`;
}

export function rootExplanationTemplate(root: Omit<RootFinding, "explanation" | "explanation_source">): string {
  const name = root.concept.name;
  const n = root.explains.length;
  const topicOf = (e: (typeof root.explains)[number]): string => (e.tested ?? e.anchor).name;
  const topics = [...new Set(root.explains.map(topicOf))].filter((t) => t !== name);
  // Only claim "builds on" where the graph says so; other links come from the report naming the concept.
  const viaGraph = [...new Set(root.explains.filter((e) => e.tested_path && e.tested_path.length > 1).map(topicOf))];
  const viaReport = topics.filter((t) => !viaGraph.includes(t));
  const short = (xs: string[]): string => `${list(xs.slice(0, 4))}${xs.length > 4 ? " and more" : ""}`;
  const parts: string[] = [];

  if (topics.length === 0) {
    parts.push(`You lost marks on ${name} itself ${n} times.`);
  } else {
    const direct = root.explains.some((e) => (e.tested ?? e.anchor).id === root.concept.id);
    parts.push(`${n} of your mistakes${direct ? `, in ${name} itself and in ${short(topics)},` : ` in ${short(topics)}`} trace back to ${name}.`);
    if (viaGraph.length > 0 && viaReport.length === 0) {
      parts.push(`${viaGraph.length === 1 ? "That topic is" : "Those topics are all"} built on ${name}, so one gap there shows up in all of them.`);
    } else if (viaGraph.length > 0) {
      parts.push(`${short(viaGraph)} ${viaGraph.length === 1 ? "is" : "are"} built on ${name}, so one gap there shows up there too.`);
    }
    if (viaReport.length > 0) {
      parts.push(`In your ${short(viaReport)} question${viaReport.length === 1 ? "" : "s"}, the report itself points to ${name} as the step that went wrong.`);
    }
  }
  const mc = root.misconceptions.filter((m) => m.count >= 2);
  if (mc.length > 0) parts.push(`The same wrong idea keeps coming back: ${mc[0]!.description.replace(/\.$/, "")} (${mc[0]!.count} times).`);
  if (root.exam_ids.length >= 2) parts.push(`It happened in ${root.exam_ids.length} different exams, so it is not a one-off.`);
  if (root.concept.class <= 10) parts.push(`It is a Class ${root.concept.class} topic, so going back to basics here will unlock the harder chapters.`);
  if (root.evidence_against.length > 0) {
    parts.push(`You did handle related work correctly elsewhere, so treat this as a likely cause rather than a certain one.`);
  }
  parts.push(`Fixing it is worth ${marksPhrase(root.marks.lost, root.marks.estimated_part > 0)} you already lost.`);
  return parts.join(" ");
}

export function standaloneExplanation(s: Omit<StandaloneError, "explanation">): string {
  if (s.reason === "unmapped") {
    return "This question's topic isn't in our concept map yet, so treat it as its own fix.";
  }
  return `A one-off mistake in ${s.concept?.name ?? "this topic"}: nothing else you got wrong points the same way, so fix it on its own.`;
}

export const HABIT_TEXT: Record<ErrorType | "repeated_slip", { label: string; tip: string }> = {
  repeated_slip: { label: "The same slip more than once", tip: "Add this to your final-answer checklist; it has cost you marks more than once." },
  careless: { label: "Misreading and copying slips", tip: "Underline what the question asks, and check your final line answers exactly that." },
  calculation: { label: "Arithmetic and algebra slips", tip: "Re-check each line of arithmetic, and substitute your answer back where you can." },
  notation: { label: "Notation, units and conventions", tip: "Before moving on, check: +C, units, signs, naming rules, arrow directions." },
  incomplete: { label: "Answers left unfinished", tip: "Always write the final step and a one-line conclusion; keep an eye on time per section." },
  unattempted: { label: "Questions not attempted", tip: "Attempt every question; method marks are available even for a partial answer." },
  conceptual: { label: "Concept errors", tip: "" },
  procedural: { label: "Method errors", tip: "" },
  unclassified: { label: "Other errors", tip: "" },
};

export function headline(a: Pick<RootCauseAnalysis, "roots" | "summary" | "habits">): string {
  const { summary, roots, habits } = a;
  const total = summary.total_errors;
  if (total === 0) return "No errors recorded yet.";
  if (roots.length > 0) {
    return (
      `Fix ${roots.length === 1 ? "this 1 thing" : `these ${roots.length} things`} → explains ` +
      `${summary.explained_by_roots} of your ${total} errors → ${marksPhrase(summary.marks_explained_by_roots, true)} at stake.`
    );
  }
  const habitMarks = habits.reduce((s, h) => s + h.marks_lost, 0);
  if (summary.habit_errors > 0 && summary.habit_errors >= total / 2) {
    return (
      `No single knowledge gap behind your mistakes: ${summary.habit_errors} of your ${total} errors were slips and habits → ` +
      `${marksPhrase(habitMarks, true)} to win back by checking your work.`
    );
  }
  return `No shared root found: your ${total} errors are separate, one-off fixes.`;
}

export function habitSummary(h: HabitPattern): string {
  return `${h.label}: ${h.records.length} time${h.records.length === 1 ? "" : "s"}, ${marksPhrase(h.marks_lost, h.estimated_part > 0)} lost.`;
}

export { fmt as formatNumber };
