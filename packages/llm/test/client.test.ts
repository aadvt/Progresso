import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  assertNoPii,
  hashKey,
  LlmClient,
  LlmConfigSchema,
  LlmProviderError,
  MemoryResponseCache,
  MemoryUsageLog,
  PiiGuardError,
  RateLimiter,
  resolveTaskConfig,
  StructuredOutputError,
  type GenerateRequest,
  type GenerateResult,
  type LlmConfig,
  type LlmProvider,
} from "../src";

const config: LlmConfig = LlmConfigSchema.parse({
  defaults: { provider: "gemini", model: "primary", fallbackModels: ["backup"], maxOutputTokens: 100 },
  tasks: { explain: { maxOutputTokens: 50 }, write_message: { provider: "openai_compatible", model: "local" } },
  providers: { gemini: { requestsPerMinute: 0 }, openai_compatible: { requestsPerMinute: 0 } },
  retry: { attemptsPerModel: 2, baseDelayMs: 10, maxDelayMs: 100 },
  repairAttempts: 1,
  cacheVersion: 1,
});

type Step = string | LlmProviderError;

/** Scripted provider: returns/throws the next step for each call and records requests. */
class FakeProvider implements LlmProvider {
  readonly requests: GenerateRequest[] = [];
  constructor(
    private readonly steps: Step[],
    readonly name: "gemini" | "openai_compatible" = "gemini",
    readonly external = true,
  ) {}
  async generate(req: GenerateRequest): Promise<GenerateResult> {
    this.requests.push(req);
    const step = this.steps.shift();
    if (step === undefined) throw new Error("FakeProvider ran out of steps");
    if (step instanceof LlmProviderError) throw step;
    return {
      text: step,
      model: req.model,
      usage: { inputTokens: 10, outputTokens: 5, thinkingTokens: 2, cachedInputTokens: 0, totalTokens: 17 },
    };
  }
}

const overloaded = () => new LlmProviderError({ provider: "gemini", status: 503, message: "overloaded", retryable: true });
const badRequest = () => new LlmProviderError({ provider: "gemini", status: 400, message: "bad", retryable: false });

function setup(steps: Step[], opts: { external?: boolean } = {}) {
  const provider = new FakeProvider(steps, "gemini", opts.external ?? true);
  const cache = new MemoryResponseCache();
  const usage = new MemoryUsageLog();
  const sleeps: number[] = [];
  const client = new LlmClient({
    config,
    getProvider: () => provider,
    cache,
    usageLog: usage,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 1,
  });
  return { client, provider, cache, usage, sleeps };
}

describe("task config", () => {
  it("merges task overrides over defaults without wiping default fallbacks (regression)", () => {
    const explain = resolveTaskConfig(config, "explain");
    expect(explain).toMatchObject({ provider: "gemini", model: "primary", fallbackModels: ["backup"], maxOutputTokens: 50 });
  });

  it("does not carry the default provider's fallbacks to a task routed elsewhere", () => {
    expect(resolveTaskConfig(config, "write_message")).toMatchObject({ provider: "openai_compatible", model: "local", fallbackModels: [] });
  });

  it("uses defaults for unknown tasks and applies per-call overrides", () => {
    expect(resolveTaskConfig(config, "something_new").model).toBe("primary");
    expect(resolveTaskConfig(config, "explain", { model: "other" }).model).toBe("other");
  });
});

