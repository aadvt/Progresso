import katex from "katex";
import { Fragment } from "react";

/**
 * Text with $…$ inline maths, rendered with KaTeX (server or client).
 * KaTeX output is MathML plus styled HTML, so screen readers get the maths.
 * Content comes from the verified question bank, never from user input;
 * KaTeX escapes its own output and `trust` stays off.
 */
export function MathText({ text, className, display }: { text: string; className?: string; display?: boolean }) {
  // display: maths in display style (full-size fractions), for worked steps on the board.
  const parts = split(text).map((p) => (p.math && display ? { ...p, text: `\\displaystyle ${p.text}` } : p));
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.math ? (
          <span key={i} dangerouslySetInnerHTML={{ __html: render(p.text) }} />
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </span>
  );
}

/** One display formula (LaTeX without $), for explainer boards. */
export function Tex({ tex, className }: { tex: string; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: katex.renderToString(tex, { displayMode: true, throwOnError: false, output: "htmlAndMathml", strict: "ignore", trust: false }) }} />;
}

function render(tex: string): string {
  return katex.renderToString(tex, { throwOnError: false, output: "htmlAndMathml", strict: "ignore", trust: false });
}

/** Split on unescaped $…$ (a literal dollar is written \$). */
export function split(text: string): { text: string; math: boolean }[] {
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

/**
 * A plain-text reading of text with $…$ maths, for accessible names (an input's
 * aria-label can't hold MathML). Common TeX is turned into words or symbols.
 */
export function plainMath(text: string): string {
  return split(text)
    .map((p) => (p.math ? speakTex(p.text) : p.text))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function speakTex(tex: string): string {
  let s = tex;
  // Innermost first, so nested fractions and roots unwind.
  for (let i = 0; i < 5; i++) {
    s = s
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)")
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, "square root of ($1)")
      .replace(/\^\{([^{}]*)\}/g, "^($1)")
      .replace(/_\{([^{}]*)\}/g, "_($1)");
  }
  return s
    .replace(/\\(cdot|times)\b/g, "×")
    .replace(/\\pm\b/g, "±")
    .replace(/\\(leq|le)\b/g, "≤")
    .replace(/\\(geq|ge)\b/g, "≥")
    .replace(/\\(neq|ne)\b/g, "≠")
    .replace(/\\pi\b/g, "π")
    .replace(/\\theta\b/g, "θ")
    .replace(/\\alpha\b/g, "α")
    .replace(/\\beta\b/g, "β")
    .replace(/\\(left|right|quad)\b/g, " ")
    .replace(/\\[,;!]/g, " ")
    .replace(/\\([a-zA-Z]+)/g, "$1")
    .replace(/[{}]/g, "");
}
