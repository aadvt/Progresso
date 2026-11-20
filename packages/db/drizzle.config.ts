import { defineConfig } from "drizzle-kit";

// Used only by `pnpm db:generate` to write SQL migrations from src/schema.ts.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
