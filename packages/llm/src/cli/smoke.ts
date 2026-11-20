/**
 * LLM smoke test: one small, real, structured call through the provider layer,
 * then the identical call again to prove the response cache.
 * Usage: pnpm llm:smoke
 */
import { z } from "zod";
import { findRepoRoot, loadAppConfig } from "@progresso/core";
import { createLlmClient } from "../factory";
import { resolveTaskConfig, loadLlmConfig } from "../config";
import { JsonlUsageLog } from "../usage-log";

const SmokeSchema = z.object({
  rule_name: z.string().min(1),
  one_sentence_explanation: z.string().min(1),
  worked_example: z.object({
    function: z.string().min(1),
    derivative: z.string().min(1),
  }),
});

const repoRoot = findRepoRoot();
const client = createLlmClient({ repoRoot });
const cfg = resolveTaskConfig(loadLlmConfig(repoRoot), "smoke_test");
console.log(`Task "smoke_test" -> provider=${cfg.provider} model=${cfg.model} fallbacks=[${cfg.fallbackModels.join(", ")}]\n`);

const request = {
  system: "You are a precise CBSE Class 12 mathematics tutor. Reply only with JSON matching the schema.",
  prompt:
    "Name the differentiation rule used for composite functions, explain it in one sentence for a Class 12 student, " +
    "and give one worked example: differentiate sin(x^2) with respect to x.",
  schema: SmokeSchema,
};

const first = await client.generateObject("smoke_test", { ...request, cache: "refresh" });
console.log("1) Live call");
console.log(JSON.stringify(first.data, null, 2));
console.log(
  `   answered by ${first.model} | calls=${first.calls} repairs=${first.repairs} | ${first.latencyMs} ms | ` +
    `tokens in=${first.usage.inputTokens} out=${first.usage.outputTokens} thinking=${first.usage.thinkingTokens} total=${first.usage.totalTokens}`,
);

const second = await client.generateObject("smoke_test", { ...request, cache: "use" });
console.log(`\n2) Same call again -> cached=${second.cached}, calls=${second.calls}, tokens=${second.usage.totalTokens}, ${second.latencyMs} ms`);
if (!second.cached) throw new Error("expected the second call to be served from cache");

const log = new JsonlUsageLog(loadAppConfig(repoRoot).llmUsageLog);
console.log(`\nLast 2 usage-log entries (${log.path}):`);
for (const entry of log.read().slice(-2)) console.log(`  ${JSON.stringify(entry)}`);
console.log("\nLLM smoke test passed.");
