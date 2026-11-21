import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

/** Default migrations folder, next to this package. Bundlers can move this file, so callers may pass their own. */
export function migrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
}

export interface OpenDb {
  db: Db;
  sqlite: Database.Database;
  close(): void;
}

/** Open (creating if needed) the SQLite database. Use ":memory:" in tests. */
export function openDb(path: string): OpenDb {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  return { db, sqlite, close: () => sqlite.close() };
}

export function runMigrations(db: Db, migrationsFolder: string = migrationsDir()): void {
  migrate(db, { migrationsFolder });
}
