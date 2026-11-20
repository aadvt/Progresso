import { z } from "zod";
import { hashKey, type ResponseCache } from "./cache";
import { resolveTaskConfig, type LlmConfig, type TaskConfig } from "./config";
import { assertNoPii, type PiiGuardOptions } from "./pii-guard";
import { RateLimiter } from "./rate-limiter";
import {
  addUsage,
  emptyUsage,
  LlmProviderError,
  type GenerateRequest,
  type GenerateResult,
  type LlmProvider,
  type ProviderName,
  type TokenUsage,
} from "./types";
import type { UsageSink } from "./usage-log";

/** use: read and write the cache; refresh: always call, then write; off: neither. */
export type CacheMode = "use" | "refresh" | "off";

export interface RunOptions {
  system?: string;
  prompt: string;
  cache?: CacheMode;
  /** Per-call overrides of the task's configured provider/model/limits. */
  overrides?: Partial<TaskConfig>;
}

export interface RunResult<T> {
  data: T;
  text: string;
  provider: ProviderName;
  /** Model that produced the final answer. */
  model: string;
  cached: boolean;
  /** Provider calls made (retries, fallbacks and repairs included). */
  calls: number;
  repairs: number;
  usage: TokenUsage;
  latencyMs: number;
}

export class StructuredOutputError extends Error {
  override name = "StructuredOutputError";
  constructor(
    message: string,
    readonly lastText: string,
  ) {
    super(message);
  }
}

export interface LlmClientDeps {
  config: LlmConfig;
  getProvider: (name: ProviderName) => LlmProvider;
  cache?: ResponseCache;
  usageLog?: UsageSink;
  piiGuard?: PiiGuardOptions;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

type Parsed<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * The only way the app talks to an LLM. Every call names a task; config/llm.json
 * routes each task to a provider and model.
 */
export class LlmClient {
  private readonly limiters = new Map<ProviderName, RateLimiter>();
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(private readonly deps: LlmClientDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = deps.random ?? Math.random;
    this.now = deps.now ?? Date.now;
  }

  /** Free-text generation. */
  generateText(task: string, options: RunOptions): Promise<RunResult<string>> {
    return this.run(task, options, undefined, (text) => ({ ok: true, data: text }));
  }

  /**
   * Structured generation. The schema is sent to the provider as JSON Schema
   * (native structured output), then the reply is validated with zod; invalid
   * replies are sent back for repair up to config.repairAttempts times.
   */
  generateObject<T>(task: string, options: RunOptions & { schema: z.ZodType<T> }): Promise<RunResult<T>> {
    const jsonSchema = z.toJSONSchema(options.schema, { target: "draft-2020-12", unrepresentable: "any" }) as Record<
      string,
      unknown
    >;
    delete jsonSchema.$schema;
    return this.run(task, options, jsonSchema, (text) => parseStructured(text, options.schema));
  }

