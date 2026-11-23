/**
 * Loading cached lesson content (server-side).
 * - Recaps: <recapsDir>/<record_id>.json, one per error record.
 * - Explainers: <explainersDir>/<subject>/<misconception_id>.json.
 * Content for concepts or misconceptions the current graph doesn't have is
 * skipped with a warning, so a graph swap never breaks the app. A recap
 * whose record has changed since it was made (source hash) is ignored by
 * `recapFor`, so a re-parsed report never shows an out-of-date recap.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ErrorRecord } from "../error-record/schema";
import type { ConceptGraph } from "../graph/graph";
import { recapSourceHash } from "./checks";
import { ExplainerFileSchema, RecapFileSchema, type MistakeRecap, type StepExplainer } from "./schema";

export interface LessonLibrary {
  recaps: Map<string, MistakeRecap>;
  explainers: Map<string, StepExplainer>;
  warnings: string[];
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".json") && !name.startsWith("_")) out.push(p);
  }
  return out;
}

const issues = (e: { issues: { path: PropertyKey[]; message: string }[] }) => e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");

export function loadLessons(dirs: { recapsDir: string; explainersDir: string }, graph?: ConceptGraph): LessonLibrary {
  const recaps = new Map<string, MistakeRecap>();
  const explainers = new Map<string, StepExplainer>();
  const warnings: string[] = [];
  for (const file of walk(dirs.recapsDir)) {
    const parsed = RecapFileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (!parsed.success) {
      warnings.push(`${file}: ${issues(parsed.error)}`);
      continue;
    }
    recaps.set(parsed.data.recap.record_id, parsed.data.recap);
  }
  for (const file of walk(dirs.explainersDir)) {
    const parsed = ExplainerFileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (!parsed.success) {
      warnings.push(`${file}: ${issues(parsed.error)}`);
      continue;
    }
    const e = parsed.data.explainer;
    if (graph && !graph.misconceptions.has(e.misconception_id)) {
      warnings.push(`${e.misconception_id}: not in the current graph; explainer skipped`);
      continue;
    }
    explainers.set(e.misconception_id, e);
  }
  return { recaps, explainers, warnings };
}

/** The recap for a record, if one exists and was made from the record as it is now. */
export function recapFor(lib: Pick<LessonLibrary, "recaps">, record: ErrorRecord): MistakeRecap | undefined {
  const r = lib.recaps.get(record.id);
  return r && r.source_hash === recapSourceHash(record) ? r : undefined;
}
