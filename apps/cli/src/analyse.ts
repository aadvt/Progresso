/**
 * Print the root-cause analysis for a student.
 *
 *   pnpm analyse <student-id>      one student
 *   pnpm analyse --all             every student
 *   --json                         machine-readable output
 *   --llm                          re-word the explanations with the LLM layer (task "explain", cached)
 *
 * Until Phase P, students come from the demo fixtures (SAMPLE DATA).
 */
import { analyseStudent, findRepoRoot, formatAnalysis, loadAppConfig, loadConceptGraph, wordExplanations } from "@progresso/core";
import { loadDemoFixtures, SAMPLE_DATA_NOTICE } from "@progresso/core/demo-fixtures";
import { createLlmClient } from "@progresso/llm";

const args = process.argv.slice(2);
const repoRoot = findRepoRoot();
const config = loadAppConfig(repoRoot);
const { graph } = loadConceptGraph(config.conceptGraphDir);
const students = loadDemoFixtures(config.fixturesDir);
const wanted = args.find((a) => !a.startsWith("--"));
const chosen = args.includes("--all") ? students : students.filter((s) => s.student.id === wanted);
if (chosen.length === 0) {
  console.error(`Usage: pnpm analyse <student-id> | --all [--json] [--llm]\nStudents: ${students.map((s) => s.student.id).join(", ")}`);
  process.exit(1);
}

// Display names stay local: the PII guard refuses any prompt that contains one.
const llm = args.includes("--llm")
  ? createLlmClient({ repoRoot, piiGuard: { blockedTerms: students.map((s) => s.student.display_name.replace(/\s*\(sample\)$/i, "")) } })
  : undefined;

for (const s of chosen) {
  const t0 = performance.now();
  let analysis = analyseStudent({ graph, records: s.records });
  const ms = performance.now() - t0;
  let note = `engine ${ms.toFixed(1)} ms`;
  if (llm && analysis.roots.length === 0) note += " | no roots, nothing for the LLM to word";
  else if (llm) {
    const worded = await wordExplanations(analysis, llm);
    analysis = worded.analysis;
    note += worded.error ? ` | LLM wording failed, using templates: ${worded.error}` : ` | explanations worded by LLM${worded.cached ? " (from cache)" : ""}`;
  }
  if (args.includes("--json")) console.log(JSON.stringify(analysis, null, 2));
  else console.log(`${formatAnalysis(analysis, { title: `${s.student.display_name}  [${SAMPLE_DATA_NOTICE}]` })}\n(${note})\n`);
}
