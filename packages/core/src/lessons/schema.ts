/**
 * Mission content made from the report: Mistake Recaps (one per error record)
 * and step explainers (one per misconception). Both are generated offline,
 * verified (SymPy for maths, plus an independent LLM review on a different
 * model) and cached as files; nothing is generated at runtime.
 *
 * Honesty rules the format enforces:
 * - A recap in `student_working` mode shows ONLY the report's quoted working,
 *   cut into lines: the lines must join back into the quote exactly
 *   (`checkRecapStructure`). Nothing is added to what the student wrote.
 * - Without a quote the recap is `typical_step`: a typical wrong step for the
 *   mistake the report names, which the UI labels as not the student's work.
 */
import { z } from "zod";

const Id = z.string().regex(/^[a-z0-9][a-z0-9_.:-]*$/);

export const LessonCheckSchema = z
  .object({
    method: z.enum(["structure", "cas_sympy", "llm_review"]),
    passed: z.boolean(),
    model: z.string().optional(),
    detail: z.string(),
  })
  .strict();
export type LessonCheck = z.infer<typeof LessonCheckSchema>;

export const LessonVerificationSchema = z
  .object({
    status: z.literal("verified"),
    checks: z.array(LessonCheckSchema).min(1),
    verified_at: z.string().min(1),
  })
  .strict();

export const LessonProvenanceSchema = z
  .object({
    generator: z.object({ provider: z.string(), model: z.string() }).strict(),
    reviewer: z.object({ provider: z.string(), model: z.string() }).strict().optional(),
    generated_at: z.string().min(1),
    prompt_version: z.string().min(1),
    /** Made from a demo fixture record (SAMPLE DATA). */
    sample_data: z.boolean().optional(),
  })
  .strict();

/**
 * Machine-checkable claim on a displayed line: `expr` (SymPy) is the value the
 * line shows. "answer": it must equal the from-scratch answer; "not_answer":
 * it must differ (a wrong step really is wrong).
 */
export const CasClaimSchema = z
  .object({
    expr: z.string().min(1),
    expect: z.enum(["answer", "not_answer"]),
  })
  .strict();
export type CasClaim = z.infer<typeof CasClaimSchema>;

/** How SymPy works the answer out from scratch (maths only). */
export const CasSetupSchema = z
  .object({
    mode: z.enum(["equal", "antiderivative", "numeric"]),
    symbols: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,15}$/)),
    compute: z.string().min(1),
  })
  .strict();
export type CasSetup = z.infer<typeof CasSetupSchema>;

export const RecapWrongLineSchema = z
  .object({
    /** student_working: an exact slice of the report's quote. typical_step: text with $…$ LaTeX. */
    text: z.string().min(1),
    /** This line holds the error the report describes. */
    wrong: z.boolean(),
    /** student_working: the exact part of `text` to circle (must occur in it). */
    mark: z.string().min(1).optional(),
    cas: CasClaimSchema.optional(),
  })
  .strict();
export type RecapWrongLine = z.infer<typeof RecapWrongLineSchema>;

export const RecapFixLineSchema = z
  .object({
    /** Text with $…$ LaTeX (maths lines are usually a single $…$). */
    text: z.string().min(1),
    /** Optional short margin note ("inner function: x²"). */
    note: z.string().min(1).max(120).optional(),
    cas: CasClaimSchema.optional(),
  })
  .strict();
export type RecapFixLine = z.infer<typeof RecapFixLineSchema>;

export const RECAP_MODES = ["student_working", "typical_step"] as const;
export type RecapMode = (typeof RECAP_MODES)[number];

export const MistakeRecapSchema = z
  .object({
    schema_version: z.literal("1.0"),
    record_id: Id,
    /** `recapSourceHash(record)` when made: a changed record makes the recap stale (ignored). */
    source_hash: z.string().min(1),
    subject: z.string().min(1),
    concept_id: Id.optional(),
    misconception_id: Id.optional(),
    mode: z.enum(RECAP_MODES),
    wrong: z
      .object({
        /** "plain": the report's quote, shown verbatim; "latex": $…$ text (typical steps, or a LaTeX quote). */
        format: z.enum(["plain", "latex"]),
        lines: z.array(RecapWrongLineSchema).min(1).max(8),
        /** Plain language: what went wrong at the marked step (may contain $…$). */
        note: z.string().min(1).max(320),
      })
      .strict(),
    fix: z
      .object({
        lines: z.array(RecapFixLineSchema).min(1).max(8),
      })
      .strict(),
    /** One or two sentences: the key idea that prevents this mistake. */
    key_idea: z.string().min(1).max(320),
    cas: CasSetupSchema.optional(),
    verification: LessonVerificationSchema,
    provenance: LessonProvenanceSchema,
  })
  .strict()
  .superRefine((r, ctx) => {
    if (!r.wrong.lines.some((l) => l.wrong)) ctx.addIssue({ code: "custom", path: ["wrong", "lines"], message: "no line is marked wrong" });
    if (r.mode === "typical_step" && r.wrong.format !== "latex")
      ctx.addIssue({ code: "custom", path: ["wrong", "format"], message: "typical steps are written in LaTeX, never as handwriting" });
  });
export type MistakeRecap = z.infer<typeof MistakeRecapSchema>;

export const EXPLAINER_STEP_KINDS = ["wrong", "why", "idea", "example", "check", "rule"] as const;
export type ExplainerStepKind = (typeof EXPLAINER_STEP_KINDS)[number];

export const ExplainerStepSchema = z
  .object({
    /**
     * wrong: the typical wrong step (always first); why: why it fails;
     * idea: building the intuition; rule: the correct rule; example: a worked
     * line; check: a quick self-check the student can do.
     */
    kind: z.enum(EXPLAINER_STEP_KINDS),
    /** What the narrator says (1-3 sentences, may contain $…$). */
    say: z.string().min(1).max(400),
    /** The big formula on the board for this step (LaTeX, no $). */
    math: z.string().min(1).max(300).optional(),
    cas: CasClaimSchema.optional(),
  })
  .strict();
export type ExplainerStep = z.infer<typeof ExplainerStepSchema>;

export const StepExplainerSchema = z
  .object({
    schema_version: z.literal("1.0"),
    misconception_id: Id,
    concept_id: Id,
    subject: z.string().min(1),
    title: z.string().min(1).max(90),
    steps: z.array(ExplainerStepSchema).min(4).max(9),
    /** One sentence to remember. */
    takeaway: z.string().min(1).max(240),
    cas: CasSetupSchema.optional(),
    verification: LessonVerificationSchema,
    provenance: LessonProvenanceSchema,
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.steps[0]?.kind !== "wrong") ctx.addIssue({ code: "custom", path: ["steps", 0], message: "an explainer starts from the typical wrong step" });
    if (!e.steps.some((s) => s.kind === "rule" || s.kind === "idea"))
      ctx.addIssue({ code: "custom", path: ["steps"], message: "an explainer must state the correct idea" });
  });
export type StepExplainer = z.infer<typeof StepExplainerSchema>;

export const RecapFileSchema = z
  .object({
    notice: z.string().optional(),
    recap: MistakeRecapSchema,
  })
  .strict();

export const ExplainerFileSchema = z
  .object({
    explainer: StepExplainerSchema,
  })
  .strict();
