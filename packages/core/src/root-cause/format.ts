import { marksPhrase } from "./explain";
import type { MarksValue, RootCauseAnalysis } from "./types";

/** Human-readable plain-text rendering of an analysis (used by the CLI and in reports). */
export function formatAnalysis(a: RootCauseAnalysis, options: { title?: string } = {}): string {
  const out: string[] = [];
  const m = (v: MarksValue): string => `${v.value}${v.estimated ? "*" : ""}`;
  const pct = (x: number): string => `${Math.round(x * 100)}%`;

  if (options.title) out.push(options.title, "=".repeat(options.title.length));
  out.push(`Student ${a.student_id ?? "?"} | ${a.exams.length} exam(s): ${a.exams.map((e) => `${e.name} (${e.subject}, ${e.date})`).join("; ")}`);
  out.push("", `>> ${a.headline}`, "");
  const s = a.summary;
  out.push(
    `${s.total_errors} errors: ${s.explained_by_roots} explained by roots, ${s.standalone} stand alone, ${s.habit_errors} slips/habits. ` +
      `Marks lost: ${s.marks_lost_total} total, ${s.marks_explained_by_roots} on root-explained errors${s.marks_include_estimates ? " (* = estimated, record gave no marks)" : ""}.`,
  );

  out.push("", `ROOT GAPS (${a.roots.length}), ranked by marks recoverable per study hour`);
  if (a.roots.length === 0) out.push("  none: no shared knowledge gap explains these errors");
  for (const r of a.roots) {
    out.push(
      "",
      `#${r.rank} ${r.concept.name} [${r.concept.id}], Class ${r.concept.class}, ${r.concept.subject}`,
      `   confidence ${pct(r.confidence)} (${r.confidence_label}) | explains ${r.explains.length} errors across ${r.exam_ids.length} exam(s)`,
      `   marks: ${r.marks.lost} lost${r.marks.estimated_part ? ` (${r.marks.estimated_part} estimated)` : ""}, ` +
        `${r.marks.board_marks_dependent} board marks build on it, ${r.marks.recoverable} recoverable`,
      `   coverage: mistakes in ${r.coverage.branches_with_errors} of the ${r.coverage.branches} examined topics built directly on it${r.coverage.root_itself ? ", and in the topic itself" : ""}`,
      `   study: ~${r.study_hours} h (${r.missions} missions) | priority ${r.priority} marks/hour`,
      `   why: ${r.explanation}${r.explanation_source === "llm" ? "  [worded by LLM]" : ""}`,
      `   evidence:`,
    );
    for (const e of r.explains) {
      const chain =
        e.tested_path?.map((p) => p.name).join(" → ") ??
        `${e.path.map((p) => p.name).join(" → ")}${e.tested ? ` (in a question on ${e.tested.name})` : ""}`;
      const evidence = e.via === "misconception" ? "misconception named in report" : `${e.via} mapping${e.hops ? `, ${e.hops} step(s) back` : ""}`;
      out.push(`     - ${e.exam_name} ${e.question_ref} (${e.error_type}, ${m(e.marks_lost)} lost): ${chain}  [${evidence}, link ${e.link_strength}]`);
    }
    for (const mc of r.misconceptions) out.push(`   repeated misconception x${mc.count}: ${mc.description}`);
    for (const ev of r.evidence_against) {
      out.push(`   counter-evidence: ${ev.source} on ${ev.concept_id} (${ev.detail}), strength ${ev.strength} at the root`);
    }
    for (const alt of r.close_alternatives) {
      out.push(`   close call: ${alt.concept.name} [${alt.concept.id}] would fit ${pct(alt.relative_fit)} as well`);
    }
  }

  out.push("", `STANDALONE ERRORS (${a.standalone.length}): fix one at a time`);
  for (const e of a.standalone) {
    out.push(
      `  - ${e.exam_name} ${e.question_ref} (${e.error_type}, ${m(e.marks_lost)} lost) ${e.concept ? `${e.concept.name} [${e.concept.id}]` : "[unmapped]"}: ${e.explanation}`,
    );
  }

  out.push("", `HABITS AND SLIPS (${a.habits.length} pattern(s))`);
  for (const h of a.habits) {
    out.push(`  * ${h.label}: ${h.records.length}x, ${marksPhrase(h.marks_lost, h.estimated_part > 0)} lost. Tip: ${h.tip}`);
    for (const r of h.records) out.push(`      ${r.exam_name} ${r.question_ref} (${r.error_type}, ${m(r.marks_lost)} lost)${r.concept_id ? ` ${r.concept_id}` : ""}`);
  }
  if (a.warnings.length > 0) {
    out.push("", `WARNINGS (${a.warnings.length})`);
    for (const w of a.warnings) out.push(`  ! ${w}`);
  }
  return out.join("\n");
}
