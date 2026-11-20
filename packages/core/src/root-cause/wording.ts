import { z } from "zod";
import type { RootCauseAnalysis } from "./types";

/**
 * Optional LLM re-wording of root explanations. The engine's facts are fixed;
 * the model only rephrases them for a 16-year-old. The prompt carries concept
 * names and counts only (no student id, name or report text), and the LLM
 * client caches by prompt, so the same analysis is worded once.
 *
 * Core does not depend on @progresso/llm; any client with this shape works
 * (LlmClient does).
 */
export interface ObjectGenerator {
  generateObject<T>(
    task: string,
    options: { system?: string; prompt: string; schema: z.ZodType<T> },
  ): Promise<{ data: T; cached: boolean }>;
}

export const WORDING_TASK = "explain";

const WordingSchema = z
  .object({
    roots: z.array(z.object({ concept_id: z.string(), explanation: z.string().min(20).max(700) }).strict()),
  })
  .strict();

const SYSTEM =
  "You explain study diagnoses to a 16-year-old CBSE Class 11-12 student. Plain words, warm but direct, no jargon " +
  "beyond the topic names given, 2-4 short sentences, second person. Use ONLY the facts provided; never add numbers, " +
  "topics or claims that are not in the facts. Keep every number exactly as given.";

export function wordingPrompt(analysis: RootCauseAnalysis): string {
  const facts = analysis.roots.map((r) => ({
    concept_id: r.concept.id,
    root_topic: r.concept.name,
    root_class: r.concept.class,
    errors_explained: r.explains.length,
    exams_with_this_error: r.exam_ids.length,
    topics_where_errors_happened: [...new Set(r.explains.map((e) => (e.tested ?? e.anchor).name))],
    example_chains: [...new Set(r.explains.map((e) => (e.tested_path ?? e.path).map((p) => p.name).join(" -> ")))].slice(0, 4),
    repeated_misconceptions: r.misconceptions.map((m) => `${m.description} (x${m.count})`),
    marks_lost: Math.round(r.marks.lost),
    confidence: r.confidence_label,
    some_counter_evidence: r.evidence_against.length > 0,
    draft: r.explanation,
  }));
  return (
    "Rewrite each draft explanation of why this topic is the root of the student's mistakes. " +
    "Return one entry per concept_id, same ids.\n\nFACTS:\n" +
    JSON.stringify(facts, null, 2)
  );
}

/** Returns a copy of the analysis with LLM-worded explanations; falls back to the templates on any problem. */
export async function wordExplanations(
  analysis: RootCauseAnalysis,
  generator: ObjectGenerator,
): Promise<{ analysis: RootCauseAnalysis; cached: boolean; error?: string }> {
  if (analysis.roots.length === 0) return { analysis, cached: true };
  try {
    const res = await generator.generateObject(WORDING_TASK, { system: SYSTEM, prompt: wordingPrompt(analysis), schema: WordingSchema });
    const byId = new Map(res.data.roots.map((r) => [r.concept_id, r.explanation.trim()]));
    const roots = analysis.roots.map((r) => {
      const worded = byId.get(r.concept.id);
      return worded ? { ...r, explanation: worded, explanation_source: "llm" as const } : r;
    });
    return { analysis: { ...analysis, roots }, cached: res.cached };
  } catch (e) {
    return { analysis, cached: false, error: (e as Error).message };
  }
}
