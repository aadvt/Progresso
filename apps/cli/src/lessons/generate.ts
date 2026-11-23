/**
 * Generate, verify and cache Mistake Recaps (one per error record) and step
 * explainers (one per misconception).
 *
 *   pnpm lessons:generate                         recaps + explainers for every target
 *   pnpm lessons:generate --recaps | --explainers only one kind
 *   pnpm lessons:generate --list                  print the targets only
 *   pnpm lessons:generate --only q7,chain_rule    targets whose id contains any of these
 *   pnpm lessons:generate --missing               skip targets that already have content
 *   pnpm lessons:generate --model M --review-model R   generator / independent reviewer model
 *
 * Pipeline per item:
 *  1. generate (LLM task write_recap / write_explainer), anonymised input only;
 *  2. structural checks (core `checkRecapStructure` / `checkExplainerStructure`):
 *     a recap of the student's working must reproduce the report's quote exactly;
 *  3. maths: SymPy works the answer out from scratch; every line claiming the
 *     answer must equal it, every wrong step must differ (tools/cas/check.py);
 *  4. an independent review (task review_lesson) on a different model: it
 *     finds the erroneous line itself, which must be the marked one, and
 *     checks the fix, the note and the honesty of a typical step;
 *  5. anything that fails is discarded and logged in _generation-report.json.
 * Each item is saved as soon as it passes, so a stopped run keeps its work.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  checkExplainerStructure,
  checkRecapStructure,
  wrapBareTex,
  repairLatexEscapes,
  findRepoRoot,
  loadAppConfig,
  loadConceptGraph,
  loadLessons,
  MistakeRecapSchema,
  recapFor,
  recapModeFor,
  recapSourceHash,
  StepExplainerSchema,
  type CasClaim,
  type CasSetup,
  type ErrorRecord,
  type LessonCheck,
  type MistakeRecap,
  type StepExplainer,
} from "@progresso/core";
import { loadDemoFixtures, SAMPLE_DATA_NOTICE } from "@progresso/core/demo-fixtures";
import { createLlmClient, loadLlmConfig, resolveTaskConfig, type LlmClient } from "@progresso/llm";
import { collectTargets } from "../questions/targets";
import {
  EXPLAINER_PROMPT_VERSION,
  EXPLAINER_SYSTEM,
  ExplainerGenSchema,
  explainerPrompt,
  explainerReviewPrompt,
  ExplainerReviewSchema,
  RECAP_PROMPT_VERSION,
  RECAP_SYSTEM,
  RecapGenSchema,
  recapPrompt,
  recapReviewPrompt,
  RecapReviewSchema,
  REVIEW_EXPLAINER_SYSTEM,
  REVIEW_RECAP_SYSTEM,
  type ExplainerGen,
  type RecapGen,
} from "./prompts";

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

// ---------------------------------------------------------------- targets

function recapTargets(): ErrorRecord[] {
  return demo
    .flatMap((s) => s.records)
    .filter((r) => r.error_type !== "unattempted" && r.concepts.some((c) => c.role === "primary" && graph.has(c.concept_id)));
}

function explainerTargets(): string[] {
  const fromQuestions = collectTargets(
    graph,
    demo.map((s) => ({ id: s.student.id, records: s.records })),
  ).map((t) => t.misconception_id);
  const fromRecords = demo.flatMap((s) => s.records.map((r) => r.misconception?.misconception_id).filter((m): m is string => !!m));
  return [...new Set([...fromRecords, ...fromQuestions])].filter((m) => graph.misconceptions.has(m)).sort();
}

// ---------------------------------------------------------------- SymPy

interface CasEntry {
  id: string;
  mode: string;
  symbols: string[];
  compute: string;
  answer: string;
  wrong: string[];
}

/** Every "answer" claim must equal the from-scratch result; every "not_answer" claim must differ. */
function casVerify(setup: CasSetup | undefined, claims: CasClaim[], maths: boolean): LessonCheck | undefined {
  if (!maths) return undefined;
  const answers = claims.filter((c) => c.expect === "answer");
  const wrongs = claims.filter((c) => c.expect === "not_answer");
  if (!setup) return { method: "cas_sympy", passed: false, detail: "maths content without a SymPy setup" };
  if (answers.length === 0) return { method: "cas_sympy", passed: false, detail: "no line states the final answer in a checkable form" };
  const entries: CasEntry[] = answers.map((a, i) => ({
    id: String(i),
    mode: setup.mode,
    symbols: setup.symbols,
    compute: setup.compute,
    answer: a.expr,
    wrong: i === 0 ? wrongs.map((w) => w.expr) : [],
  }));
  const res = spawnSync("python", ["-I", join(repoRoot, "tools", "cas", "check.py")], { input: JSON.stringify(entries), encoding: "utf8" });
  if (res.status !== 0) throw new Error(`CAS helper failed: ${res.stderr}`);
  const out = JSON.parse(res.stdout) as { id: string; ok: boolean; computed?: string; answer_matches?: boolean; wrong_distinct?: boolean[]; error?: string }[];
  const bad = out.filter((o) => !o.ok);
  const computed = out[0]?.computed;
  const detail = bad.length
    ? `SymPy: ${bad.map((b) => (b.error ? `error ${b.error}` : `line "${answers[Number(b.id)]!.expr}" ${b.answer_matches ? "ok" : "DOES NOT equal"} ${b.computed}; wrong steps distinct ${JSON.stringify(b.wrong_distinct)}`)).join("; ")}`
    : `SymPy computed ${computed}; ${answers.length} answer line(s) equal it; ${wrongs.length} wrong step(s) differ from it`;
  return { method: "cas_sympy", passed: bad.length === 0, detail };
}