describe("LlmClient", () => {
  it("returns text and logs usage per task", async () => {
    const { client, usage } = setup(["hello"]);
    const res = await client.generateText("explain", { prompt: "hi" });
    expect(res).toMatchObject({ data: "hello", model: "primary", cached: false, calls: 1 });
    expect(usage.entries).toEqual([
      expect.objectContaining({ task: "explain", ok: true, cached: false, answeredBy: "primary", calls: 1, usage: expect.objectContaining({ totalTokens: 17 }) }),
    ]);
  });

  it("retries retryable errors with backoff", async () => {
    const { client, sleeps } = setup([overloaded(), "ok"]);
    const res = await client.generateText("explain", { prompt: "hi" });
    expect(res.calls).toBe(2);
    expect(res.model).toBe("primary");
    expect(sleeps).toEqual([10]);
  });

  it("honours retry-after when it is longer than the backoff", async () => {
    const slow = new LlmProviderError({ provider: "gemini", status: 429, message: "rate", retryable: true, retryAfterMs: 5000 });
    const { client, sleeps } = setup([slow, "ok"]);
    await client.generateText("explain", { prompt: "hi" });
    expect(sleeps).toEqual([5000]);
  });

  it("falls back to the next model when the primary stays overloaded", async () => {
    const { client, provider, usage } = setup([overloaded(), overloaded(), "from backup"]);
    const res = await client.generateText("explain", { prompt: "hi" });
    expect(res).toMatchObject({ data: "from backup", model: "backup", calls: 3 });
    expect(provider.requests.map((r) => r.model)).toEqual(["primary", "primary", "backup"]);
    expect(usage.entries[0]).toMatchObject({ requestedModel: "primary", answeredBy: "backup" });
  });

  it("does not retry non-retryable errors, and logs the failure", async () => {
    const { client, provider, usage } = setup([badRequest()]);
    await expect(client.generateText("explain", { prompt: "hi" })).rejects.toThrow("bad");
    expect(provider.requests).toHaveLength(1);
    expect(usage.entries[0]).toMatchObject({ ok: false, error: "bad" });
  });

  it("serves identical calls from the cache (no second provider call, zero tokens)", async () => {
    const { client, provider, usage } = setup(["first"]);
    await client.generateText("explain", { prompt: "same" });
    const again = await client.generateText("explain", { prompt: "same" });
    expect(again).toMatchObject({ data: "first", cached: true, calls: 0 });
    expect(again.usage.totalTokens).toBe(0);
    expect(provider.requests).toHaveLength(1);
    expect(usage.entries.map((e) => e.cached)).toEqual([false, true]);
  });

  it("cache: refresh always calls, off never stores", async () => {
    const { client, provider, cache } = setup(["a", "b", "c"]);
    await client.generateText("explain", { prompt: "p" });
    const refreshed = await client.generateText("explain", { prompt: "p", cache: "refresh" });
    expect(refreshed.data).toBe("b");
    await client.generateText("explain", { prompt: "q", cache: "off" });
    expect(provider.requests).toHaveLength(3);
    expect(cache.entries.size).toBe(1);
  });

  it("cache key ignores object key order but not content", () => {
    expect(hashKey({ a: 1, b: { c: 2, d: 3 } })).toBe(hashKey({ b: { d: 3, c: 2 }, a: 1 }));
    expect(hashKey({ a: 1 })).not.toBe(hashKey({ a: 2 }));
  });

  describe("structured output", () => {
    const Schema = z.object({ answer: z.string(), score: z.number() });

    it("sends a JSON schema and returns validated data", async () => {
      const { client, provider } = setup(['```json\n{"answer":"x","score":1}\n```']);
      const res = await client.generateObject("explain", { prompt: "p", schema: Schema });
      expect(res.data).toEqual({ answer: "x", score: 1 });
      expect(provider.requests[0]!.jsonSchema).toMatchObject({ type: "object", required: ["answer", "score"] });
    });

    it("repairs invalid output by sending the errors back", async () => {
      const { client, provider } = setup(['{"answer":"x"}', '{"answer":"x","score":2}']);
      const res = await client.generateObject("explain", { prompt: "original", schema: Schema });
      expect(res).toMatchObject({ data: { answer: "x", score: 2 }, repairs: 1, calls: 2 });
      expect(provider.requests[1]!.prompt).toMatch(/original[\s\S]*Validation errors: score/);
    });

    it("gives up after the configured repair attempts", async () => {
      const { client, usage, cache } = setup(["not json", "still not json"]);
      await expect(client.generateObject("explain", { prompt: "p", schema: Schema })).rejects.toBeInstanceOf(StructuredOutputError);
      expect(usage.entries[0]).toMatchObject({ ok: false, repairs: 1, calls: 2 });
      expect(cache.entries.size).toBe(0);
    });

    it("re-validates cached structured output", async () => {
      const { client, provider } = setup(['{"answer":"x","score":1}']);
      await client.generateObject("explain", { prompt: "p", schema: Schema });
      const again = await client.generateObject("explain", { prompt: "p", schema: Schema });
      expect(again.cached).toBe(true);
      expect(provider.requests).toHaveLength(1);
    });
  });

  describe("PII guard", () => {
    it("blocks emails and phone numbers before calling an external provider", async () => {
      const { client, provider } = setup(["x"]);
      await expect(client.generateText("explain", { prompt: "mail me at someone@example.com" })).rejects.toBeInstanceOf(PiiGuardError);
      await expect(client.generateText("explain", { prompt: "call 9876543210" })).rejects.toBeInstanceOf(PiiGuardError);
      expect(provider.requests).toHaveLength(0);
    });

    it("does not block a local provider", async () => {
      const { client } = setup(["x"], { external: false });
      await expect(client.generateText("explain", { prompt: "someone@example.com" })).resolves.toBeTruthy();
    });

    it("blocks configured terms such as student names", () => {
      expect(() => assertNoPii("Riya forgot the chain rule", { blockedTerms: ["Riya"] })).toThrow(PiiGuardError);
      expect(() => assertNoPii("The student forgot the chain rule", { blockedTerms: ["Riya"] })).not.toThrow();
    });
  });
});

describe("RateLimiter", () => {
  it("waits once the per-minute budget is used", async () => {
    let now = 0;
    const waits: number[] = [];
    const limiter = new RateLimiter(2, () => now, async (ms) => {
      waits.push(ms);
      now += ms;
    });
    await limiter.acquire();
    await limiter.acquire();
    expect(waits).toEqual([]);
    await limiter.acquire();
    expect(waits).toHaveLength(1);
    expect(now).toBeGreaterThanOrEqual(60_000);
  });

  it("is unlimited at 0 rpm", async () => {
    const limiter = new RateLimiter(0, () => 0, async () => {
      throw new Error("should not sleep");
    });
    for (let i = 0; i < 100; i++) await limiter.acquire();
  });
});
