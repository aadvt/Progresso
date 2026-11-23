import { ApiError, GoogleGenAI, ThinkingLevel as GeminiThinkingLevel } from "@google/genai";
import {
  errorFromStatus,
  LlmProviderError,
  type GenerateRequest,
  type GenerateResult,
  type LlmProvider,
  type ThinkingLevel,
} from "../types";

const THINKING: Record<ThinkingLevel, GeminiThinkingLevel> = {
  minimal: GeminiThinkingLevel.MINIMAL,
  low: GeminiThinkingLevel.LOW,
  medium: GeminiThinkingLevel.MEDIUM,
  high: GeminiThinkingLevel.HIGH,
};

/** Google Gemini via the official @google/genai SDK (Gemini Developer API, API-key auth). */
export class GeminiProvider implements LlmProvider {
  readonly name = "gemini" as const;
  readonly external = true;
  private readonly client: GoogleGenAI;

  constructor(apiKey: string) {
    // Retries are owned by LlmClient (so they are counted, logged and can fall back to another model).
    // v1beta serves every model, including previews (v1 returns 404 for those).
    this.client = new GoogleGenAI({ apiKey, apiVersion: process.env.GEMINI_API_VERSION || "v1beta", httpOptions: { retryOptions: { attempts: 1 } } });
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    let response;
    try {
      response = await this.client.models.generateContent({
        model: req.model,
        contents: req.prompt,
        config: {
          ...(req.system ? { systemInstruction: req.system } : {}),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          maxOutputTokens: req.maxOutputTokens,
          ...(req.thinking ? { thinkingConfig: thinkingConfig(req.model, req.thinking) } : {}),
          ...(req.jsonSchema ? { responseMimeType: "application/json", responseJsonSchema: req.jsonSchema } : {}),
          ...(req.timeoutMs ? { httpOptions: { timeout: req.timeoutMs } } : {}),
        },
      });
    } catch (e) {
      throw toProviderError(e);
    }

    const candidate = response.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const text = response.text;
    if (!text) {
      const blocked = response.promptFeedback?.blockReason;
      throw new LlmProviderError({
        provider: this.name,
        message: `Gemini returned no text (finishReason=${finishReason ?? "none"}${blocked ? `, blockReason=${blocked}` : ""})`,
        // A MAX_TOKENS stop with no text usually means thinking used the budget; retrying will not help.
        retryable: !blocked && finishReason !== "MAX_TOKENS",
        tryFallback: false,
      });
    }
    const u = response.usageMetadata;
    const inputTokens = u?.promptTokenCount ?? 0;
    const outputTokens = u?.candidatesTokenCount ?? 0;
    const thinkingTokens = u?.thoughtsTokenCount ?? 0;
    return {
      text,
      model: response.modelVersion ?? req.model,
      finishReason,
      usage: {
        inputTokens,
        outputTokens,
        thinkingTokens,
        cachedInputTokens: u?.cachedContentTokenCount ?? 0,
        totalTokens: u?.totalTokenCount ?? inputTokens + outputTokens + thinkingTokens,
      },
    };
  }
}

function toProviderError(e: unknown): LlmProviderError {
  if (e instanceof ApiError) {
    return errorFromStatus("gemini", e.status, `Gemini API error ${e.status}: ${e.message}`, e, parseRetryDelay(e.message));
  }
  // Network failures, timeouts, aborted requests.
  return errorFromStatus("gemini", undefined, `Gemini request failed: ${(e as Error).message}`, e);
}

/** Gemini 429 bodies carry RetryInfo, e.g. "retryDelay": "23s" or "Please retry in 23.4s". */
function parseRetryDelay(message: string): number | undefined {
  const m = /retryDelay"?\s*:\s*"(\d+(?:\.\d+)?)s"|retry in (\d+(?:\.\d+)?)s/i.exec(message);
  const seconds = m ? Number(m[1] ?? m[2]) : NaN;
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : undefined;
}

/** Gemini 2.x takes a token budget instead of a thinking level. */
const BUDGET = { minimal: 0, low: 1024, medium: 4096, high: 16384 } as const;
function thinkingConfig(model: string, level: keyof typeof BUDGET) {
  return /^gemini-2\./.test(model) ? { thinkingBudget: BUDGET[level] } : { thinkingLevel: THINKING[level] };
}