// ---------------------------------------------------------------- recaps

const isMaths = (subject: string) => subject === "Mathematics";

function toRecap(r: ErrorRecord, gen: RecapGen, generator: { provider: string; model: string }): Omit<MistakeRecap, "verification"> {
  const own = recapModeFor(r) === "student_working";
  const primary = r.concepts.find((c) => c.role === "primary")?.concept_id;
  const cas =
    isMaths(r.exam.subject) && gen.check.mode !== "none" && gen.check.compute
      ? { mode: gen.check.mode, symbols: gen.check.symbols, compute: gen.check.compute }
      : undefined;
  const claim = (expr: string | null, expect: CasClaim["expect"]) => (cas && expr ? { cas: { expr, expect } } : {});
  return {
    schema_version: "1.0",
    record_id: r.id,
    source_hash: recapSourceHash(r),
    subject: r.exam.subject,
    ...(primary ? { concept_id: primary } : {}),
    ...(r.misconception ? { misconception_id: r.misconception.misconception_id } : {}),
    mode: own ? "student_working" : "typical_step",
    wrong: {
      format: own ? (r.student_working!.format === "latex" ? "latex" : "plain") : "latex",
      lines: gen.wrong_lines.map((l) => ({
        // The student's quote stays exactly as written; only typical (LaTeX) lines are normalised.
        text: own ? l.text : wrapBareTex(l.text),
        wrong: l.wrong,
        ...(own && l.wrong && l.mark ? { mark: l.mark } : {}),
        ...(l.wrong ? claim(l.sympy, "not_answer") : {}),
      })),
      note: gen.wrong_note,
    },
    fix: { lines: gen.fix_lines.map((l) => ({ text: wrapBareTex(l.text), ...(l.note ? { note: wrapBareTex(l.note) } : {}), ...claim(l.sympy, "answer") })) },
    key_idea: gen.key_idea,
    ...(cas ? { cas } : {}),
    provenance: {
      generator,
      generated_at: new Date().toISOString(),
      prompt_version: RECAP_PROMPT_VERSION,
      ...(r.provenance.kind === "demo_fixture" ? { sample_data: true } : {}),
    },
  };
}

