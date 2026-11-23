/**
 * Prompts and LLM output schemas for Mistake Recaps and step explainers.
 * Only anonymised content goes in: the report's wording of one mistake
 * (question, diagnosis, correct approach, quoted working) and graph text.
 * No student ids, names, exam names or dates.
 */
import { z } from "zod";
import type { ConceptGraph, ErrorRecord } from "@progresso/core";

export const RECAP_PROMPT_VERSION = "recap-1";
export const EXPLAINER_PROMPT_VERSION = "explainer-1";

const CheckGen = z.object({
  mode: z.enum(["equal", "antiderivative", "numeric", "none"]),
  compute: z.string().nullable(),
  symbols: z.array(z.string()),
});

export const RecapGenSchema = z.object({
  wrong_lines: z
    .array(
      z.object({
        text: z.string().min(1),
        wrong: z.boolean(),
        mark: z.string().nullable(),
        sympy: z.string().nullable(),
      }),
    )
    .min(1)
    .max(8),
  wrong_note: z.string().min(1),
  fix_lines: z
    .array(
      z.object({
        text: z.string().min(1),
        note: z.string().nullable(),
        sympy: z.string().nullable(),
      }),
    )
    .min(1)
    .max(8),
  key_idea: z.string().min(1),
  check: CheckGen,
});
export type RecapGen = z.infer<typeof RecapGenSchema>;

const MACHINE_CHECKS = `Machine checks (maths only; chemistry: check.mode "none", every sympy null):
- check.compute: a SymPy expression that works out the FINAL answer of the question from scratch, e.g. "diff(sin(x**2), x)", "integrate(x*exp(x**2), x)", "-diff(F, x)/diff(F, y)" written out with F replaced by the expression (implicit differentiation: x and y as plain symbols), "diff(a*sin(t)**3, t)/diff(a*cos(t)**3, t)" (parametric), "pi*r**2" style formulas with numbers substituted for rates. Use ** for powers; declare every variable in check.symbols. No method calls (no .subs, .doit): to evaluate at a point, write the derivative out yourself or use limit(expr, x, 3). Only SymPy functions: diff, integrate, limit, simplify, expand, factor, sin, cos, tan, sec, csc, cot, asin, acos, atan, exp, log, sqrt, Rational, pi, E, Matrix, det.
- check.mode: "equal" (expressions), "antiderivative" (indefinite integral, equal up to a constant: no + C in sympy), "numeric" (a number).
- sympy on a line: the value that line shows FOR THE FINAL QUANTITY the question asks for, in the same symbols; null when the line shows something else (a rule, a setup, an intermediate derivative of a different quantity, an equation). Use theta as t if the question uses theta, and say so by putting "t" in check.symbols.`;

export const RECAP_SYSTEM = `You write a "Mistake Recap" for a CBSE Class 11-12 student: a short replay of one exam mistake, then the fix. It must take under a minute to watch.
The exam report's diagnosis is the source of truth. Never re-diagnose: the marked step must be exactly the error the report describes, and the fix must agree with the report's correct approach when one is given.
Lines:
- wrong_lines: the steps that went wrong, one per line, in order. Set wrong=true on the line(s) where the error the report describes happens (usually one).
- wrong_note: 1-2 plain sentences, kind and specific, saying what went wrong at the marked step, in the report's sense ("The 2x from the inside, x², is missing"). Add no new claims about the student.
- fix_lines: the correct working, 2-6 short lines, each line one step a student would write. Start from the same place as the wrong working so the student sees exactly where the paths split. The last line gives the final answer. A line may carry a short note (under 60 characters, e.g. "inner function: x²").
- key_idea: one or two sentences: the idea that prevents this mistake next time.
Style: warm, plain English for a teenager, no blame, no "wrong!". Use LaTeX inside $...$ for all maths and chemical formulae in text, note and key_idea fields (e.g. $\\frac{dy}{dx} = 2x\\cos(x^2)$). In fix_lines put each maths line as a single $...$ expression; chemistry lines may be a short sentence with $...$ formulae.
${MACHINE_CHECKS}`;

