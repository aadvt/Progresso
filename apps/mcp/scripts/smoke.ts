/**
 * Prints what each tool returns as text (what the model reads), on a throwaway
 * copy of the database so nothing in the demo DB changes.
 *
 *   pnpm --filter @progresso/mcp smoke [student]
 */
import { copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRepoRoot, loadAppConfig } from "@progresso/core";

const real = loadAppConfig(findRepoRoot()).databasePath;
const copy = join(tmpdir(), `progresso-mcp-smoke-${Date.now()}.db`);
if (existsSync(real)) copyFileSync(real, copy);
process.env.DATABASE_PATH = copy;

const student = process.argv[2] ?? "demo-riya";
const { resetPlan } = await import("@progresso/db");
const service = await import("@progresso/service");
const { tonight, submit, progress } = await import("../src/views");
const { explainMistake } = await import("../src/explain");
const { missionText, answerText, progressText, explainText } = await import("../src/text");

resetPlan(service.db(), student);
const m = tonight(student);
console.log("=== get_tonight_mission ===\n" + missionText(m));
const q = m.questions[0];
if (q && m.mission) {
  const bank = service.store().bank.byId.get(q.id)!;
  const wrong = bank.options?.find((o) => !o.correct && o.misconception_id)?.id ?? "0";
  console.log("\n=== submit_answer (a wrong option) ===\n" + answerText(submit(student, m.mission.id, q.id, wrong)));
  console.log("\n=== explain_my_mistake (question_id) ===\n" + explainText(explainMistake(student, "", q.id)));
}
console.log("\n=== get_progress ===\n" + progressText(progress(student)));
console.log(`\n(throwaway DB: ${copy})`);