interface ItemReport {
  kind: "recap" | "explainer";
  id: string;
  mode?: string;
  passed: boolean;
  reasons: string[];
  checks: LessonCheck[];
}

const overrides = (model: string | undefined) => (model ? { overrides: { model, fallbackModels: [] } } : {});
/** --fresh: ask the generator again instead of reusing its cached answer (e.g. after rejecting content on hand review). */
const fresh = () => (args.includes("--fresh") ? { cache: "refresh" as const } : {});

/** Repair JSON-escape damage to LaTeX in every string of a generated object. */
function repaired<T>(v: T): T {
  return JSON.parse(JSON.stringify(v), (_k, x: unknown) => (typeof x === "string" ? repairLatexEscapes(x) : x)) as T;
}

async function makeRecap(llm: LlmClient, r: ErrorRecord, genModel?: string, reviewModel?: string): Promise<{ recap?: MistakeRecap; report: ItemReport }> {
  const report: ItemReport = { kind: "recap", id: r.id, mode: recapModeFor(r), passed: false, reasons: [], checks: [] };
  const gen = await llm.generateObject("write_recap", { system: RECAP_SYSTEM, prompt: recapPrompt(graph, r), schema: RecapGenSchema, ...overrides(genModel), ...fresh() });
  gen.data = repaired(gen.data);
  const draft = toRecap(r, gen.data, { provider: gen.provider, model: gen.model });
  const structure = checkRecapStructure(draft, r);
  report.checks.push({ method: "structure", passed: structure.length === 0, detail: structure.length ? structure.join("; ") : `lines reproduce the ${draft.mode === "student_working" ? "quoted working exactly" : "typical step, labelled"}; marks inside their lines` });
  report.reasons.push(...structure);
  if (report.reasons.length === 0) {
    const claims = [...draft.wrong.lines, ...draft.fix.lines].flatMap((l) => (l.cas ? [l.cas] : []));
    const cas = casVerify(draft.cas, claims, isMaths(r.exam.subject));
    if (cas) {
      report.checks.push(cas);
      if (!cas.passed) report.reasons.push(cas.detail);
    }
  }
  if (report.reasons.length === 0) {
    const rev = await llm.generateObject("review_lesson", { system: REVIEW_RECAP_SYSTEM, prompt: recapReviewPrompt(graph, r, gen.data), schema: RecapReviewSchema, ...overrides(reviewModel) });
    const v = rev.data;
    const markedLines = draft.wrong.lines.flatMap((l, i) => (l.wrong ? [i + 1] : []));
    const problems: string[] = [];
    if (v.error_line === null || !markedLines.includes(v.error_line)) problems.push(`reviewer puts the error on line ${v.error_line}, we marked ${markedLines.join(",")}`);
    if (!v.marked_part_is_the_error) problems.push("marked part is not the reported error");
    if (!v.note_matches_report) problems.push("note doesn't match the report");
    if (!v.fix_correct) problems.push("fix not correct");
    if (!v.fix_agrees_with_report) problems.push("fix disagrees with the report");
    if (!v.typical_step_matches_report) problems.push("typical step doesn't show the reported mistake");
    if (rev.model === gen.model) problems.push(`reviewer was the generator's model (${rev.model}); need an independent model`);
    const detail = `${problems.length ? problems.join("; ") : "error line, mark, note, fix and report agreement confirmed"}; reviewer issues: ${v.issues}`;
    report.checks.push({ method: "llm_review", passed: problems.length === 0, model: rev.model, detail });
    report.reasons.push(...problems);
    if (problems.length === 0) {
      const recap = MistakeRecapSchema.parse({
        ...draft,
        verification: { status: "verified", checks: report.checks, verified_at: new Date().toISOString() },
        provenance: { ...draft.provenance, reviewer: { provider: rev.provider, model: rev.model } },
      });
      report.passed = true;
      return { recap, report };
    }
  }
  return { report };
}

