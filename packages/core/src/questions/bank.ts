/**
 * Loading the question bank from disk (server-side). One JSON file per
 * misconception: data/question-bank/<subject>/<misconception_id>.json.
 * Questions for concepts or misconceptions the current graph doesn't have are
 * skipped with a warning, so a graph swap never breaks the app.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ConceptGraph } from "../graph/graph";
import { BankFileSchema, type ProveItQuestion } from "./schema";
import { makeBank, type QuestionBank } from "./select";

export interface LoadedBank extends QuestionBank {
  files: number;
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

export function loadQuestionBank(dir: string, graph?: ConceptGraph): LoadedBank {
  const questions: ProveItQuestion[] = [];
  const warnings: string[] = [];
  const files = walk(dir);
  const seen = new Set<string>();
  for (const file of files) {
    const parsed = BankFileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (!parsed.success) {
      warnings.push(`${file}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      continue;
    }
    for (const q of parsed.data.questions) {
      if (seen.has(q.id)) {
        warnings.push(`${file}: duplicate question id ${q.id}`);
        continue;
      }
      if (graph && (!graph.has(q.concept_id) || !graph.misconceptions.has(q.target_misconception_id))) {
        warnings.push(`${q.id}: concept or misconception not in the current graph; skipped`);
        continue;
      }
      seen.add(q.id);
      questions.push(q);
    }
  }
  return { ...makeBank(questions), files: files.length, warnings };
}
