import Anthropic from "@anthropic-ai/sdk";
import {
  errorFromStatus,
  LlmProviderError,
  type GenerateRequest,
  type GenerateResult,
  type LlmProvider,
  type ThinkingLevel,
} from "../types";

/** Effort is the depth control on current Claude models (thinking itself is adaptive). */
const EFFORT: Record<ThinkingLevel, "low" | "medium" | "high"> = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
};

/** Optional provider: Anthropic API via the official SDK. Selected per task in config/llm.json. */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic" as const;
  readonly external = true;
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    // Retries are owned by LlmClient.
    this.client = new Anthropic({ apiKey, maxRetries: 0 });
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    let response: Anthropic.Message;
    try {
      // Current Claude models reject sampling parameters, so req.temperature is intentionally not sent.
      response = await this.client.messages.create(
        {
          model: req.model,
          max_tokens: req.maxOutputTokens,
          ...(req.system ? { system: req.system } : {}),
          messages: [{ role: "user", content: req.prompt }],
          output_config: {
            ...(req.thinking ? { effort: EFFORT[req.thinking] } : {}),
            ...(req.jsonSchema ? { format: { type: "json_schema" as const, schema: req.jsonSchema } } : {}),
          },
        },
        req.timeoutMs ? { timeout: req.timeoutMs } : undefined,
      );
    } catch (e) {
      if (e instanceof Anthropic.APIError) {
        const retryAfter = Number(e.headers?.get?.("retry-after"));
        throw errorFromStatus(
          "anthropic",
          e.status,
          `Anthropic API error ${e.status ?? ""}: ${e.message}`,
          e,
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
        );
      }
      throw errorFromStatus("anthropic", undefined, `Anthropic request failed: ${(e as Error).message}`, e);
    }

    if (response.stop_reason === "refusal") {
      throw new LlmProviderError({ provider: this.name, message: "Claude declined the request (refusal)", retryable: false });
    }
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text) {
      throw new LlmProviderError({
        provider: this.name,
        message: `Claude returned no text (stop_reason=${response.stop_reason})`,
        retryable: false,
      });
    }
    const u = response.usage;
    return {
      text,
      model: response.model,
      finishReason: response.stop_reason ?? undefined,
      usage: {
        inputTokens: u.input_tokens,
        // Anthropic bills thinking inside output_tokens and does not report it separately.
        outputTokens: u.output_tokens,
        thinkingTokens: 0,
        cachedInputTokens: u.cache_read_input_tokens ?? 0,
        totalTokens: u.input_tokens + u.output_tokens,
      },
    };
  }
}
