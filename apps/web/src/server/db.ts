/**
 * The web app's SQLite handle. Opened once per server process, migrated, and
 * (until Phase P) seeded with the demo students when they are missing, so the
 * app works on a fresh clone without running `pnpm db:seed` first.
 */
import { join } from "node:path";
import type { ConceptGraph } from "@progresso/core";
import type { DemoStudent } from "@progresso/core/demo-fixtures";
import { ensureDemoData, openDb, runMigrations, type Db } from "@progresso/db";

let handle: Db | undefined;

export function getDb(opts: { repoRoot: string; databasePath: string; graph: ConceptGraph; demo: DemoStudent[] }): Db {
  if (handle) return handle;
  const { db } = openDb(opts.databasePath);
  // The bundler moves @progresso/db's files, so point at its migrations explicitly.
  runMigrations(db, join(/*turbopackIgnore: true*/ opts.repoRoot, "packages", "db", "drizzle"));
  ensureDemoData(db, opts.demo, opts.graph);
  handle = db;
  return db;
}
