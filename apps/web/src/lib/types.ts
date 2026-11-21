/** Serializable shapes the server hands to client components. */
export interface StudentSummary {
  id: string;
  /** Local display only; never sent to an LLM. */
  name: string;
  is_sample: boolean;
  sample_notice: string;
  class: 11 | 12;
  subjects: string[];
  next_exam?: { name: string; date: string; days_left: number };
  exam_count: number;
  first_exam_date: string;
  last_exam_date: string;
}

/** One line of the add-report stream (NDJSON). */
export type ReportStreamEvent =
  | { type: "progress"; stage: string; message: string }
  | { type: "done"; notices: string[]; summary: string }
  | { type: "error"; message: string };
