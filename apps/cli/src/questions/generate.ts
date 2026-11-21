/**
 * Generate and verify prove-it questions, then cache them in the question bank.
 *
 *   pnpm questions:generate            all targets from the demo diagnoses
 *   pnpm questions:generate --list     print the targets only
 *   pnpm questions:generate --only chain_rule,trig   only targets matching any of these
 *   pnpm questions:generate --missing  only targets with no verified questions yet (top up)
 *
 * Each target is saved as soon as it finishes (bank file + _generation-report.json),
 * so a stopped run keeps everything it verified; the report accumulates across runs.
 *
 * Pipeline per (concept, misconception):
 *  1. generate (LLM task generate_questions) with distractors built from the
 *     misconceptions and the reports' anonymised wording of real mistakes;
 *  2. structural checks (one correct option, every wrong option mapped to an
 *     allowed misconception, no duplicate options);
 *  3. maths: SymPy recomputes the answer from scratch and proves every
 *     distractor differs from it (tools/cas/check.py);
 *  4. an independent LLM solving pass (task verify_questions) that never sees
 *     the key must reach the keyed answer; questions without a CAS check
 *     (chemistry) need two solving passes on two different models to agree;
 *  5. anything that fails any step is discarded and logged.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findRepoRoot, loadAppConfig, loadConceptGraph, ProveItQuestionSchema, type ConceptGraph, type ProveItQuestion } from "@progresso/core";
import { loadDemoFixtures } from "@progresso/core/demo-fixtures";
import { createLlmClient, loadLlmConfig, resolveTaskConfig, type LlmClient } from "@progresso/llm";
import { GEN_SYSTEM, GenOutputSchema, genPrompt, PROMPT_VERSION, SOLVE_SYSTEM, SOLVE_SYSTEM_ALT, solvePrompt, SolveSchema, type GenQuestion, type MistakePattern } from "./prompts";
import { collectTargets, type Target } from "./targets";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const repoRoot = findRepoRoot();
const config = loadAppConfig(repoRoot);
const { graph } = loadConceptGraph(config.conceptGraphDir);
const demo = loadDemoFixtures(config.fixturesDir);
const llmConfig = loadLlmConfig(repoRoot);

interface Candidate {
  q: ProveItQuestion;
  gen: GenQuestion;
  correctLetter?: string;
  reasons: string[];
  checks: ProveItQuestion["verification"]["checks"];
}

interface TargetReport {
  concept_id: string;
  misconception_id: string;
  subject: string;
  for: string[];
  generated: number;
  verified: number;
  rejected: { stem: string; reasons: string[] }[];
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function patternsFor(t: Target): MistakePattern[] {
  const all = demo.flatMap((s) => s.records);
  const exact = all.filter((r) => r.misconception?.misconception_id === t.misconception_id);
  const pool = exact.length > 0 ? exact : all.filter((r) => r.concepts.some((c) => c.concept_id === t.concept_id));
  // Anonymised: the report's wording only; no ids, names or exam details.
  return pool.map((r) => ({
    ...(r.question.text ? { question: r.question.text } : {}),
    report_says: r.diagnosis.text,
    ...(r.student_working ? { student_wrote: r.student_working.text } : {}),
    ...(r.diagnosis.correct_approach ? { correct_approach: r.diagnosis.correct_approach } : {}),
  }));
}

function allowedMisconceptions(g: ConceptGraph, t: Target): Set<string> {
  const c = g.get(t.concept_id);
  const target = g.misconceptions.get(t.misconception_id)!;
  const ids = new Set<string>();
  for (const id of [c.id, target.concept_id, ...c.prerequisites, ...g.get(target.concept_id).prerequisites]) for (const m of g.get(id).misconceptions) ids.add(m.id);
  return ids;
}

function toCandidate(t: Target, gen: GenQuestion, n: number, provider: string, model: string, patterns: number): Candidate {
  const reasons: string[] = [];
  const allowed = allowedMisconceptions(graph, t);
  for (const w of gen.wrong) if (!allowed.has(w.misconception_id)) reasons.push(`distractor tagged with a misconception not offered: ${w.misconception_id}`);
  if (!gen.wrong.some((w) => w.misconception_id === t.misconception_id)) reasons.push("no distractor uses the target misconception");
  const id = `${t.misconception_id}.${t.concept_id.split(".").pop()}.${n}`;
  const now = new Date().toISOString();
  let correctLetter: string | undefined;
  const base = {
    schema_version: "1.0" as const,
    id,
    subject: t.subject,
    concept_id: t.concept_id,
    target_misconception_id: t.misconception_id,
    stem: gen.stem,
    solution: gen.solution,
    difficulty: Math.min(3, Math.max(1, gen.difficulty)) as 1 | 2 | 3,
    verification: { status: "verified" as const, checks: [{ method: "llm_solve" as const, passed: false, detail: "pending" }], verified_at: now },
    provenance: {
      generator: { provider, model },
      generated_at: now,
      prompt_version: PROMPT_VERSION,
      distractors_from: { misconceptions: [...new Set(gen.wrong.map((w) => w.misconception_id))], report_mistakes: patterns },
    },
  };
  let q: ProveItQuestion;
  if (gen.kind === "mcq") {
    if (gen.wrong.length !== 3) reasons.push(`expected 3 wrong options, got ${gen.wrong.length}`);
    const texts = [gen.correct.text, ...gen.wrong.map((w) => w.text)].map((x) => x.replace(/\s+/g, ""));
    if (new Set(texts).size !== texts.length) reasons.push("two options are identical");
    const opts = [
      { text: gen.correct.text, correct: true, feedback: gen.correct.feedback },
      ...gen.wrong.map((w) => ({ text: w.text, correct: false, misconception_id: w.misconception_id, how_it_arises: w.how_it_arises, feedback: w.feedback })),
    ];
    // Deterministic shuffle so the key isn't always "a".
    const order = opts.map((o, i) => ({ o, k: hash(`${id}|${i}|${o.text}`) })).sort((a, b) => a.k - b.k).map((x) => x.o);
    const options = order.map((o, i) => ({ ...o, id: "abcdef"[i]! }));
    correctLetter = options.find((o) => o.correct)!.id;
    q = { ...base, kind: "mcq", options };
  } else {
    const v = gen.correct.value;
    if (v === null || !Number.isFinite(v)) reasons.push("numeric question without a numeric answer");
    const value = v ?? 0;
    const tolerance = Math.max(0.01, Math.abs(value) * 0.005);
    const wrongs = gen.wrong
      .filter((w) => w.value !== null && Number.isFinite(w.value))
      .map((w) => ({ value: w.value!, misconception_id: w.misconception_id, how_it_arises: w.how_it_arises, feedback: w.feedback }));
    if (wrongs.some((w) => Math.abs(w.value - value) <= tolerance)) reasons.push("an anticipated wrong value equals the answer");
    q = {
      ...base,
      kind: "numeric",
      answer: { value, tolerance, display: gen.correct.text, feedback: gen.correct.feedback, ...(gen.unit ? { unit: gen.unit } : {}) },
      numeric_wrong: wrongs,
    };
  }
  return { q, gen, ...(correctLetter ? { correctLetter } : {}), reasons, checks: [] };
}

/** SymPy: recompute the answer, prove distractors differ. */
function casCheck(cands: Candidate[]): void {
  const todo = cands.filter((c) => c.reasons.length === 0 && c.gen.check.mode !== "none" && c.gen.check.compute);
  if (todo.length === 0) return;
  const payload = todo.map((c, i) => {
    const numeric = c.gen.kind === "numeric";
    return {
      id: String(i),
      mode: numeric ? "numeric" : c.gen.check.mode,
      symbols: c.gen.check.symbols,
      compute: c.gen.check.compute,
      answer: numeric ? String(c.gen.correct.value) : (c.gen.correct.sympy ?? ""),
      wrong: numeric ? c.gen.wrong.filter((w) => w.value !== null).map((w) => String(w.value)) : c.gen.wrong.map((w) => w.sympy ?? ""),
    };
  });
  const res = spawnSync("python", ["-I", join(repoRoot, "tools", "cas", "check.py")], { input: JSON.stringify(payload), encoding: "utf8" });
  if (res.status !== 0) throw new Error(`CAS helper failed: ${res.stderr}`);
  const out = JSON.parse(res.stdout) as { id: string; ok: boolean; computed?: string; answer_matches?: boolean; wrong_distinct?: boolean[]; error?: string }[];
  for (const r of out) {
    const c = todo[Number(r.id)]!;
    const detail = r.error
      ? `SymPy error: ${r.error}`
      : `SymPy computed ${r.computed}; key ${r.answer_matches ? "matches" : "DOES NOT match"}; distractors distinct: ${JSON.stringify(r.wrong_distinct)}`;
    c.checks.push({ method: "cas_sympy", passed: r.ok, detail });
    if (!r.ok) c.reasons.push(detail);
  }
}

