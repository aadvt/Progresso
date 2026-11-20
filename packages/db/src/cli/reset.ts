/** Delete the local database file(s). Run `pnpm db:seed` afterwards. Usage: pnpm db:reset */
import { existsSync, rmSync } from "node:fs";
import { relative } from "node:path";
import { loadAppConfig } from "@progresso/core";

const config = loadAppConfig();
for (const suffix of ["", "-wal", "-shm"]) {
  const path = `${config.databasePath}${suffix}`;
  if (existsSync(path)) {
    rmSync(path);
    console.log(`Deleted ${relative(config.repoRoot, path)}`);
  }
}
