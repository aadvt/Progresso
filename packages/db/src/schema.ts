/**
 * SQLite schema (Drizzle). Source-of-truth rules:
 *  - Error records are stored with their ORIGINAL wording plus the full validated
 *    record JSON, so they can be re-mapped when the concept graph changes.
 *  - Concept tables are a cache of the graph files (data/concept-graph*), tagged
 *    with the graph fingerprint. Concept mappings are soft references (no FK to
 *    concepts) so a graph swap never deletes or blocks student data.
 *  - Students are pseudonymous; display_name is local-only and never sent to an LLM.
 */
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamp = (name: string) =>
  text(name)
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);

// ---------------------------------------------------------------- students & exams

export const students = sqliteTable("students", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  class: integer("class").notNull(),
  subjects: text("subjects", { mode: "json" }).$type<string[]>().notNull(),
  nextExamName: text("next_exam_name"),
  nextExamDate: text("next_exam_date"),
  /** True for demo fixtures (SAMPLE DATA). Deleted in Phase P. */
  isSample: integer("is_sample", { mode: "boolean" }).notNull().default(false),
  createdAt: timestamp("created_at"),
});

export const exams = sqliteTable(
  "exams",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    subject: text("subject").notNull(),
    date: text("date").notNull(),
    maxMarks: real("max_marks"),
  },
  (t) => [index("exams_student_idx").on(t.studentId, t.date)],
);

/** One row per ingested Inferentics report (Phase P). Raw files live in data/reports/, never in git. */
export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  studentId: text("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  examId: text("exam_id").references(() => exams.id, { onDelete: "set null" }),
  /** Path relative to data/reports/. */
  sourcePath: text("source_path").notNull(),
  sha256: text("sha256").notNull(),
  receivedAt: text("received_at").notNull(),
  parserName: text("parser_name"),
  parserVersion: text("parser_version"),
  status: text("status", { enum: ["received", "parsed", "failed"] }).notNull(),
  createdAt: timestamp("created_at"),
});

// ---------------------------------------------------------------- error records

