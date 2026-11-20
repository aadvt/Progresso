/**
 * Validate the configured concept graph and print its stats.
 * Usage: pnpm graph:validate [--dir <graph dir>] [--json]
 */
import { relative } from "node:path";
import { formatIssue, GraphValidationError, loadAppConfig, loadConceptGraph } from "../index";

const args = process.argv.slice(2);
const config = loadAppConfig();
const dirFlag = args.indexOf("--dir");
const dir = dirFlag >= 0 && args[dirFlag + 1] ? args[dirFlag + 1]! : config.conceptGraphDir;

try {
  const { graph, warnings } = loadConceptGraph(dir);
  const stats = graph.stats();
  if (args.includes("--json")) {
    console.log(JSON.stringify(stats, null, 2));
  } else {
    console.log(`Concept graph OK: ${relative(config.repoRoot, dir) || dir}  (fingerprint ${stats.fingerprint})`);
    console.log("Checks passed: schema, unique ids, unit ids, prerequisite ids exist, no cycles\n");
    const rows = stats.subjects.map((s) => ({
      subject: s.subject,
      units: s.units,
      concepts: s.concepts,
      edges: s.prerequisiteEdges,
      misconceptions: s.misconceptions,
      roots: s.roots,
      leaves: s.leaves,
      "max depth": s.maxDepth,
      "by class": Object.entries(s.byClass)
        .map(([k, v]) => `${k}:${v}`)
        .join(" "),
    }));
    console.table(rows);
    console.log(
      `Totals: ${stats.totals.concepts} concepts, ${stats.totals.edges} prerequisite edges ` +
        `(${stats.totals.crossSubjectEdges} cross-subject), ${stats.totals.misconceptions} misconceptions`,
    );
    console.log(`Deepest chain (${stats.deepestChain.length - 1} edges):\n  ${stats.deepestChain.join("\n    -> ")}`);
    for (const subject of graph.subjects) {
      console.log(`\nRoots in ${subject}: ${graph.roots(subject).map((c) => c.id).join(", ")}`);
    }
  }
  if (warnings.length > 0) {
    console.log(`\n${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`  - ${formatIssue(w)}`);
  }
} catch (e) {
  if (e instanceof GraphValidationError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
