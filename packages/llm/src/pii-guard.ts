/**
 * Last line of defence for the "only anonymised data leaves the machine" rule.
 * The real protection is the data model (students are pseudonymous ids and
 * names never enter prompts); this catches obvious leaks before an external call.
 */
export class PiiGuardError extends Error {
  override name = "PiiGuardError";
}

const PATTERNS: { label: string; re: RegExp }[] = [
  { label: "email address", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { label: "phone number", re: /(?:\+91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/ },
  { label: "Aadhaar-like number", re: /\b\d{4}[\s-]\d{4}[\s-]\d{4}\b/ },
];

export interface PiiGuardOptions {
  /** Extra strings that must never be sent, e.g. local display names of students. */
  blockedTerms?: string[];
}

export function assertNoPii(text: string, options: PiiGuardOptions = {}): void {
  for (const { label, re } of PATTERNS) {
    if (re.test(text)) throw new PiiGuardError(`Refusing to send prompt to an external LLM: it contains an ${label}`);
  }
  const lower = text.toLowerCase();
  for (const term of options.blockedTerms ?? []) {
    if (term.trim().length >= 3 && lower.includes(term.trim().toLowerCase())) {
      throw new PiiGuardError("Refusing to send prompt to an external LLM: it contains a blocked term (e.g. a student name)");
    }
  }
}
