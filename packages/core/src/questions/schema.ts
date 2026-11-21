/**
 * "Prove it" questions. Generated offline per misconception, verified
 * independently (a separate LLM solving pass, plus a CAS for maths), and
 * cached in the question bank (data/question-bank/) so they are reused across
 * students and never generated at runtime.
 *
 * The point of the format: every wrong option (and every anticipated wrong
 * numeric answer) carries the misconception it stands for, so a wrong pick
 * tells us exactly which misconception is still alive.
 */
import { z } from "zod";

const Id = z.string().regex(/^[a-z0-9][a-z0-9_.:-]*$/);

export const QuestionOptionSchema = z
  .object({
    id: z.string().regex(/^[a-f]$/),
    /** Markdown with $…$ LaTeX. */
    text: z.string().min(1),
    correct: z.boolean(),
    /** For wrong options: the misconception this answer comes from. */
    misconception_id: Id.optional(),
    /** For wrong options: how a student holding the misconception arrives at it (for the audit trail). */
    how_it_arises: z.string().optional(),
    /** Shown when picked: kind, specific. For the right option, a short "why it works". */
    feedback: z.string().min(1),
  })
  .strict();
export type QuestionOption = z.infer<typeof QuestionOptionSchema>;

export const NumericWrongSchema = z
  .object({
    value: z.number(),
    misconception_id: Id,
    how_it_arises: z.string().optional(),
    feedback: z.string().min(1),
  })
  .strict();

export const VerificationCheckSchema = z
  .object({
    method: z.enum(["cas_sympy", "llm_solve"]),
    passed: z.boolean(),
    model: z.string().optional(),
    detail: z.string(),
  })
  .strict();

export const ProveItQuestionSchema = z
  .object({
    schema_version: z.literal("1.0"),
    id: Id,
    subject: z.string().min(1),
    /** The concept the question tests. */
    concept_id: Id,
    /** The misconception it is built to catch. */
    target_misconception_id: Id,
    kind: z.enum(["mcq", "numeric"]),
    /** Markdown with $…$ LaTeX. */
    stem: z.string().min(1),
    options: z.array(QuestionOptionSchema).optional(),
    answer: z
      .object({
        value: z.number(),
        /** Absolute tolerance. */
        tolerance: z.number().min(0),
        /** How to show it ("12", "$\\frac{3}{4}$"). */
        display: z.string().min(1),
        unit: z.string().optional(),
        /** Shown after a right answer. */
        feedback: z.string().min(1),
      })
      .strict()
      .optional(),
    /** Anticipated wrong numeric answers and the misconception each reveals. */
    numeric_wrong: z.array(NumericWrongSchema).optional(),
    /** Worked solution shown after answering. */
    solution: z.string().min(1),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    verification: z
      .object({
        status: z.literal("verified"),
        checks: z.array(VerificationCheckSchema).min(1),
        verified_at: z.string(),
      })
      .strict(),
    provenance: z
      .object({
        generator: z.object({ provider: z.string(), model: z.string() }).strict(),
        generated_at: z.string(),
        prompt_version: z.string(),
        /** Misconceptions the distractors were built from, and how many report mistakes (anonymised) informed them. */
        distractors_from: z.object({ misconceptions: z.array(Id), report_mistakes: z.number().int().min(0) }).strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.kind === "mcq") {
      const opts = q.options ?? [];
      if (opts.length < 3) ctx.addIssue({ code: "custom", message: "an MCQ needs at least 3 options" });
      if (opts.filter((o) => o.correct).length !== 1) ctx.addIssue({ code: "custom", message: "an MCQ needs exactly one correct option" });
      for (const o of opts) if (!o.correct && !o.misconception_id) ctx.addIssue({ code: "custom", message: `wrong option ${o.id} has no misconception` });
      if (new Set(opts.map((o) => o.id)).size !== opts.length) ctx.addIssue({ code: "custom", message: "duplicate option ids" });
    } else if (!q.answer) ctx.addIssue({ code: "custom", message: "a numeric question needs an answer" });
  });
export type ProveItQuestion = z.infer<typeof ProveItQuestionSchema>;

export const BankFileSchema = z
  .object({
    misconception_id: Id,
    concept_id: Id,
    subject: z.string(),
    questions: z.array(ProveItQuestionSchema),
  })
  .strict();
export type BankFile = z.infer<typeof BankFileSchema>;

/** What the student's browser receives: no answer key, no audit fields. */
export interface QuestionForStudent {
  id: string;
  kind: "mcq" | "numeric";
  stem: string;
  options?: { id: string; text: string }[];
  unit?: string;
}

export function forStudent(q: ProveItQuestion): QuestionForStudent {
  return {
    id: q.id,
    kind: q.kind,
    stem: q.stem,
    ...(q.options ? { options: q.options.map((o) => ({ id: o.id, text: o.text })) } : {}),
    ...(q.answer?.unit ? { unit: q.answer.unit } : {}),
  };
}
