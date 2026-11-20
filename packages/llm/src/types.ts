/** Provider-neutral request/response types. Providers translate these to their own SDKs. */

export const PROVIDER_NAMES = ["gemini", "anthropic", "openai_compatible"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

/** Provider-neutral reasoning depth. Mapped to Gemini thinkingLevel / Anthropic effort; ignored where unsupported. */
export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

export interface GenerateRequest {
  model: string;
  system?: string;
  prompt: string;
  /** When set, the provider is asked for JSON matching this schema (native structured output where available). */
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens: number;
  thinking?: ThinkingLevel;
  timeoutMs?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Reasoning tokens, billed as output by most providers. 0 when not reported. */
  thinkingTokens: number;
  /** Input tokens served from the provider's own prompt cache. */
  cachedInputTokens: number;
  totalTokens: number;
}

export interface GenerateResult {
  text: string;
  usage: TokenUsage;
  /** Model that actually answered (as reported by the provider). */
  model: string;
  finishReason?: string;
}

export interface LlmProvider {
  readonly name: ProviderName;
  /** True when calls leave this machine; external providers get the PII guard. */
  readonly external: boolean;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

export class LlmProviderError extends Error {
  override name = "LlmProviderError";
  readonly provider: ProviderName;
  readonly status?: number;
  /** Worth retrying the same request (rate limits, overload, 5xx, network). */
  readonly retryable: boolean;
  /** Worth trying the next fallback model (overload/unavailable/quota on this model). */
  readonly tryFallback: boolean;
  readonly retryAfterMs?: number;

  constructor(opts: {
    provider: ProviderName;
    message: string;
    status?: number;
    retryable: boolean;
    tryFallback?: boolean;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super(opts.message, { cause: opts.cause });
    this.provider = opts.provider;
    this.status = opts.status;
    this.retryable = opts.retryable;
    this.tryFallback = opts.tryFallback ?? opts.retryable;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export const emptyUsage = (): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
  cachedInputTokens: 0,
  totalTokens: 0,
});

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    thinkingTokens: a.thinkingTokens + b.thinkingTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

/** Classify an HTTP status into retry/fallback behaviour. Shared by all providers. */
export function errorFromStatus(
  provider: ProviderName,
  status: number | undefined,
  message: string,
  cause?: unknown,
  retryAfterMs?: number,
): LlmProviderError {
  const retryable = status === undefined || status === 408 || status === 429 || status >= 500;
  return new LlmProviderError({ provider, status, message, retryable, retryAfterMs, cause });
}
