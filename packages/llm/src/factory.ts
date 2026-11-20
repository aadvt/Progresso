import { findRepoRoot, loadAppConfig, loadDotEnv } from "@progresso/core";
import { FileResponseCache } from "./cache";
import { LlmClient } from "./client";
import { loadLlmConfig, type LlmConfig } from "./config";
import type { PiiGuardOptions } from "./pii-guard";
import { AnthropicProvider } from "./providers/anthropic";
import { GeminiProvider } from "./providers/gemini";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";
import type { LlmProvider, ProviderName } from "./types";
import { JsonlUsageLog } from "./usage-log";

/** Build a provider from config + env. Throws a clear error if its key is missing. */
export function createProvider(name: ProviderName, config: LlmConfig): LlmProvider {
  const settings = config.providers[name];
  const key = settings?.apiKeyEnv ? process.env[settings.apiKeyEnv] : undefined;
  switch (name) {
    case "gemini":
      if (!key) throw new Error(`Set ${settings?.apiKeyEnv ?? "GEMINI_API_KEY"} in .env to use the Gemini provider`);
      return new GeminiProvider(key);
    case "anthropic":
      if (!key) throw new Error(`Set ${settings?.apiKeyEnv ?? "ANTHROPIC_API_KEY"} in .env to use the Anthropic provider`);
      return new AnthropicProvider(key);
    case "openai_compatible": {
      const baseUrl = (settings?.baseUrlEnv && process.env[settings.baseUrlEnv]) || settings?.defaultBaseUrl;
      if (!baseUrl) throw new Error("Set OPENAI_COMPAT_BASE_URL to use the OpenAI-compatible provider");
      return new OpenAICompatibleProvider(baseUrl, key || undefined);
    }
  }
}

/** The standard client: config/llm.json, .env keys, file cache and JSONL usage log from config/app.json. */
export function createLlmClient(options: { repoRoot?: string; piiGuard?: PiiGuardOptions } = {}): LlmClient {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  loadDotEnv(repoRoot);
  const app = loadAppConfig(repoRoot);
  const config = loadLlmConfig(repoRoot);
  const providers = new Map<ProviderName, LlmProvider>();
  return new LlmClient({
    config,
    getProvider: (name) => {
      let p = providers.get(name);
      if (!p) {
        p = createProvider(name, config);
        providers.set(name, p);
      }
      return p;
    },
    cache: new FileResponseCache(app.llmCacheDir),
    usageLog: new JsonlUsageLog(app.llmUsageLog),
    piiGuard: options.piiGuard,
  });
}