async function solve(llm: LlmClient, c: Candidate, second?: string): Promise<void> {
  const q = c.q;
  const options = q.options?.map((o) => ({ letter: o.id.toUpperCase(), text: o.text }));
  const ask = (model: string | undefined, system: string) =>
    llm.generateObject("verify_questions", {
      system,
      prompt: solvePrompt(q.stem, options, q.answer?.unit),
      schema: SolveSchema,
      ...(model ? { overrides: { model, fallbackModels: [] } } : {}),
    });
  let res;
  if (second !== undefined) {
    // Second opinion: another model; if that model is unavailable, the same model with a different method (option by option).
    try {
      if (!second) throw new Error("no second model");
      res = await ask(second, SOLVE_SYSTEM);
    } catch {
      res = await ask(undefined, SOLVE_SYSTEM_ALT);
    }
  } else res = await ask(undefined, SOLVE_SYSTEM);
  const s = res.data;
  let passed: boolean;
  let detail: string;
  if (q.kind === "mcq") {
    const chosen = (s.chosen_option ?? "").trim().toLowerCase().replace(/[^a-f]/g, "").slice(0, 1);
    passed = chosen === c.correctLetter && s.exactly_one_option_correct;
    detail = `solver chose ${chosen || "nothing"} (key ${c.correctLetter}); exactly one correct: ${s.exactly_one_option_correct}; issues: ${s.issues}`;
  } else {
    const v = s.numeric_value;
    passed = v !== null && Math.abs(v - q.answer!.value) <= Math.max(q.answer!.tolerance, Math.abs(q.answer!.value) * 0.01);
    detail = `solver got ${v} (key ${q.answer!.value}); issues: ${s.issues}`;
  }
  c.checks.push({ method: "llm_solve", passed, model: res.model, detail: second !== undefined ? `second opinion: ${detail}` : detail });
  if (!passed) c.reasons.push(`independent solve disagreed: ${detail}`);
}