// ---------------------------------------------------------------- explainers

async function makeExplainer(llm: LlmClient, misconceptionId: string, genModel?: string, reviewModel?: string): Promise<{ explainer?: StepExplainer; report: ItemReport }> {
  const report: ItemReport = { kind: "explainer", id: misconceptionId, passed: false, reasons: [], checks: [] };
  const m = graph.misconceptions.get(misconceptionId)!;
  const c = graph.get(m.concept_id);
  const gen = await llm.generateObject("write_explainer", { system: EXPLAINER_SYSTEM, prompt: explainerPrompt(graph, misconceptionId), schema: ExplainerGenSchema, ...overrides(genModel), ...fresh() });
  gen.data = repaired(gen.data);
  const g: ExplainerGen = gen.data;
  const maths = isMaths(c.subject);
  const cas = maths && g.check.mode !== "none" && g.check.compute ? { mode: g.check.mode, symbols: g.check.symbols, compute: g.check.compute } : undefined;
  const draft: Omit<StepExplainer, "verification"> = {
    schema_version: "1.0",
    misconception_id: misconceptionId,
    concept_id: c.id,
    subject: c.subject,
    title: g.title,
    steps: g.steps.map((s) => ({
      kind: s.kind,
      say: s.say,
      ...(s.math ? { math: s.math.replace(/^\$+|\$+$/g, "") } : {}),
      ...(cas && s.sympy && s.expect ? { cas: { expr: s.sympy, expect: s.expect } } : {}),
    })),
    takeaway: g.takeaway,
    ...(cas ? { cas } : {}),
    provenance: { generator: { provider: gen.provider, model: gen.model }, generated_at: new Date().toISOString(), prompt_version: EXPLAINER_PROMPT_VERSION },
  };
  const structure = checkExplainerStructure(draft, graph);
  report.checks.push({ method: "structure", passed: structure.length === 0, detail: structure.length ? structure.join("; ") : "starts from the wrong step, states the correct idea" });
  report.reasons.push(...structure);
  if (report.reasons.length === 0) {
    const check = casVerify(draft.cas, draft.steps.flatMap((s) => (s.cas ? [s.cas] : [])), maths);
    if (check) {
      report.checks.push(check);
      if (!check.passed) report.reasons.push(check.detail);
    }
  }
  if (report.reasons.length === 0) {
    const rev = await llm.generateObject("review_lesson", { system: REVIEW_EXPLAINER_SYSTEM, prompt: explainerReviewPrompt(graph, misconceptionId, g), schema: ExplainerReviewSchema, ...overrides(reviewModel) });
    const v = rev.data;
    const problems: string[] = [];
    if (!v.wrong_step_shows_misconception) problems.push("wrong step doesn't show the misconception");
    if (!v.all_steps_correct) problems.push("a step is incorrect");
    if (!v.builds_from_wrong_to_right) problems.push("doesn't build from the wrong step to the right idea");
    if (rev.model === gen.model) problems.push(`reviewer was the generator's model (${rev.model}); need an independent model`);
    report.checks.push({ method: "llm_review", passed: problems.length === 0, model: rev.model, detail: `${problems.length ? problems.join("; ") : "wrong step, correctness and progression confirmed"}; reviewer issues: ${v.issues}` });
    report.reasons.push(...problems);
    if (problems.length === 0) {
      const explainer = StepExplainerSchema.parse({
        ...draft,
        verification: { status: "verified", checks: report.checks, verified_at: new Date().toISOString() },
        provenance: { ...draft.provenance, reviewer: { provider: rev.provider, model: rev.model } },
      });
      report.passed = true;
      return { explainer, report };
    }
  }
  return { report };
}

// ---------------------------------------------------------------- saving