function recordFacts(graph: ConceptGraph, r: ErrorRecord): string[] {
  const primary = r.concepts.find((c) => c.role === "primary");
  const concept = primary && graph.has(primary.concept_id) ? graph.get(primary.concept_id) : undefined;
  const mis = r.misconception ? graph.misconceptions.get(r.misconception.misconception_id) : undefined;
  return [
    `Subject: ${r.exam.subject}.${concept ? ` Topic: ${concept.name} (Class ${concept.class}, ${concept.chapter}).` : ""}`,
    ...(r.question.text ? [`Question: ${r.question.text}`] : ["The report does not quote the question."]),
    `Report's diagnosis (verbatim): ${r.diagnosis.text}`,
    ...(r.diagnosis.correct_approach ? [`Report's correct approach (verbatim): ${r.diagnosis.correct_approach}`] : ["The report gives no correct approach: work it out carefully yourself."]),
    `Error type: ${r.error_type}.`,
    ...(mis ? [`Named misconception: ${mis.description}`] : []),
  ];
}

export function recapPrompt(graph: ConceptGraph, r: ErrorRecord): string {
  const lines = recordFacts(graph, r);
  if (r.student_working) {
    lines.push(
      "",
      `The report QUOTES the student's working (format ${r.student_working.format}):`,
      `"""${r.student_working.text}"""`,
      "",
      "wrong_lines MUST be this quote cut into consecutive pieces, copied character for character: do not fix, add, drop, retype or reformat anything (keep ^, sqrt, theta etc. exactly as quoted). Joined together the pieces must give back the quote exactly. Cut before '=', ', so' or similar so each piece is one step.",
      "On each line with wrong=true, set mark to the exact substring of that line (copied character for character) that is wrong, as short as possible: the part a teacher would circle in red. mark is null on other lines.",
      "sympy on a wrong line: the value that line shows for the final quantity if it is one, else null.",
    );
  } else {
    lines.push(
      "",
      "The report does NOT quote the student's working. Write the TYPICAL wrong step for this exact mistake (what a student making the mistake the report describes would write), in LaTeX inside $...$, 1-3 lines. It will be labelled to the student as \"the kind of step that goes wrong here\", never as their own working.",
      "If the report says what answer the student gave, the typical step should arrive at that answer. mark must be null on every line.",
      "sympy on the wrong line: the wrong value it shows for the final quantity, if it is one, else null.",
    );
  }
  return lines.join("\n");
}

export const ExplainerGenSchema = z.object({
  title: z.string().min(1),
  steps: z
    .array(
      z.object({
        kind: z.enum(["wrong", "why", "idea", "example", "check", "rule"]),
        say: z.string().min(1),
        math: z.string().nullable(),
        sympy: z.string().nullable(),
        expect: z.enum(["answer", "not_answer"]).nullable(),
      }),
    )
    .min(4)
    .max(9),
  takeaway: z.string().min(1),
  check: CheckGen,
});
export type ExplainerGen = z.infer<typeof ExplainerGenSchema>;

export const EXPLAINER_SYSTEM = `You write a short animated step explainer for CBSE Class 11-12 students (NCERT syllabus). It plays in the browser one step at a time: each step shows one formula on the board (math, LaTeX WITHOUT $) and a line of narration (say, 1-3 sentences, may use $...$ for inline maths).
Goal: build real intuition for the correct idea, STARTING FROM the typical wrong step that the named misconception produces, so the student sees why the wrong step feels right and exactly why it fails.
Structure (5-8 steps):
1. kind "wrong": one concrete, small example worked the wrong way, exactly as a student holding the misconception would do it. Narration: "This looks reasonable: ..." Never mock.
2. kind "why": show concretely why it fails (a quick numeric check, units, a picture in words, or a case where it obviously breaks).
3. kind "idea" (1-2 steps): the intuition: what is really going on.
4. kind "rule": the correct rule, stated cleanly.
5. kind "example": the same example done right (1-2 steps), ending at the correct answer.
6. kind "check" (optional, last): a 10-second habit the student can use to catch this slip in an exam.
title: under 60 characters, plain ("Why the inside needs its own derivative").
takeaway: one sentence to remember.
Everything must be correct beyond doubt; keep each formula short enough to fit a phone screen (under 50 characters of output where possible).
${MACHINE_CHECKS}
In explainers, sympy + expect go on steps whose math shows a value of the example's final quantity: expect "not_answer" on the wrong step, "answer" on the example step that gives the correct result; null elsewhere. check.compute computes the example's correct answer.`;

