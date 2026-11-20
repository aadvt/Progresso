import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { loadAppConfig, loadConceptGraph } from "@progresso/core";
import { loadDemoFixtures } from "@progresso/core/demo-fixtures";
import { openDb, runMigrations, schema, seedDemoStudents, summariseStudents, syncConceptGraph } from "../src";

const config = loadAppConfig();
const { graph } = loadConceptGraph(config.conceptGraphDir);
const demo = loadDemoFixtures(config.fixturesDir);

function freshDb() {
  const handle = openDb(":memory:");
  runMigrations(handle.db);
  syncConceptGraph(handle.db, graph);
  return handle;
}

describe("database", () => {
  it("syncs the concept graph", () => {
    const { db, close } = freshDb();
    expect(db.select().from(schema.concepts).all()).toHaveLength(graph.concepts.size);
    expect(db.select().from(schema.conceptPrerequisites).all()).toHaveLength(graph.stats().totals.edges);
    expect(db.select().from(schema.misconceptions).all()).toHaveLength(graph.misconceptions.size);
    close();
  });

  it("seeds the fixtures and reads them back losslessly", () => {
    const { db, close } = freshDb();
    seedDemoStudents(db, demo, graph);
    const totalRecords = demo.reduce((n, s) => n + s.records.length, 0);
    expect(db.select().from(schema.students).all()).toHaveLength(demo.length);
    expect(db.select().from(schema.errorRecords).all()).toHaveLength(totalRecords);

    const original = demo[0]!.records[0]!;
    const row = db.select().from(schema.errorRecords).where(eq(schema.errorRecords.id, original.id)).get()!;
    expect(row.record).toEqual(original);
    expect(row.diagnosisText).toBe(original.diagnosis.text);
    close();
  });

  it("re-seeding replaces sample students without duplicates", () => {
    const { db, close } = freshDb();
    seedDemoStudents(db, demo, graph);
    seedDemoStudents(db, demo, graph);
    const summary = summariseStudents(db);
    expect(summary).toHaveLength(demo.length);
    expect(summary.every((s) => s.isSample)).toBe(true);
    expect(summary.reduce((n, s) => n + s.records, 0)).toBe(demo.reduce((n, s) => n + s.records.length, 0));
    close();
  });

  it("keeps concept mappings when the graph is re-synced (soft references)", () => {
    const { db, close } = freshDb();
    seedDemoStudents(db, demo, graph);
    const before = db.select().from(schema.errorRecordConcepts).all().length;
    syncConceptGraph(db, graph);
    expect(db.select().from(schema.errorRecordConcepts).all()).toHaveLength(before);
    close();
  });

  it("enforces foreign keys", () => {
    const { db, close } = freshDb();
    expect(() =>
      db.insert(schema.exams).values({ id: "e", studentId: "missing", name: "n", subject: "s", date: "2026-01-01" }).run(),
    ).toThrow(/FOREIGN KEY/);
    close();
  });
});