  private async run<T>(
    task: string,
    options: RunOptions,
    jsonSchema: Record<string, unknown> | undefined,
    parse: (text: string) => Parsed<T>,
  ): Promise<RunResult<T>> {
    const started = this.now();
    const cfg = resolveTaskConfig(this.deps.config, task, options.overrides);
    const cacheMode = options.cache ?? "use";
    const provider = this.deps.getProvider(cfg.provider);

    if (provider.external) assertNoPii(`${options.system ?? ""}\n${options.prompt}`, this.deps.piiGuard);

    const request: GenerateRequest = {
      model: cfg.model,
      system: options.system,
      prompt: options.prompt,
      jsonSchema,
      temperature: cfg.temperature,
      maxOutputTokens: cfg.maxOutputTokens,
      thinking: cfg.thinking,
      timeoutMs: cfg.timeoutMs,
    };
    // The key covers everything that changes the answer, and nothing that doesn't (task name, timeout).
    const key = hashKey({
      v: this.deps.config.cacheVersion,
      provider: cfg.provider,
      models: [cfg.model, ...cfg.fallbackModels],
      system: request.system,
      prompt: request.prompt,
      jsonSchema,
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
      thinking: request.thinking,
    });

    const base = { task, provider: cfg.provider, requestedModel: cfg.model };
    if (cacheMode === "use" && this.deps.cache) {
      const hit = this.deps.cache.get(key);
      const parsed = hit ? parse(hit.text) : undefined;
      if (hit && parsed?.ok) {
        const latencyMs = this.now() - started;
        this.deps.usageLog?.record({
          ts: new Date().toISOString(),
          ...base,
          answeredBy: hit.model,
          cached: true,
          ok: true,
          calls: 0,
          repairs: 0,
          latencyMs,
          usage: emptyUsage(),
        });
        return {
          data: parsed.data,
          text: hit.text,
          provider: cfg.provider,
          model: hit.model,
          cached: true,
          calls: 0,
          repairs: 0,
          usage: emptyUsage(),
          latencyMs,
        };
      }
    }

    let calls = 0;
    let repairs = 0;
    let usage = emptyUsage();
    let answeredBy: string | undefined;
    try {
      let current = request;
      for (;;) {
        const { result, calls: n } = await this.callWithFallback(provider, cfg, current);
        calls += n;
        usage = addUsage(usage, result.usage);
        answeredBy = result.model;
        const parsed = parse(result.text);
        if (parsed.ok) {
          if (cacheMode !== "off" && this.deps.cache) {
            this.deps.cache.set({
              key,
              createdAt: new Date().toISOString(),
              task,
              provider: cfg.provider,
              model: result.model,
              text: result.text,
              originalUsage: usage,
            });
          }
          const latencyMs = this.now() - started;
          this.deps.usageLog?.record({
            ts: new Date().toISOString(),
            ...base,
            answeredBy,
            cached: false,
            ok: true,
            calls,
            repairs,
            latencyMs,
            usage,
          });
          return { data: parsed.data, text: result.text, provider: cfg.provider, model: result.model, cached: false, calls, repairs, usage, latencyMs };
        }
        if (repairs >= this.deps.config.repairAttempts) {
          throw new StructuredOutputError(
            `Output for task "${task}" failed validation after ${repairs} repair attempt(s): ${parsed.error}`,
            result.text,
          );
        }
        repairs++;
        current = { ...request, prompt: repairPrompt(request.prompt, result.text, parsed.error) };
      }
    } catch (e) {
      this.deps.usageLog?.record({
        ts: new Date().toISOString(),
        ...base,
        answeredBy,
        cached: false,
        ok: false,
        calls,
        repairs,
        latencyMs: this.now() - started,
        usage,
        error: (e as Error).message.slice(0, 500),
      });
      throw e;
    }
  }

  /** Try the primary model, then each fallback; retry retryable errors with exponential backoff. */
  private async callWithFallback(
    provider: LlmProvider,
    cfg: TaskConfig,
    request: GenerateRequest,
  ): Promise<{ result: GenerateResult; calls: number }> {
    const { attemptsPerModel, baseDelayMs, maxDelayMs } = this.deps.config.retry;
    const models = [cfg.model, ...cfg.fallbackModels];
    let calls = 0;
    let lastError: LlmProviderError | undefined;

    for (const [index, model] of models.entries()) {
      const hasNext = index < models.length - 1;
      for (let attempt = 1; attempt <= attemptsPerModel; attempt++) {
        await this.limiter(provider.name).acquire();
        calls++;
        try {
          return { result: await provider.generate({ ...request, model }), calls };
        } catch (e) {
          if (!(e instanceof LlmProviderError)) throw e;
          lastError = e;
          if (!e.retryable) {
            if (e.tryFallback && hasNext) break;
            throw e;
          }
          if (attempt === attemptsPerModel) break;
          const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)) * (0.5 + this.random() * 0.5);
          await this.sleep(Math.max(backoff, e.retryAfterMs ?? 0));
        }
      }
      if (!lastError?.tryFallback) break;
    }
    throw lastError ?? new Error("LLM call failed with no error recorded");
  }

  private limiter(name: ProviderName): RateLimiter {
    let limiter = this.limiters.get(name);
    if (!limiter) {
      const rpm = this.deps.config.providers[name]?.requestsPerMinute ?? 0;
      limiter = new RateLimiter(rpm, this.now, this.sleep);
      this.limiters.set(name, limiter);
    }
    return limiter;
  }
}

function parseStructured<T>(text: string, schema: z.ZodType<T>): Parsed<T> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch (e) {
    return { ok: false, error: `not valid JSON (${(e as Error).message})` };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, data: result.data };
  const issues = result.error.issues
    .slice(0, 10)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
  return { ok: false, error: issues };
}

function repairPrompt(originalPrompt: string, badOutput: string, error: string): string {
  return [
    originalPrompt,
    "",
    "---",
    "Your previous reply did not match the required JSON schema.",
    `Validation errors: ${error}`,
    "Previous reply:",
    badOutput.slice(0, 8000),
    "",
    "Reply again with ONLY the corrected JSON object. Keep all correct content unchanged.",
  ].join("\n");
}
