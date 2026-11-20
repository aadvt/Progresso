/**
 * Load the DEMO FIXTURES (SAMPLE DATA) into the database and print a summary
 * per student, read back from the DB. Usage: pnpm db:seed
 */
import { relative } from "node:path";
import { loadAppConfig, loadConceptGraph } from "@progresso/core";
import { loadDemoFixtures, SAMPLE_DATA_NOTICE } from "@progresso/core/demo-fixtures";
import { openDb, runMigrations } from "../client";
import { syncConceptGraph } from "../graph-sync";
import { seedDemoStudents } from "../seed";
import { summariseStudents } from "../summary";

const config = loadAppConfig();
const { graph } = loadConceptGraph(config.conceptGraphDir);
const demo = loadDemoFixtures(config.fixturesDir);

const { db, close } = openDb(config.databasePath);
try {
  runMigrations(db);
  syncConceptGraph(db, graph);
  seedDemoStudents(db, demo, graph);

  console.log(`Seeded ${demo.length} demo students into ${relative(config.repoRoot, config.databasePath)}`);
  console.log(`*** ${SAMPLE_DATA_NOTICE} ***\n`);
  for (const s of summariseStudents(db)) {
    const story = demo.find((d) => d.student.id === s.id)?.story;
    console.log(`${s.isSample ? "[SAMPLE] " : ""}${s.displayName}  (id ${s.id}, Class ${s.class})`);
    if (story) console.log(`  Story: ${story}`);
    if (s.nextExam) console.log(`  Next exam: ${s.nextExam}`);
    console.log(`  Exams: ${s.exams.map((e) => `${e.name} / ${e.subject} ${e.date} [${e.records}]`).join("; ")}`);
    console.log(
      `  Error records: ${s.records} | by type: ${Object.entries(s.byErrorType)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ")}`,
    );
    console.log(
      `  Marks lost (where reported): ${s.marksLostKnown} across ${s.recordsWithMarks}/${s.records} records | ` +
        `with student working: ${s.recordsWithWorking} | unmapped: ${s.unmapped}`,
    );
    console.log(`  Most-mapped concepts (any role): ${s.topConcepts.map((c) => `${c.conceptId} (${c.records})`).join(", ")}\n`);
  }
} finally {
  close();
}
