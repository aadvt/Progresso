/** Small display helpers shared by server and client components. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y: y ?? 1970, m: (m ?? 1) - 1, d: d ?? 1 };
}

/** "10 Nov 2026" */
export function formatDate(iso: string): string {
  const { y, m, d } = parts(iso);
  return `${d} ${MONTHS[m]} ${y}`;
}

/** "Jul – Nov 2026" or "Nov 2026 – Jan 2027" */
export function formatMonthRange(from: string, to: string): string {
  const a = parts(from);
  const b = parts(to);
  if (a.y === b.y && a.m === b.m) return `${MONTHS[a.m]} ${a.y}`;
  if (a.y === b.y) return `${MONTHS[a.m]} – ${MONTHS[b.m]} ${b.y}`;
  return `${MONTHS[a.m]} ${a.y} – ${MONTHS[b.m]} ${b.y}`;
}

/** Whole days from `today` (local calendar day) to an ISO date. */
export function daysUntil(iso: string, today: Date): number {
  const { y, m, d } = parts(iso);
  const target = Date.UTC(y, m, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - now) / 86_400_000);
}

/** Marks for display: whole numbers stay whole, otherwise one decimal. */
export function marks(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function hours(h: number): string {
  const r = Math.round(h * 2) / 2;
  return `${Number.isInteger(r) ? r : r.toFixed(1)} h`;
}

const ERROR_TYPE_LABEL: Record<string, string> = {
  conceptual: "Concept",
  procedural: "Method",
  calculation: "Calculation",
  careless: "Careless",
  notation: "Notation",
  incomplete: "Incomplete",
  unattempted: "Not attempted",
  unclassified: "Unclassified",
};

export function errorTypeLabel(t: string): string {
  return ERROR_TYPE_LABEL[t] ?? t;
}

/** "Unit Test 1" -> "UT1"-style short labels are avoided: we keep the report's exam names. */
export function joinNames(names: string[], max = 3): string {
  if (names.length <= max) return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}