function save(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

interface ReportFile {
  generated_at?: string;
  items: (ItemReport & { at: string })[];
}

function mergeReport(path: string, item: ItemReport): void {
  const file: ReportFile = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ReportFile) : { items: [] };
  const old = file.items.find((x) => x.kind === item.kind && x.id === item.id);
  if (old?.passed && !item.passed) {
    // Keep the passing entry, but log the failed retry beside it.
    file.items.push({ ...item, id: `${item.id} (failed retry)`, at: new Date().toISOString() });
  } else {
    file.items = [...file.items.filter((x) => !(x.kind === item.kind && x.id === item.id)), { ...item, at: new Date().toISOString() }];
  }
  file.items.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  save(path, { generated_at: new Date().toISOString(), items: file.items });
}

async function main() {
  const only = value("only")?.split(",").filter(Boolean);
  const match = (id: string) => !only || only.some((o) => id.includes(o));
  const doRecaps = !flag("explainers") || flag("recaps");
  const doExplainers = !flag("recaps") || flag("explainers");
  const lib = loadLessons(config, graph);
  let recaps = doRecaps ? recapTargets().filter((r) => match(r.id)) : [];
  let explainers = doExplainers ? explainerTargets().filter(match) : [];
  if (flag("missing")) {
    recaps = recaps.filter((r) => !recapFor(lib, r));
    explainers = explainers.filter((m) => !lib.explainers.has(m));
  }
  if (flag("list")) {
    for (const r of recaps) console.log(`recap      ${r.id.padEnd(34)} ${recapModeFor(r).padEnd(16)} ${recapFor(lib, r) ? "have" : "-"}`);
    for (const m of explainers) console.log(`explainer  ${m.padEnd(50)} ${lib.explainers.has(m) ? "have" : "-"}`);
    console.log(`${recaps.length} recaps, ${explainers.length} explainers`);
    return;
  }
  const llm = createLlmClient({ repoRoot });
  const genModel = value("model");
  const reviewModel = value("review-model");
  const genCfg = resolveTaskConfig(llmConfig, "write_recap", genModel ? { model: genModel } : undefined);
  const revCfg = resolveTaskConfig(llmConfig, "review_lesson", reviewModel ? { model: reviewModel } : undefined);
  if (genCfg.model === revCfg.model) console.warn(`Warning: generator and reviewer are both ${genCfg.model}; every item will be rejected. Pass --review-model.`);
  const reportPath = join(config.explainersDir, "_generation-report.json");
  const recapReportPath = join(config.recapsDir, "_generation-report.json");

  type Job = () => Promise<void>;
  const jobs: Job[] = [
    ...recaps.map((r): Job => async () => {
      try {
        const { recap, report } = await makeRecap(llm, r, genModel, reviewModel);
        if (recap) save(join(config.recapsDir, `${r.id}.json`), { ...(recap.provenance.sample_data ? { notice: SAMPLE_DATA_NOTICE } : {}), recap });
        mergeReport(recapReportPath, report);
        console.log(`recap ${r.id} (${report.mode}): ${report.passed ? "verified" : `rejected: ${report.reasons.join("; ")}`}`);
      } catch (e) {
        console.log(`recap ${r.id}: failed: ${(e as Error).message.slice(0, 300)}`);
      }
    }),
    ...explainers.map((m): Job => async () => {
      try {
        const { explainer, report } = await makeExplainer(llm, m, genModel, reviewModel);
        if (explainer) save(join(config.explainersDir, explainer.subject.toLowerCase(), `${m}.json`), { explainer });
        mergeReport(reportPath, report);
        console.log(`explainer ${m}: ${report.passed ? "verified" : `rejected: ${report.reasons.join("; ")}`}`);
      } catch (e) {
        console.log(`explainer ${m}: failed: ${(e as Error).message.slice(0, 300)}`);
      }
    }),
  ];
  const concurrency = Math.max(1, Number(value("concurrency") ?? 2));
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < jobs.length) await jobs[next++]!();
    }),
  );
  const after = loadLessons(config, graph);
  console.log(`\nLibrary: ${after.recaps.size} recaps, ${after.explainers.size} explainers.`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
