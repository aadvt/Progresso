import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export interface AppConfig {
  /** Root of the monorepo (directory containing pnpm-workspace.yaml). */
  repoRoot: string;
  /** Directory of concept-graph JSON files. Swap to data/concept-graph in Phase P. */
  conceptGraphDir: string;
  databasePath: string;
  fixturesDir: string;
  llmCacheDir: string;
  llmUsageLog: string;
  /** Verified prove-it questions, one JSON file per misconception. */
  questionBankDir: string;
  /** Mistake Recaps, one JSON per error record. Demo: data/fixtures/demo-recaps (SAMPLE DATA); Phase P: a git-ignored dir. */
  recapsDir: string;
  /** Step explainers, one JSON per misconception (not student data). */
  explainersDir: string;
}

/** Walk up from `start` to the directory containing pnpm-workspace.yaml. */
export function findRepoRoot(start: string = process.cwd()): string {
  // Paths here are resolved at runtime (env overrides), so bundlers must not trace them.
  let dir = resolve(/*turbopackIgnore: true*/ start);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Could not find repo root (pnpm-workspace.yaml) above ${start}`);
    dir = parent;
  }
}

/** Load .env from the repo root into process.env (existing variables win). */
export function loadDotEnv(repoRoot: string = findRepoRoot()): void {
  const path = join(repoRoot, ".env");
  if (existsSync(path)) process.loadEnvFile(path);
}

/**
 * Reads config/app.json, applies env overrides, and resolves every path
 * against the repo root.
 */
export function loadAppConfig(repoRoot: string = findRepoRoot()): AppConfig {
  const raw = JSON.parse(readFileSync(join(repoRoot, "config", "app.json"), "utf8")) as Record<string, string>;
  const pick = (key: string, env: string, fallback?: string): string => {
    const value = process.env[env] || raw[key] || fallback;
    if (!value) throw new Error(`config/app.json is missing "${key}"`);
    return isAbsolute(value) ? value : join(/*turbopackIgnore: true*/ repoRoot, value);
  };
  return {
    repoRoot,
    conceptGraphDir: pick("conceptGraphDir", "CONCEPT_GRAPH_DIR"),
    databasePath: pick("databasePath", "DATABASE_PATH"),
    fixturesDir: pick("fixturesDir", "FIXTURES_DIR"),
    llmCacheDir: pick("llmCacheDir", "LLM_CACHE_DIR"),
    llmUsageLog: pick("llmUsageLog", "LLM_USAGE_LOG"),
    questionBankDir: pick("questionBankDir", "QUESTION_BANK_DIR", "data/question-bank"),
    recapsDir: pick("recapsDir", "RECAPS_DIR", "data/fixtures/demo-recaps"),
    explainersDir: pick("explainersDir", "EXPLAINERS_DIR", "data/explainers"),
  };
}
