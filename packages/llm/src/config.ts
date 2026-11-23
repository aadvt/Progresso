import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { PROVIDER_NAMES } from "./types";

/**
 * Known tasks. Every LLM call names one, so provider/model can be routed per
 * task in config/llm.json. Unknown task names fall back to "defaults".
 */
export const LLM_TASKS = [
  "parse_report",
  "explain",
  "generate_questions",
  "verify_questions",
  "write_recap",
  "write_explainer",
  "review_lesson",
  "write_storyboard",
  "codegen_manim",
  "check_frames",
  "match_clip",
  "write_message",
  "smoke_test",
] as const;
export type LlmTask = (typeof LLM_TASKS)[number];

const Thinking = z.enum(["minimal", "low", "medium", "high"]);

const TaskFields = {
  provider: z.enum(PROVIDER_NAMES),
  model: z.string().min(1),
  /** Tried in order when the primary model is overloaded, timing out or out of quota. Same provider. */
  fallbackModels: z.array(z.string().min(1)),
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().positive(),
  thinking: Thinking,
  timeoutMs: z.number().int().positive(),
};

export const TaskConfigSchema = z
  .object({
    ...TaskFields,
    fallbackModels: TaskFields.fallbackModels.default([]),
    temperature: TaskFields.temperature.optional(),
    thinking: TaskFields.thinking.optional(),
    timeoutMs: TaskFields.timeoutMs.default(120_000),
  })
  .strict();
export type TaskConfig = z.infer<typeof TaskConfigSchema>;

/** Per-task override: every field optional and, crucially, no defaults (so it never masks config.defaults). */
const TaskOverrideSchema = z.object(TaskFields).partial().strict();

const ProviderSettingsSchema = z
  .object({
    /** Client-side cap; 0 disables. Free tiers are low, so keep this conservative. */
    requestsPerMinute: z.number().int().min(0),
    apiKeyEnv: z.string().optional(),
    baseUrlEnv: z.string().optional(),
    defaultBaseUrl: z.string().optional(),
  })
  .strict();
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;

export const LlmConfigSchema = z
  .object({
    defaults: TaskConfigSchema,
    /** Per-task overrides, merged over defaults. */
    tasks: z.record(z.string(), TaskOverrideSchema),
    providers: z.partialRecord(z.enum(PROVIDER_NAMES), ProviderSettingsSchema),
    retry: z
      .object({
        attemptsPerModel: z.number().int().min(1),
        baseDelayMs: z.number().int().min(0),
        maxDelayMs: z.number().int().min(0),
      })
      .strict(),
    /** How many times to ask the model to fix output that fails schema validation. */
    repairAttempts: z.number().int().min(0),
    /** Bump to invalidate every cached response (e.g. after a prompt-format change). */
    cacheVersion: z.number().int().min(1),
  })
  .strict();
export type LlmConfig = z.infer<typeof LlmConfigSchema>;

export function loadLlmConfig(repoRoot: string): LlmConfig {
  const path = join(repoRoot, "config", "llm.json");
  const parsed = LlmConfigSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new Error(`Invalid ${path}:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  return applyEnvOverrides(parsed.data);
}

/**
 * Env overrides for quick switching without editing config:
 *   LLM_PROVIDER / LLM_MODEL                 -> every task
 *   LLM_TASK_<TASK>_PROVIDER / _MODEL        -> one task, e.g. LLM_TASK_EXPLAIN_MODEL
 */
function applyEnvOverrides(config: LlmConfig): LlmConfig {
  const env = process.env;
  const out: LlmConfig = structuredClone(config);
  if (env.LLM_PROVIDER || env.LLM_MODEL) {
    const patch = {
      ...(env.LLM_PROVIDER ? { provider: z.enum(PROVIDER_NAMES).parse(env.LLM_PROVIDER) } : {}),
      ...(env.LLM_MODEL ? { model: env.LLM_MODEL, fallbackModels: [] } : {}),
    };
    out.defaults = { ...out.defaults, ...patch };
    for (const task of Object.keys(out.tasks)) out.tasks[task] = { ...out.tasks[task], ...patch };
  }
  for (const task of new Set([...LLM_TASKS, ...Object.keys(out.tasks)])) {
    const key = `LLM_TASK_${task.toUpperCase()}`;
    const provider = env[`${key}_PROVIDER`];
    const model = env[`${key}_MODEL`];
    if (provider || model) {
      out.tasks[task] = {
        ...out.tasks[task],
        ...(provider ? { provider: z.enum(PROVIDER_NAMES).parse(provider) } : {}),
        ...(model ? { model, fallbackModels: [] } : {}),
      };
    }
  }
  return out;
}

export function resolveTaskConfig(config: LlmConfig, task: string, overrides: Partial<TaskConfig> = {}): TaskConfig {
  const merged = { ...config.defaults, ...(config.tasks[task] ?? {}), ...overrides };
  // A task routed to another provider must not inherit the default provider's fallback models.
  const providerChanged = merged.provider !== config.defaults.provider;
  const fallbackSet = "fallbackModels" in (config.tasks[task] ?? {}) || "fallbackModels" in overrides;
  if (providerChanged && !fallbackSet) merged.fallbackModels = [];
  return TaskConfigSchema.parse(merged);
}
