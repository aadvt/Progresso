/**
 * Text with $…$ maths → safe HTML for the widgets. Maths is rendered on the
 * server with KaTeX to MathML only: every current browser draws MathML
 * natively, so the widget ships no KaTeX script, stylesheet or fonts.
 *
 * Content comes from verified files (question bank, lessons) and the report;
 * plain text is HTML-escaped, KaTeX escapes its own output and `trust` is off.
 */
import katex from "katex";
import { prettyWorking } from "@progresso/core";
import type { Rich } from "./shared/types";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Split on unescaped $…$ (a literal dollar is written \$). Same rule as the web app's MathText. */
export function splitMath(text: string): { text: string; math: boolean }[] {
  const out: { text: string; math: boolean }[] = [];
  let buf = "";
  let math = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\\" && text[i + 1] === "$") {
      buf += math ? "\\$" : "$";
      i++;
      continue;
    }
    if (ch === "$") {
      if (buf) out.push({ text: buf, math });
      buf = "";
      math = !math;
      continue;
    }
    buf += ch;
  }
  if (buf) out.push({ text: math ? `$${buf}` : buf, math: false });
  return out;
}

/** Operator names (sin, tan, log…): browsers' native MathML adds no space before them ("6xtan"), KaTeX's CSS normally does. */
const OPERATOR_NAME = /<mi>(sin|cos|tan|sec|csc|cot|sinh|cosh|tanh|arcsin|arccos|arctan|log|ln|exp|lim|max|min|det)<\/mi>/g;

export function tex(src: string, display = false): string {
  return katex
    .renderToString(src, { output: "mathml", displayMode: display, throwOnError: false, strict: "ignore", trust: false })
    .replace(OPERATOR_NAME, '<mspace width="0.1667em"></mspace><mi>$1</mi>');
}

export function mathHtml(text: string): string {
  return splitMath(text)
    .map((p) => (p.math ? tex(p.text) : escapeHtml(p.text)))
    .join("");
}

export function rich(text: string): Rich {
  return { text, html: mathHtml(text) };
}

/** A line of a student's working as quoted by the report: plain text, made readable (x^2 → x²), never re-worded. */
export function workingHtml(text: string, format: "plain" | "latex"): string {
  return format === "plain" ? escapeHtml(prettyWorking(text)) : mathHtml(text);
}
