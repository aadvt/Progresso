import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TokenUsage } from "./types";

/** One line per LlmClient.run(), appended to data/logs/llm-usage.jsonl. */
export interface UsageEntry {
  ts: string;
  task: string;
  provider: string;
  /** Model requested first. */
  requestedModel: string;
  /** Model that produced the final answer (differs when a fallback was used). */
  answeredBy?: string;
  cached: boolean;
  ok: boolean;
  /** Provider calls made (retries, fallbacks and repairs included). 0 on a cache hit. */
  calls: number;
  repairs: number;
  latencyMs: number;
  usage: TokenUsage;
  error?: string;
}

export interface UsageSink {
  record(entry: UsageEntry): void;
}

export class JsonlUsageLog implements UsageSink {
  constructor(readonly path: string) {}

  record(entry: UsageEntry): void {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`);
  }

  read(): UsageEntry[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as UsageEntry);
  }
}

export class MemoryUsageLog implements UsageSink {
  readonly entries: UsageEntry[] = [];
  record(entry: UsageEntry): void {
    this.entries.push(entry);
  }
}

export interface TaskUsageSummary {
  task: string;
  runs: number;
  cacheHits: number;
  failures: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  models: string[];
}

export function summariseUsage(entries: UsageEntry[]): TaskUsageSummary[] {
  const byTask = new Map<string, TaskUsageSummary>();
  for (const e of entries) {
    const s = byTask.get(e.task) ?? {
      task: e.task,
      runs: 0,
      cacheHits: 0,
      failures: 0,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      totalTokens: 0,
      models: [],
    };
    s.runs++;
    if (e.cached) s.cacheHits++;
    if (!e.ok) s.failures++;
    s.calls += e.calls;
    s.inputTokens += e.usage.inputTokens;
    s.outputTokens += e.usage.outputTokens;
    s.thinkingTokens += e.usage.thinkingTokens;
    s.totalTokens += e.usage.totalTokens;
    if (e.answeredBy && !s.models.includes(e.answeredBy)) s.models.push(e.answeredBy);
    byTask.set(e.task, s);
  }
  return [...byTask.values()].sort((a, b) => a.task.localeCompare(b.task));
}