export const errorRecords = sqliteTable(
  "error_records",
  {
    id: text("id").primaryKey(),
    schemaVersion: text("schema_version").notNull(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    reportId: text("report_id").references(() => reports.id, { onDelete: "set null" }),
    questionRef: text("question_ref").notNull(),
    /** Verbatim report wording. Never rewritten; re-mapping reads this. */
    diagnosisText: text("diagnosis_text").notNull(),
    errorType: text("error_type").notNull(),
    errorTypeOriginal: text("error_type_original"),
    studentWorking: text("student_working"),
    marksLost: real("marks_lost"),
    marksMax: real("marks_max"),
    misconceptionId: text("misconception_id"),
    provenanceKind: text("provenance_kind", { enum: ["report", "demo_fixture"] }).notNull(),
    /** The full validated ErrorRecord JSON (the contract), for lossless round-trips. */
    record: text("record", { mode: "json" }).notNull(),
    createdAt: timestamp("created_at"),
  },
  (t) => [index("error_records_student_idx").on(t.studentId), index("error_records_exam_idx").on(t.examId)],
);

/** Record -> concept mappings. Soft reference to concepts; tagged with the graph version used. */
export const errorRecordConcepts = sqliteTable(
  "error_record_concepts",
  {
    errorRecordId: text("error_record_id")
      .notNull()
      .references(() => errorRecords.id, { onDelete: "cascade" }),
    conceptId: text("concept_id").notNull(),
    confidence: real("confidence").notNull(),
    role: text("role", { enum: ["primary", "secondary"] }).notNull(),
    mappedBy: text("mapped_by").notNull(),
    graphFingerprint: text("graph_fingerprint"),
  },
  (t) => [primaryKey({ columns: [t.errorRecordId, t.conceptId] }), index("erc_concept_idx").on(t.conceptId)],
);

// ---------------------------------------------------------------- concept graph (cache of the graph files)

export const graphVersions = sqliteTable("graph_versions", {
  fingerprint: text("fingerprint").primaryKey(),
  sourceDir: text("source_dir").notNull(),
  stats: text("stats", { mode: "json" }).notNull(),
  loadedAt: timestamp("loaded_at"),
});

export const units = sqliteTable("units", {
  id: text("id").primaryKey(),
  subject: text("subject").notNull(),
  name: text("name").notNull(),
  class: integer("class").notNull(),
  /** Approximate in the provisional graph. */
  boardMarks: real("board_marks").notNull(),
});

export const concepts = sqliteTable(
  "concepts",
  {
    id: text("id").primaryKey(),
    subject: text("subject").notNull(),
    name: text("name").notNull(),
    class: integer("class").notNull(),
    unitId: text("unit_id")
      .notNull()
      .references(() => units.id),
    chapter: text("chapter").notNull(),
    aliases: text("aliases", { mode: "json" }).$type<string[]>().notNull(),
    graphFingerprint: text("graph_fingerprint").notNull(),
  },
  (t) => [index("concepts_subject_idx").on(t.subject)],
);

export const conceptPrerequisites = sqliteTable(
  "concept_prerequisites",
  {
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    prerequisiteId: text("prerequisite_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.conceptId, t.prerequisiteId] }), index("prereq_reverse_idx").on(t.prerequisiteId)],
);

export const misconceptions = sqliteTable("misconceptions", {
  id: text("id").primaryKey(),
  conceptId: text("concept_id")
    .notNull()
    .references(() => concepts.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
});

// ---------------------------------------------------------------- foreseen: root-cause, missions, mastery (Phases 2 & 5)
// Deliberately minimal; later phases extend these with migrations.

/** Output of the root-cause engine (Phase 2): a ranked diagnosis snapshot per student. */
export const diagnoses = sqliteTable(
  "diagnoses",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    graphFingerprint: text("graph_fingerprint").notNull(),
    engineVersion: text("engine_version").notNull(),
    /** Ranked root gaps with explained records and marks recoverable. Shape owned by Phase 2. */
    result: text("result", { mode: "json" }).notNull(),
    createdAt: timestamp("created_at"),
  },
  (t) => [index("diagnoses_student_idx").on(t.studentId)],
);

/** Per student x concept mastery state, including FSRS scheduling fields (Phase 5). */
export const conceptMastery = sqliteTable(
  "concept_mastery",
  {
    studentId: text("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    conceptId: text("concept_id").notNull(),
    state: text("state", { enum: ["gap", "learning", "proven", "retained"] }).notNull(),
    /** FSRS memory state. Null until the first review. */
    stability: real("stability"),
    difficulty: real("difficulty"),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    lastReviewAt: text("last_review_at"),
    dueAt: text("due_at"),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.conceptId] }), index("mastery_due_idx").on(t.studentId, t.dueAt)],
);

/** A daily ~25-minute mission (Phase 5). */
export const missions = sqliteTable(
  "missions",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    scheduledFor: text("scheduled_for").notNull(),
    targetConceptId: text("target_concept_id"),
    status: text("status", { enum: ["planned", "in_progress", "completed", "skipped"] }).notNull(),
    plannedMinutes: integer("planned_minutes").notNull().default(25),
    plan: text("plan", { mode: "json" }),
    completedAt: text("completed_at"),
    createdAt: timestamp("created_at"),
  },
  (t) => [uniqueIndex("missions_student_day_idx").on(t.studentId, t.scheduledFor)],
);

/** Every attempt/review, the raw history FSRS and the readiness meter are computed from. */
export const reviewLog = sqliteTable(
  "review_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    conceptId: text("concept_id").notNull(),
    missionId: text("mission_id").references(() => missions.id, { onDelete: "set null" }),
    /** FSRS rating 1-4 (again/hard/good/easy). */
    rating: integer("rating").notNull(),
    correct: integer("correct", { mode: "boolean" }).notNull(),
    detail: text("detail", { mode: "json" }),
    reviewedAt: text("reviewed_at").notNull(),
  },
  (t) => [index("review_log_student_concept_idx").on(t.studentId, t.conceptId, t.reviewedAt)],
);
