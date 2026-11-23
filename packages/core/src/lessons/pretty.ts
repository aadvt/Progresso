/**
 * Display-only prettifying of a report's plain-text working, for the
 * handwriting rendering: `x^2` → `x²`, `sqrt(` → `√(`, `theta` → `θ`.
 * It only swaps notation for the same symbols; it never adds, drops or
 * reorders anything the student wrote. Browser-safe (no imports).
 */
const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "-": "⁻", "+": "⁺", n: "ⁿ", x: "ˣ", y: "ʸ", i: "ⁱ",
};

function sup(s: string): string | undefined {
  let out = "";
  for (const ch of s) {
    const m = SUP[ch];
    if (!m) return undefined;
    out += m;
  }
  return out;
}

export function prettyWorking(text: string): string {
  return (
    text
      // ^(...) with only superscriptable characters, then ^-1 / ^2 / ^n style powers.
      .replace(/\^\(([0-9+\-nxyi]{1,4})\)/g, (all, p: string) => sup(p) ?? all)
      .replace(/\^(-?[0-9]{1,3})(?![0-9.])/g, (all, p: string) => sup(p) ?? all)
      .replace(/\^([nxy])(?![0-9a-zA-Z(])/g, (all, p: string) => sup(p) ?? all)
      .replace(/sqrt\(/g, "√(")
      .replace(/(?<![A-Za-z])theta(?![A-Za-z])/g, "θ")
      .replace(/(?<![A-Za-z])alpha(?![A-Za-z])/g, "α")
      .replace(/(?<![A-Za-z])beta(?![A-Za-z])/g, "β")
      .replace(/(?<![A-Za-z])pi(?![A-Za-z])/g, "π")
      .replace(/ \* /g, " · ")
      .replace(/->/g, "→")
      .replace(/<=/g, "≤")
      .replace(/>=/g, "≥")
      .replace(/!=/g, "≠")
  );
}
