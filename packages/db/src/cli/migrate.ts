/** Apply SQL migrations and sync the concept graph. Usage: pnpm db:migrate */
import { relative } from "node:path";
import { loadAppConfig, loadConceptGraph } from "@progresso/core";
import { openDb, runMigrations } from "../client";
import { syncConceptGraph } from "../graph-sync";

const config = loadAppConfig();
const { db, close } = openDb(config.databasePath);
try {
  runMigrations(db);
  const { graph } = loadConceptGraph(config.conceptGraphDir);
  syncConceptGraph(db, graph);
  console.log(
    `Migrated ${relative(config.repoRoot, config.databasePath)} and synced concept graph ` +
      `${relative(config.repoRoot, config.conceptGraphDir)} (fingerprint ${graph.fingerprint}, ${graph.concepts.size} concepts).`,
  );
} finally {
  close();
}
