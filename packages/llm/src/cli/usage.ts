/** Print token usage per task from data/logs/llm-usage.jsonl. Usage: pnpm llm:usage */
import { loadAppConfig } from "@progresso/core";
import { JsonlUsageLog, summariseUsage } from "../usage-log";

const log = new JsonlUsageLog(loadAppConfig().llmUsageLog);
const entries = log.read();
if (entries.length === 0) {
  console.log(`No usage logged yet (${log.path}).`);
} else {
  console.log(`LLM usage from ${log.path} (${entries.length} runs)\n`);
  console.table(
    summariseUsage(entries).map((s) => ({
      task: s.task,
      runs: s.runs,
      "cache hits": s.cacheHits,
      failures: s.failures,
      "provider calls": s.calls,
      "input tok": s.inputTokens,
      "output tok": s.outputTokens,
      "thinking tok": s.thinkingTokens,
      "total tok": s.totalTokens,
      models: s.models.join(", "),
    })),
  );
}
