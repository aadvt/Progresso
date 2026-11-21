/**
 * DEMO PARSER — SAMPLE DATA ONLY. Deleted in Phase P with the rest of this module.
 *
 * Implements the ReportParser interface by returning the chosen demo student's
 * hand-written fixture records. It never reads the pasted text (there is no
 * parser yet) and says so in its notices, so sample data can't pass as a parse
 * of a real report.
 */
import { checkRecordAgainstGraph } from "../error-record/check-against-graph";
import {
  ReportParseError,
  type ParsedReport,
  type ParseOptions,
  type ParseStage,
  type ReportInput,
  type ReportParser,
} from "../report-parser";
import { SAMPLE_DATA_NOTICE, type DemoStudent } from "./index";

export interface DemoParserOptions {
  /** Pause between stages so the progress UI can be seen; 0 in tests. */
  stageDelayMs?: number;
}

export class DemoFixtureParser implements ReportParser {
  readonly name = "demo-fixture-parser";
  readonly version = "0.1.0";
  readonly mode = "demo" as const;

  constructor(
    private readonly students: readonly DemoStudent[],
    private readonly options: DemoParserOptions = {},
  ) {}

  async parse(input: ReportInput, { graph, onProgress, signal }: ParseOptions): Promise<ParsedReport> {
    const delay = this.options.stageDelayMs ?? 0;
    const step = async (stage: ParseStage, message: string) => {
      signal?.throwIfAborted();
      onProgress?.({ stage, message });
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    };

    const demo = this.students.find((s) => s.student.id === input.student_id);
    if (!demo) {
      throw new ReportParseError(`no demo fixture for student "${input.student_id}"`, "We couldn't find sample data for this student.");
    }

    const pasted = input.text?.trim() ?? "";
    await step("reading", pasted ? "Report received. Demo mode: loading this student's sample data instead" : "Loading this student's sample report");

    const examNames = new Set(demo.records.map((r) => r.exam.id));
    await step("extracting", `Found ${demo.records.length} diagnosed mistakes across ${examNames.size} exams`);

    const concepts = new Set(demo.records.flatMap((r) => r.concepts.map((c) => c.concept_id)));
    await step("mapping", `Linked them to ${concepts.size} topics in the syllabus map`);

    const errors = demo.records.flatMap((r) => checkRecordAgainstGraph(r, graph)).filter((i) => i.severity === "error");
    if (errors.length > 0) {
      throw new ReportParseError(
        `fixture ${demo.file} does not match the concept graph: ${errors.map((e) => `${e.record_id}: ${e.message}`).join("; ")}`,
        "This sample report doesn't match the current syllabus map.",
      );
    }
    await step("validating", "Every mistake checked against the syllabus map");

    const notices = [SAMPLE_DATA_NOTICE];
    if (pasted) {
      notices.push(
        "The report parser isn't built yet, so the text you added was not read. You're seeing this student's sample data.",
      );
    }
    return {
      student_id: demo.student.id,
      exams: demo.exams,
      records: demo.records,
      source: { kind: "demo_fixture", notice: SAMPLE_DATA_NOTICE, fixture_file: `data/fixtures/demo/${demo.file}` },
      notices,
      parser: { name: this.name, version: this.version, mode: this.mode },
    };
  }
}
