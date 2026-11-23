/**
 * Deterministic checks on generated lesson content, run before anything else
 * (and again in tests on every file that lands). The important one: a recap
 * of the student's own working may only cut the report's quote into lines;
 * the lines must join back into the quote exactly.
 */
import type { ErrorRecord } from "../error-record/schema";
import type { ConceptGraph } from "../graph/graph";
import type { MistakeRecap, StepExplainer } from "./schema";

/** Whitespace-insensitive form used to compare a recap's lines with the quote. */
export function squash(s: string): string {
  return s.replace(/\s+/g, "");
}

/** Hash of everything in a record a recap is made from. A recap whose hash differs is stale. */
export function recapSourceHash(record: ErrorRecord): string {
  const src = JSON.stringify([
    record.question.ref,
    record.question.text ?? null,
    record.diagnosis.text,
    record.diagnosis.correct_approach ?? null,
    record.student_working ?? null,
    record.misconception?.misconception_id ?? null,
    record.error_type,
  ]);
  let h = 2166136261;
  for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** The recap mode a record calls for: its own working when the report quotes it, else a labelled typical step. */
export function recapModeFor(record: ErrorRecord): MistakeRecap["mode"] {
  return record.student_working ? "student_working" : "typical_step";
}

const BARE_TEX = /\\[a-zA-Z]+|[\^_]\{/;

/** LaTeX commands outside $…$ would show as raw source. */
export function hasBareTex(text: string): boolean {
  const outside = text
    .split(/(?<!\\)\$/)
    .filter((_, i) => i % 2 === 0)
    .join(" ");
  return BARE_TEX.test(outside);
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Control characters (a tab, a carriage return…) in display text: usually a LaTeX command mangled by JSON escaping. */
export function hasControlChars(text: string): boolean {
  return CONTROL.test(text);
}

/**
 * Undo JSON-escape damage to LaTeX: a model that writes "\text" or
 * "\rightarrow" unescaped in JSON yields a TAB + "ext" or a CR + "ightarrow".
 * Display text never needs these characters, so turning them back into the
 * backslash command is safe. "\n" is only restored before a letter (\neq, \nu).
 */
export function repairLatexEscapes(text: string): string {
  return text
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r")
    .replace(/\f/g, "\\f")
    .replaceAll("\u0008", "\\b")
    .replaceAll("\u000b", "\\v")
    .replace(/\n(?=[a-z])/g, "\\n");
}

/** A line written as bare LaTeX (no $ at all) is wrapped in $…$; anything else is left alone. */
export function wrapBareTex(text: string): string {
  return !text.includes("$") && BARE_TEX.test(text) ? `$${text}$` : text;
}

type RecapShape = Pick<MistakeRecap, "mode" | "wrong" | "fix" | "record_id" | "misconception_id"> & Partial<Pick<MistakeRecap, "key_idea">>;

/** Structural problems with a recap for this record (empty = fine). */
export function checkRecapStructure(recap: RecapShape, record: ErrorRecord): string[] {
  const reasons: string[] = [];
  if (recap.record_id !== record.id) reasons.push(`recap is for ${recap.record_id}, not ${record.id}`);
  const want = recapModeFor(record);
  if (recap.mode !== want) reasons.push(`mode must be ${want} for this record (the report ${record.student_working ? "quotes" : "does not quote"} the working)`);
  if ((recap.misconception_id ?? null) !== (record.misconception?.misconception_id ?? null)) reasons.push("misconception differs from the record's");
  const lines = recap.wrong.lines;
  if (!lines.some((l) => l.wrong)) reasons.push("no line is marked as the wrong step");
  if (recap.mode === "student_working" && record.student_working) {
    const quote = record.student_working.text;
    const format = record.student_working.format === "latex" ? "latex" : "plain";
    if (recap.wrong.format !== format) reasons.push(`working must be shown in the report's format (${format})`);
    const joined = squash(lines.map((l) => l.text).join(""));
    if (joined !== squash(quote)) reasons.push(`the lines do not reproduce the quoted working exactly: got "${lines.map((l) => l.text).join(" | ")}", quote "${quote}"`);
    // Each line must be the next slice of the quote, in order.
    let rest = squash(quote);
    for (const l of lines) {
      const s = squash(l.text);
      if (!rest.startsWith(s)) {
        reasons.push(`line "${l.text}" is not the next part of the quote`);
        break;
      }
      rest = rest.slice(s.length);
    }
    for (const l of lines) {
      if (l.wrong && !l.mark) reasons.push(`wrong line "${l.text}" has no marked part`);
      if (l.mark && !l.text.includes(l.mark)) reasons.push(`mark "${l.mark}" does not occur in its line "${l.text}"`);
      if (l.mark && !l.wrong) reasons.push(`line "${l.text}" has a mark but is not wrong`);
    }
  } else {
    if (recap.wrong.format !== "latex") reasons.push("a typical step is written in LaTeX, never in handwriting");
    for (const l of lines) if (l.mark) reasons.push("typical steps carry no handwriting mark");
  }
  if (recap.fix.lines.length === 0) reasons.push("no corrected steps");
  const texts = [...recap.fix.lines.flatMap((l) => [l.text, l.note ?? ""]), recap.wrong.note, ...(recap.wrong.format === "latex" ? lines.map((l) => l.text) : [])];
  for (const t of texts) if (hasBareTex(t)) reasons.push(`LaTeX outside $…$ in "${t}"`);
  for (const t of [...texts, ...lines.map((l) => l.text), recap.key_idea ?? ""]) if (hasControlChars(t)) reasons.push(`control character in "${JSON.stringify(t)}"`);
  return reasons;
}

/** Structural problems with an explainer (empty = fine). */
export function checkExplainerStructure(e: Pick<StepExplainer, "misconception_id" | "concept_id" | "steps"> & Partial<Pick<StepExplainer, "title" | "takeaway">>, graph: ConceptGraph): string[] {
  const reasons: string[] = [];
  const m = graph.misconceptions.get(e.misconception_id);
  if (!m) reasons.push(`unknown misconception ${e.misconception_id}`);
  else if (m.concept_id !== e.concept_id) reasons.push(`misconception belongs to ${m.concept_id}, not ${e.concept_id}`);
  if (e.steps[0]?.kind !== "wrong") reasons.push("must start from the typical wrong step");
  if (e.steps.filter((s) => s.kind === "wrong").length > 1) reasons.push("only one wrong step");
  if (!e.steps.some((s) => s.kind === "rule" || s.kind === "idea")) reasons.push("never states the correct idea");
  if (e.steps.length < 4) reasons.push("too short to build intuition");
  for (const s of e.steps) if (hasBareTex(s.say)) reasons.push(`LaTeX outside $…$ in "${s.say}"`);
  for (const t of [...e.steps.flatMap((s) => [s.say, s.math ?? ""]), e.title ?? "", e.takeaway ?? ""]) if (hasControlChars(t)) reasons.push(`control character in ${JSON.stringify(t)}`);
  return reasons;
}