async function main() {
  const targets = collectTargets(
    graph,
    demo.map((s) => ({ id: s.student.id, records: s.records })),
  ).filter((t) => {
    const only = value("only")?.split(",").filter(Boolean);
    return !only || only.some((o) => t.concept_id.includes(o) || t.misconception_id.includes(o));
  });
  const bankDir = config.questionBankDir;
  const reportPath = join(bankDir, "_generation-report.json");
  if (flag("missing")) {
    // Top-up mode: skip targets that already have verified questions in the bank.
    const done = new Set(readReport(reportPath).targets.filter((r) => r.verified > 0).map((r) => `${r.misconception_id}|${r.concept_id}`));
    targets.splice(0, targets.length, ...targets.filter((t) => !done.has(`${t.misconception_id}|${t.concept_id}`)));
  }
  if (flag("list")) {
    for (const t of targets) console.log(`${t.misconception_id.padEnd(42)} on ${t.concept_id.padEnd(38)} x${t.count}  (${t.for.join("; ")})`);
    console.log(`${targets.length} targets`);
    return;
  }
  const llm = createLlmClient({ repoRoot });
  const genCfg = resolveTaskConfig(llmConfig, "generate_questions");
  const solveCfg = resolveTaskConfig(llmConfig, "verify_questions");
  // Second opinion for questions without a symbolic proof: another model if given (--second-model), else the same model with a different method.
  const secondModel = value("second-model");
  const reports: TargetReport[] = [];
  const solverNames = [solveCfg.model, secondModel ?? `${solveCfg.model} (option-by-option method)`];
  // Each finished target is saved at once (bank file + report), so a stopped run keeps what it verified.
  const save = (t: Target, report: TargetReport, verified: ProveItQuestion[]) => {
    saveTarget(bankDir, t, report, verified);
    mergeReport(reportPath, report, { prompt_version: PROMPT_VERSION, generator: genCfg.model, solver: solverNames });
  };

  const runTarget = async (i: number, t: Target): Promise<void> => {
    const patterns = patternsFor(t);
    const maths = t.subject === "Mathematics";

    let gen;
    try {
      gen = await llm.generateObject("generate_questions", {
        system: GEN_SYSTEM,
        prompt: genPrompt({ graph, concept_id: t.concept_id, misconception_id: t.misconception_id, count: t.count, numeric: maths ? 1 : 0, patterns }),
        schema: GenOutputSchema,
      });
    } catch (e) {
      // Nothing is saved: whatever the bank already holds for this target stays.
      console.log(`[${i + 1}/${targets.length}] ${t.misconception_id} on ${t.concept_id}: generation failed: ${(e as Error).message}`);
      reports.push({ concept_id: t.concept_id, misconception_id: t.misconception_id, subject: t.subject, for: t.for, generated: 0, verified: 0, rejected: [{ stem: "(generation failed)", reasons: [(e as Error).message] }] });
      return;
    }
    const cands = gen.data.questions.map((g, n) => toCandidate(t, g, n + 1, genCfg.provider, gen.model, patterns.length));
    casCheck(cands);
    await Promise.all(
      cands
        .filter((c) => c.reasons.length === 0)
        .map(async (c) => {
          try {
            await solve(llm, c);
            // No symbolic proof (chemistry, or maths the CAS couldn't express): a second solver on another model must agree too.
            if (c.reasons.length === 0 && !c.checks.some((x) => x.method === "cas_sympy" && x.passed)) await solve(llm, c, secondModel ?? "");
          } catch (e) {
            c.reasons.push(`solver failed: ${(e as Error).message}`);
          }
        }),
    );
    const report: TargetReport = { concept_id: t.concept_id, misconception_id: t.misconception_id, subject: t.subject, for: t.for, generated: cands.length, verified: 0, rejected: [] };
    const verified: ProveItQuestion[] = [];
    for (const c of cands) {
      if (c.reasons.length > 0) {
        report.rejected.push({ stem: c.q.stem, reasons: c.reasons });
        continue;
      }
      const q = ProveItQuestionSchema.safeParse({ ...c.q, verification: { status: "verified", checks: c.checks, verified_at: new Date().toISOString() } });
      if (!q.success) {
        report.rejected.push({ stem: c.q.stem, reasons: q.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`) });
        continue;
      }
      report.verified++;
      verified.push(q.data);
    }
    reports.push(report);
    save(t, report, verified);
    console.log(`[${i + 1}/${targets.length}] ${t.misconception_id} on ${t.concept_id}: ${report.verified}/${report.generated} verified${gen.cached ? " (cached generation)" : ""}`);
  };
  // A few targets at a time; the client's rate limiter keeps us under the provider's requests per minute.
  const concurrency = Math.max(1, Number(value("concurrency") ?? 3));
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < targets.length) {
        const i = next++;
        await runTarget(i, targets[i]!);
      }
    }),
  );
  const totals = {
    targets: reports.length,
    misconceptions: new Set(reports.map((r) => r.misconception_id)).size,
    subjects: [...new Set(reports.map((r) => r.subject))],
    generated: reports.reduce((s, r) => s + r.generated, 0),
    verified: reports.reduce((s, r) => s + r.verified, 0),
    rejected: reports.reduce((s, r) => s + r.rejected.length, 0),
  };
  console.log(`\nThis run: ${totals.verified} verified of ${totals.generated} generated (${totals.rejected} rejected) across ${totals.misconceptions} misconceptions.`);
  const all = readReport(reportPath).totals;
  if (all) console.log(`Bank: ${all.verified} verified questions across ${all.misconceptions} misconceptions (${all.targets} targets) in ${all.subjects.join(", ")}.`);
}

interface ReportFile {
  generated_at?: string;
  prompt_version?: string;
  generator?: string;
  solver?: string[];
  totals?: { targets: number; misconceptions: number; subjects: string[]; generated: number; verified: number; rejected: number };
  targets: TargetReport[];
}

function readReport(path: string): ReportFile {
  if (!existsSync(path)) return { targets: [] };
  return JSON.parse(readFileSync(path, "utf8")) as ReportFile;
}

const sameTarget = (a: { concept_id: string; misconception_id: string }, b: { concept_id: string; misconception_id: string }) =>
  a.concept_id === b.concept_id && a.misconception_id === b.misconception_id;

/** Replace this target's questions in its misconception's bank file (other targets' questions stay). A run that verified nothing keeps the old ones. */
function saveTarget(bankDir: string, t: Target, report: TargetReport, verified: ProveItQuestion[]): void {
  if (report.verified === 0) return;
  const m = graph.misconceptions.get(t.misconception_id)!;
  const subject = graph.get(m.concept_id).subject;
  const dir = join(bankDir, subject.toLowerCase());
  const file = join(dir, `${t.misconception_id}.json`);
  const existing: ProveItQuestion[] = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { questions: ProveItQuestion[] }).questions : [];
  const questions = [...existing.filter((q) => q.concept_id !== t.concept_id), ...verified].sort((a, b) => a.id.localeCompare(b.id));
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ misconception_id: t.misconception_id, concept_id: m.concept_id, subject, questions }, null, 2) + "\n");
}

/** The generation report accumulates across runs: one entry per target, the latest run that verified something wins. */
function mergeReport(path: string, report: TargetReport, meta: { prompt_version: string; generator: string; solver: string[] }): void {
  const file = readReport(path);
  const old = file.targets.find((r) => sameTarget(r, report));
  if (old && old.verified > 0 && report.verified === 0) return;
  const targets = [...file.targets.filter((r) => !sameTarget(r, report)), report].sort((a, b) => a.subject.localeCompare(b.subject) || a.misconception_id.localeCompare(b.misconception_id) || a.concept_id.localeCompare(b.concept_id));
  const totals = {
    targets: targets.length,
    misconceptions: new Set(targets.filter((r) => r.verified > 0).map((r) => r.misconception_id)).size,
    subjects: [...new Set(targets.filter((r) => r.verified > 0).map((r) => r.subject))].sort(),
    generated: targets.reduce((s, r) => s + r.generated, 0),
    verified: targets.reduce((s, r) => s + r.verified, 0),
    rejected: targets.reduce((s, r) => s + r.rejected.length, 0),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ generated_at: new Date().toISOString(), ...meta, totals, targets }, null, 2) + "\n");
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
