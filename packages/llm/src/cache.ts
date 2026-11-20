import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TokenUsage } from "./types";

export interface CachedResponse {
  key: string;
  createdAt: string;
  task: string;
  provider: string;
  model: string;
  text: string;
  /** Usage of the original (paid) call, for reference. A cache hit costs nothing. */
  originalUsage: TokenUsage;
}

export interface ResponseCache {
  get(key: string): CachedResponse | undefined;
  set(entry: CachedResponse): void;
}

/** Stable JSON: object keys sorted, so logically equal inputs hash equally. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function hashKey(input: unknown): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

/** One JSON file per response under data/cache/llm/<2-char prefix>/<hash>.json. */
export class FileResponseCache implements ResponseCache {
  constructor(private readonly dir: string) {}

  private path(key: string): string {
    return join(this.dir, key.slice(0, 2), `${key}.json`);
  }

  get(key: string): CachedResponse | undefined {
    const p = this.path(key);
    if (!existsSync(p)) return undefined;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as CachedResponse;
    } catch {
      return undefined; // a corrupt entry is treated as a miss and overwritten
    }
  }

  set(entry: CachedResponse): void {
    const p = this.path(entry.key);
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(entry, null, 2));
    renameSync(tmp, p);
  }
}

export class MemoryResponseCache implements ResponseCache {
  readonly entries = new Map<string, CachedResponse>();
  get(key: string): CachedResponse | undefined {
    return this.entries.get(key);
  }
  set(entry: CachedResponse): void {
    this.entries.set(entry.key, entry);
  }
}