export function explainerPrompt(graph: ConceptGraph, misconceptionId: string): string {
  const m = graph.misconceptions.get(misconceptionId)!;
  const c = graph.get(m.concept_id);
  const others = c.misconceptions.filter((x) => x.id !== m.id).map((x) => `- ${x.description}`);
  return [
    `Subject: ${c.subject}. Concept: ${c.name} (Class ${c.class}, chapter "${c.chapter}").`,
    `Misconception to undo: ${m.description}`,
    ...(c.prerequisites.length > 0 ? [`It builds on: ${c.prerequisites.filter((p) => graph.has(p)).map((p) => graph.get(p).name).join(", ")}.`] : []),
    ...(others.length > 0 ? ["Other misconceptions on this concept (do not mix them in):", ...others] : []),
  ].join("\n");
}

export const RecapReviewSchema = z.object({
  error_line: z.number().int().nullable(),
  marked_part_is_the_error: z.boolean(),
  note_matches_report: z.boolean(),
  fix_correct: z.boolean(),
  fix_agrees_with_report: z.boolean(),
  typical_step_matches_report: z.boolean(),
  issues: z.string(),
});
export type RecapReview = z.infer<typeof RecapReviewSchema>;

export const REVIEW_RECAP_SYSTEM = `You are an expert CBSE Class 11-12 examiner checking teaching content before a student sees it. Be strict: if anything is mathematically or chemically wrong, or does not match the exam report, say so.
You get an exam report's diagnosis of one mistake, the wrong working (numbered lines), and a corrected working. Answer:
- error_line: the number of the line where the error THE REPORT DESCRIBES first happens (decide this yourself from the report).
- marked_part_is_the_error: the part shown in [[double brackets]] (if any) is exactly what the report says is wrong. true if there are no brackets.
- note_matches_report: the explanation note describes the same error as the report and claims nothing the report doesn't support.
- fix_correct: every corrected line is right and the final answer is right (work it out yourself).
- fix_agrees_with_report: the corrected working agrees with the report's correct approach (true if the report gives none).
- typical_step_matches_report: for a "typical wrong step" (not the student's own), it shows the mistake the report describes; true when the working is the student's own.
- issues: every problem you found, else "none".`;

export function recapReviewPrompt(graph: ConceptGraph, r: ErrorRecord, gen: RecapGen): string {
  const own = !!r.student_working;
  return [
    ...recordFacts(graph, r),
    "",
    own ? "The student's own working, as quoted by the report, cut into lines:" : "A TYPICAL wrong step written for this mistake (not the student's own working):",
    ...gen.wrong_lines.map((l, i) => {
      const t = l.mark && l.text.includes(l.mark) ? l.text.replace(l.mark, `[[${l.mark}]]`) : l.text;
      return `${i + 1}. ${t}`;
    }),
    `Explanation note shown at the error: ${gen.wrong_note}`,
    "",
    "Corrected working:",
    ...gen.fix_lines.map((l, i) => `${i + 1}. ${l.text}${l.note ? `   (${l.note})` : ""}`),
    `Key idea: ${gen.key_idea}`,
  ].join("\n");
}

export const ExplainerReviewSchema = z.object({
  wrong_step_shows_misconception: z.boolean(),
  all_steps_correct: z.boolean(),
  builds_from_wrong_to_right: z.boolean(),
  issues: z.string(),
});
export type ExplainerReview = z.infer<typeof ExplainerReviewSchema>;

export const REVIEW_EXPLAINER_SYSTEM = `You are an expert CBSE Class 11-12 teacher checking a short step-by-step explainer before students see it. Be strict.
Answer:
- wrong_step_shows_misconception: the first step really shows the named misconception (and is clearly presented as the wrong way).
- all_steps_correct: every formula and statement other than the deliberate wrong step is correct (check each yourself), and the worked example reaches the right answer.
- builds_from_wrong_to_right: it starts at the wrong step and builds, step by step, to the correct idea in a way a 16-year-old can follow.
- issues: every problem you found, else "none".`;

export function explainerReviewPrompt(graph: ConceptGraph, misconceptionId: string, gen: ExplainerGen): string {
  const m = graph.misconceptions.get(misconceptionId)!;
  const c = graph.get(m.concept_id);
  return [
    `Concept: ${c.name} (${c.subject}, Class ${c.class}). Misconception: ${m.description}`,
    `Title: ${gen.title}`,
    ...gen.steps.map((s, i) => `${i + 1}. [${s.kind}] ${s.math ? `Board: ${s.math} | ` : ""}Says: ${s.say}`),
    `Takeaway: ${gen.takeaway}`,
  ].join("\n");
}
