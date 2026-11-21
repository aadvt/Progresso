/**
 * Report parser interface: turns one Inferentics AI report into error records.
 *
 * The real parser is built in Phase P. Until then the only implementation is
 * the demo parser in @progresso/core/demo-fixtures, which returns a demo
 * student's SAMPLE DATA records. Everything downstream (UI, engine, MCP)
 * depends on this interface, never on a particular implementation.
 */
import type { ConceptGraph } from "../graph/graph";
import type { ErrorRecord } from "../error-record/schema";
import type { Exam } from "../student";

export interface ReportInput {
  student_id: string;
  /** The report text the student pasted or uploaded. */
  text?: string;
  /** Original file name, if the text came from an upload. */
  file_name?: string;
}

/** Parse stages, in order. A parser reports each one as it starts it. */
export const PARSE_STAGES = ["reading", "extracting", "mapping", "validating"] as const;
export type ParseStage = (typeof PARSE_STAGES)[number];

export interface ParseProgress {
  stage: ParseStage;
  /** Short, student-readable line about what was found, e.g. "Found 11 diagnosed mistakes". */
  message: string;
}

export type ReportSource =
  /** The report's own text (Phase P). Shown back to the student for trust. */
  | { kind: "report_text"; text: string; file_name?: string }
  /** SAMPLE DATA: no report text exists; records were hand-written. */
  | { kind: "demo_fixture"; notice: string; fixture_file: string };

export interface ParsedReport {
  student_id: string;
  exams: Exam[];
  records: ErrorRecord[];
  source: ReportSource;
  /**
   * Things the student should know about this parse, e.g. that pasted text
   * was not read because the parser runs in demo mode.
   */
  notices: string[];
  parser: { name: string; version: string; mode: "demo" | "live" };
}

export interface ParseOptions {
  graph: ConceptGraph;
  onProgress?: (p: ParseProgress) => void;
  signal?: AbortSignal;
}

export interface ReportParser {
  readonly name: string;
  readonly version: string;
  /** "demo" parsers return sample data and ignore the input text. */
  readonly mode: "demo" | "live";
  parse(input: ReportInput, options: ParseOptions): Promise<ParsedReport>;
}

export class ReportParseError extends Error {
  override name = "ReportParseError";
  constructor(
    message: string,
    /** Safe to show the student. */
    readonly userMessage: string = message,
  ) {
    super(message);
  }
}
