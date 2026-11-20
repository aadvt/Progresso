import { errorFromStatus, LlmProviderError, type GenerateRequest, type GenerateResult, type LlmProvider } from "../types";

interface ChatCompletionResponse {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

/**
 * Optional provider: any OpenAI-compatible /chat/completions server, e.g. a
 * local Ollama (http://localhost:11434/v1). Plain fetch, no SDK, no account.
 */
export class OpenAICompatibleProvider implements LlmProvider {
  readonly name = "openai_compatible" as const;
  readonly external: boolean;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
  ) {
    const host = new URL(baseUrl).hostname;
    this.external = !["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const body = {
      model: req.model,
      messages: [...(req.system ? [{ role: "system", content: req.system }] : []), { role: "user", content: req.prompt }],
      max_tokens: req.maxOutputTokens,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.jsonSchema
        ? { response_format: { type: "json_schema", json_schema: { name: "output", schema: req.jsonSchema, strict: true } } }
        : {}),
    };
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(req.timeoutMs ?? 120_000),
      });
    } catch (e) {
      throw errorFromStatus(this.name, undefined, `OpenAI-compatible request failed: ${(e as Error).message}`, e);
    }
    if (!res.ok) {
      const retryAfter = Number(res.headers.get("retry-after"));
      throw errorFromStatus(
        this.name,
        res.status,
        `OpenAI-compatible server error ${res.status}: ${(await res.text()).slice(0, 500)}`,
        undefined,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
      );
    }
    const json = (await res.json()) as ChatCompletionResponse;
    const choice = json.choices?.[0];
    const text = choice?.message?.content ?? "";
    if (!text) {
      throw new LlmProviderError({ provider: this.name, message: "server returned no text", retryable: false });
    }
    const inputTokens = json.usage?.prompt_tokens ?? 0;
    const outputTokens = json.usage?.completion_tokens ?? 0;
    return {
      text,
      model: json.model ?? req.model,
      finishReason: choice?.finish_reason,
      usage: {
        inputTokens,
        outputTokens,
        thinkingTokens: json.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
        cachedInputTokens: 0,
        totalTokens: json.usage?.total_tokens ?? inputTokens + outputTokens,
      },
    };
  }
}
