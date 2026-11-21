/**
 * Prompts and LLM output schemas for prove-it question generation and the
 * independent solving pass. Only anonymised content goes in: concept and
 * misconception text from the graph, and the reports' wording of mistakes
 * (no student ids or names).
 */
import { z } from "zod";
import type { ConceptGraph } from "@progresso/core";

export const PROMPT_VERSION = "prove-it-1";

const GenWrong = z.object({
  text: z.string().min(1),
  sympy: z.string().nullable(),
  value: z.number().nullable(),
  misconception_id: z.string().min(1),
  how_it_arises: z.string().min(1),
  feedback: z.string().min(1),
});

export const GenQuestionSchema = z.object({
  kind: z.enum(["mcq", "numeric"]),
  stem: z.string().min(1),
  check: z.object({
    mode: z.enum(["equal", "antiderivative", "numeric", "set", "none"]),
    compute: z.string().nullable(),
    symbols: z.array(z.string()),
  }),
  correct: z.object({
    text: z.string().min(1),
    sympy: z.string().nullable(),
    value: z.number().nullable(),
    feedback: z.string().min(1),
  }),
  wrong: z.array(GenWrong).min(2).max(4),
  unit: z.string().nullable(),
  solution: z.string().min(1),
  difficulty: z.number().int().min(1).max(3),
});
export type GenQuestion = z.infer<typeof GenQuestionSchema>;

export const GenOutputSchema = z.object({ questions: z.array(GenQuestionSchema).min(1) });

export const SolveSchema = z.object({
  working: z.string(),
  final_answer: z.string(),
  chosen_option: z.string().nullable(),
  numeric_value: z.number().nullable(),
  exactly_one_option_correct: z.boolean(),
  issues: z.string(),
});
export type Solve = z.infer<typeof SolveSchema>;

export const GEN_SYSTEM = `You write short "prove it" check questions for CBSE Class 11-12 students (NCERT syllabus, Indian board-exam style).
A prove-it question checks whether ONE specific misconception is gone. Its wrong answers are exactly what a student who still holds a listed misconception would get, so a wrong pick tells the teacher which misconception is alive.
Rules:
- Every question must be correct beyond doubt and answerable in under 2 minutes. Exactly one option is correct.
- Each wrong answer must be produced by faithfully applying ONE listed misconception (compute it, do not guess), and must be tagged with that misconception's id. At least one wrong answer per question uses the TARGET misconception. Never use a distractor that is also correct.
- Write fresh questions in the style of the reported mistakes; do not copy a reported question.
- Feedback for a wrong answer: 1-3 warm, specific sentences for a teenager. Name the exact slip ("You multiplied by the outer derivative but not the inner one"), then the fix. Never blame, never "wrong!".
- Feedback for the correct answer: one sentence on why it works.
- Use LaTeX inside $...$ for all maths and chemical formulae (e.g. $\\frac{dy}{dx}$, $\\mathrm{CH_3O^-}$). Keep stems short.
- Solution: a short worked solution (3-6 lines).
Machine checks (maths):
- check.compute: a SymPy expression that works out the answer from scratch, e.g. "diff(sin(x**2), x)", "integrate(cos(x)**2, x)", "limit((x**3-8)/(x-2), x, 2)". Use ** for powers, declare every variable in check.symbols. Only SymPy functions (diff, integrate, limit, simplify, expand, factor, sin, cos, tan, sec, csc, cot, asin, acos, atan, exp, log, sqrt, Rational, pi, E, Matrix, det).
- correct.sympy and each wrong.sympy: the option as a SymPy expression in the same symbols.
- check.mode: "equal" (expressions equal), "antiderivative" (indefinite integral, equal up to a constant: omit + C in sympy), "numeric" (a number), "set" (a list of solutions, e.g. "[1, 2]").
- Numeric questions: kind "numeric", correct.value is the number, each wrong.value the number the misconception gives; check.mode "numeric"; the text fields show the numbers.
Chemistry or anything not machine-checkable: check.mode "none", compute and sympy null.`;

