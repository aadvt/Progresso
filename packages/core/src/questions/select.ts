/**
 * Picking a check's questions from the bank. Deterministic for a given seed.
 *
 * Preference, in order: questions on the concept itself; aimed at the
 * student's own report misconceptions; aimed at misconceptions a recent wrong
 * answer revealed (still alive); not seen before. Coverage is spread across
 * misconceptions, and a check includes a numeric question when one exists.
 */
import type { ProveItQuestion } from "./schema";

export interface QuestionBank {
  questions: readonly ProveItQuestion[];
  byId: ReadonlyMap<string, ProveItQuestion>;
}

export function makeBank(questions: readonly ProveItQuestion[]): QuestionBank {
  return { questions, byId: new Map(questions.map((q) => [q.id, q])) };
}

export interface SelectOptions {
  concept_id: string;
  /** Misconceptions the mission targets, most important first. */
  misconception_ids: readonly string[];
  /** The student's own misconceptions from the report. */
  own?: ReadonlySet<string>;
  /** Misconceptions still alive (revealed by a recent wrong answer). */
  alive?: ReadonlySet<string>;
  /** Times each question was already shown to this student. */
  seen?: ReadonlyMap<string, number>;
  n: number;
  seed: string;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

export function selectQuestions(bank: QuestionBank, o: SelectOptions): ProveItQuestion[] {
  const targets = new Set(o.misconception_ids);
  const pool = bank.questions.filter((q) => q.concept_id === o.concept_id || targets.has(q.target_misconception_id));
  const base = new Map<string, number>();
  for (const q of pool) {
    let s = 0;
    if (q.concept_id === o.concept_id) s += 4;
    const idx = o.misconception_ids.indexOf(q.target_misconception_id);
    if (idx >= 0) s += 3 - Math.min(2, idx * 0.25);
    if (o.own?.has(q.target_misconception_id)) s += 3;
    if (o.alive?.has(q.target_misconception_id)) s += 2;
    const seen = o.seen?.get(q.id) ?? 0;
    s -= seen * 3;
    s += hash(`${o.seed}|${q.id}`) * 0.9;
    base.set(q.id, s);
  }
  const picked: ProveItQuestion[] = [];
  const perTarget = new Map<string, number>();
  const hasNumeric = pool.some((q) => q.kind === "numeric");
  while (picked.length < o.n) {
    let best: ProveItQuestion | undefined;
    let bestScore = -Infinity;
    for (const q of pool) {
      if (picked.includes(q)) continue;
      let s = base.get(q.id)! - 2.5 * (perTarget.get(q.target_misconception_id) ?? 0);
      const needNumeric = hasNumeric && picked.length === o.n - 1 && !picked.some((p) => p.kind === "numeric");
      if (needNumeric && q.kind === "numeric") s += 10;
      if (s > bestScore) {
        bestScore = s;
        best = q;
      }
    }
    if (!best) break;
    picked.push(best);
    perTarget.set(best.target_misconception_id, (perTarget.get(best.target_misconception_id) ?? 0) + 1);
  }
  // MCQs first, numeric last: quick wins, then the one you type.
  return picked.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "mcq" ? -1 : 1));
}

/** Questions available for a concept (directly or through its misconceptions). */
export function questionsFor(bank: QuestionBank, conceptId: string, misconceptionIds: readonly string[] = []): ProveItQuestion[] {
  const t = new Set(misconceptionIds);
  return bank.questions.filter((q) => q.concept_id === conceptId || t.has(q.target_misconception_id));
}
