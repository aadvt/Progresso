/** Calendar-day helpers. Plans work in whole days ("YYYY-MM-DD"), independent of time zone. */

export type IsoDay = string;

function toUtc(day: IsoDay): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function addDays(day: IsoDay, n: number): IsoDay {
  return new Date(toUtc(day) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: IsoDay, b: IsoDay): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** Noon UTC on that day: a stable instant for FSRS, which works in timestamps. */
export function dayToInstant(day: IsoDay): Date {
  return new Date(toUtc(day) + 12 * 3_600_000);
}

export function instantToDay(d: Date | string): IsoDay {
  return (typeof d === "string" ? new Date(d) : d).toISOString().slice(0, 10);
}

/** The local calendar day of a Date (what "today" means for the student). */
export function localDay(d: Date = new Date()): IsoDay {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function dayRange(from: IsoDay, toExclusive: IsoDay): IsoDay[] {
  const out: IsoDay[] = [];
  for (let d = from; d < toExclusive; d = addDays(d, 1)) out.push(d);
  return out;
}