export interface MistakePattern {
  question?: string;
  report_says: string;
  student_wrote?: string;
  correct_approach?: string;
}

export function genPrompt(input: {
  graph: ConceptGraph;
  concept_id: string;
  misconception_id: string;
  count: number;
  numeric: number;
  patterns: MistakePattern[];
}): string {
  const { graph } = input;
  const c = graph.get(input.concept_id);
  const target = graph.misconceptions.get(input.misconception_id)!;
  const targetConcept = graph.get(target.concept_id);
  // Allowed misconceptions: the concept's own, the target's concept's, and those of direct prerequisites.
  const allowed = new Map<string, string>();
  for (const id of [c.id, target.concept_id, ...c.prerequisites, ...targetConcept.prerequisites])
    for (const m of graph.get(id).misconceptions) allowed.set(m.id, `${m.description} (${graph.get(id).name})`);
  const lines = [
    `Subject: ${c.subject}. Concept the questions test: "${c.name}" (Class ${c.class}, chapter "${c.chapter}").`,
    `TARGET misconception ${target.id}: ${target.description}${target.concept_id !== c.id ? ` (from the prerequisite "${targetConcept.name}"; the questions are on "${c.name}" but must catch this slip)` : ""}.`,
    "",
    "Misconceptions you may use for wrong answers (id: description):",
    ...[...allowed.entries()].map(([id, d]) => `- ${id}: ${d}`),
  ];
  if (input.patterns.length > 0) {
    lines.push("", "How students actually made this mistake (anonymised, from exam reports). Build distractors that reproduce these exact slips:");
    for (const p of input.patterns.slice(0, 6)) {
      lines.push(
        `- ${p.question ? `Question: ${p.question} | ` : ""}Report: ${p.report_says}${p.student_wrote ? ` | Student wrote: ${p.student_wrote}` : ""}${p.correct_approach ? ` | Correct: ${p.correct_approach}` : ""}`,
      );
    }
  }
  lines.push(
    "",
    `Write ${input.count} questions: ${input.count - input.numeric} multiple choice (1 correct + 3 wrong options)${input.numeric > 0 ? ` and ${input.numeric} numeric (the student types a number; give 2-3 anticipated wrong values)` : ""}.`,
    "Vary them: different functions/compounds, one easy, the rest board-exam level.",
  );
  return lines.join("\n");
}

export const SOLVE_SYSTEM = `You are an expert CBSE Class 11-12 examiner checking a question before students see it. Solve it yourself, carefully and independently, step by step. Then report your final answer.
For multiple choice: give the letter of the option you find correct in chosen_option, and set exactly_one_option_correct to false if no option or more than one option is correct.
For a numeric question: give the number in numeric_value (chosen_option null).
List any problem with the question (ambiguity, error, unclear wording) in issues, else "none".`;

export function solvePrompt(stem: string, options?: { letter: string; text: string }[], unit?: string | null): string {
  return [
    `Question: ${stem}`,
    ...(options ? ["Options:", ...options.map((o) => `${o.letter}) ${o.text}`)] : [`Answer with a number${unit ? ` (in ${unit})` : ""}.`]),
  ].join("\n");
}

/** The second opinion, when it has to come from the same model: a different method, so it isn't the same reasoning twice. */
export const SOLVE_SYSTEM_ALT = `You are a second, independent examiner. Do NOT solve forwards first. Instead test every option on its own merits (substitute it back, differentiate it, check it against the definition or the chemistry), and decide for each whether it is right. Only then report.
For multiple choice: give the letter of the one option that is right in chosen_option; set exactly_one_option_correct to false if none or several are right.
For a numeric question: work it out by a different method from the obvious one (e.g. check by substitution or estimate) and give numeric_value.
List any problem with the question in issues, else "none".`;
