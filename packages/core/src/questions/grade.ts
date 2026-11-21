import type { AnswerResult } from "../missions/mastery";
import type { ProveItQuestion } from "./schema";

/** Parse a typed number: "12", "-3.5", "3/4", "-1 1/2" is not supported, "1e-3", "0,5". */
export function parseNumber(raw: string): number | undefined {
  const s = raw.trim().replace(/\s+/g, "").replace(/,/g, ".").replace(/^\+/, "");
  if (!s) return undefined;
  const frac = /^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(s);
  if (frac) {
    const d = Number(frac[2]);
    return d === 0 ? undefined : Number(frac[1]) / d;
  }
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?$/i.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export interface GradedAnswer extends AnswerResult {
  /** Feedback to show: the chosen option's (kind, misconception-specific) or the right answer's. */
  feedback: string;
  correct_option_id?: string;
  correct_display?: string;
  /** The wrong answer matched an anticipated misconception. */
  matched: boolean;
}

export function gradeAnswer(q: ProveItQuestion, answer: string): GradedAnswer {
  if (q.kind === "mcq") {
    const opts = q.options ?? [];
    const right = opts.find((o) => o.correct)!;
    const chosen = opts.find((o) => o.id === answer);
    const correct = chosen?.correct === true;
    return {
      question_id: q.id,
      target_misconception_id: q.target_misconception_id,
      correct,
      ...(!correct && chosen?.misconception_id ? { revealed_misconception_id: chosen.misconception_id } : {}),
      feedback: chosen?.feedback ?? "Pick one of the options.",
      correct_option_id: right.id,
      matched: !correct && !!chosen?.misconception_id,
    };
  }
  const a = q.answer!;
  const value = parseNumber(answer);
  const correct = value !== undefined && Math.abs(value - a.value) <= a.tolerance + 1e-9;
  const wrong = !correct && value !== undefined ? q.numeric_wrong?.find((w) => Math.abs(w.value - value) <= a.tolerance + 1e-9) : undefined;
  return {
    question_id: q.id,
    target_misconception_id: q.target_misconception_id,
    correct,
    ...(wrong ? { revealed_misconception_id: wrong.misconception_id } : {}),
    feedback: correct
      ? a.feedback
      : wrong
        ? wrong.feedback
        : value === undefined
          ? "That isn't a number we can read. Try a form like 12, -3.5 or 3/4."
          : `Not quite: the answer is ${a.display}. Have a look at the worked solution.`,
    correct_display: a.display,
    matched: !!wrong,
  };
}
