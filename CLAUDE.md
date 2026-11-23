# Progresso

Prototype for **Inferentics** (edtech). Inferentics already scans CBSE Class 11–12 answer sheets and produces a long, text-heavy AI diagnosis report per student. Students don't act on those reports. Progresso turns one into a short, personal, automated plan that gets the student ready before their next exam.

(Working title was "LearnOS". The repo is `aadvt/Progresso`; packages are scoped `@progresso/*`.)

**The core loop every feature serves:** Diagnose → find the ROOT gap → fix it in small daily missions → prove it's fixed → keep it fixed until exam day.

## Scope rules (apply to every phase)

1. **The AI report text is our only input.** No scans, images or original papers, ever. We never re-diagnose the student: the report's diagnosis is the source of truth. Our job is to restructure it faithfully and make the most of it.
2. **No OAuth, no logins, no third-party accounts.** Demo students are picked from a list. Integrations are simulated or use no-auth mechanisms (.ics export, prefilled links), behind clean interfaces so real integrations can be added later.
3. **LLM: Google Gemini Flash via the Gemini API is the default for every task**, behind the swappable provider layer in `packages/llm`. Never call an LLM SDK directly from app code.
4. **Only anonymised data goes to any external API.** Students are pseudonymous ids; display names never enter prompts. **Never present invented content as a student's own work**: `student_working` exists only when the report quotes it.
5. **No reports yet, and we never fake them.** The parser is built in Phase P.
   - Everything downstream (root-cause engine, missions, UI, MCP) depends only on the **error-record format** (`packages/core/src/error-record/schema.ts`, documented in `docs/error-record-format.md`), never on report text. The parser will be an adapter that produces error records.
   - Until then the UI runs on **demo fixtures**: hand-written structured error records (not report text). They live only in `data/fixtures/` (plus the loader and demo parser `packages/core/src/demo-fixtures/`, `packages/db/src/seed.ts`, and the web data seam `apps/web/src/server/data.ts`), are labelled SAMPLE DATA everywhere they appear, and are deleted in Phase P.
6. **The concept graph is provisional.** The full CBSE 11–12 graph arrives in Phase P in the same format. All code treats the graph as data loaded from files and must work unchanged when it is replaced. **Never hard-code concept ids** in source (ESLint enforces this; tests are exempt).
7. Never commit secrets (`.env`) or anything under `data/reports/`.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation, LLM layer, error-record format, provisional concept graph, demo fixtures | done |
| 2 | Root-cause engine: trace errors through the prerequisite graph to the few root gaps that explain most mistakes, ranked by marks recoverable | done |
| 3 | Web app with the diagnosis view | done |
| 4 | 3D "knowledge constellation" (three.js) of the syllabus, with a chain-reaction ripple when a root is fixed | done |
| 5 | Mission engine: 25-min daily missions, "prove it" questions whose wrong options come from the student's own mistakes, mastery gating, spaced repetition (FSRS), readiness meter | done |
| 6 | Mistake Recap (the student's mistake, marked and corrected) and in-browser step explainers | done |
| 7 | Manim explainer animation pipeline | done |
| 8 | Precise YouTube clips and 3D organic chemistry | |
| 9 | Calendar autopilot (in-app calendar + .ics export) and simulated WhatsApp nudges | |
| 10 | MCP server + MCP App widget ("what should I study tonight?" answered inline in Claude) | |
| 11 | End-to-end polish and final verification | |
| P | When real reports arrive: report parser, full concept graph, swap fixtures for real data | |

Progress log: `docs/progress.md`. Phase reports: `docs/phase-N-report.md`.

## Architecture

pnpm TypeScript monorepo. Domain logic is UI-independent because both the web app (Phase 3) and the MCP server (Phase 10) use it.

```
packages/
  core/   @progresso/core  domain: config, concept graph (schema, loader, validator, queries),
                            error-record schema, student/exam types, root-cause engine (root-cause/),
                            report-parser interface, diagnosis view model (diagnosis-view/),
                            constellation layout + state model + ripple (constellation/; browser
                            entry ./constellation/client), mission engine (missions/: plan generator,
                            mastery gate + FSRS, readiness; browser entry ./missions/client), prove-it
                            questions (questions/: schema, grading, selection, bank loader), lesson content
                            (lessons/: Mistake Recap + step explainer schemas, structure checks, library;
                            browser entry ./lessons/client), explainer videos (videos/: storyboard + manifest
                            schemas, library loader, misconception ranking, WebVTT).
                            ./demo-fixtures entry = SAMPLE DATA loader (deleted in Phase P)
  llm/    @progresso/llm   provider-agnostic LLM layer: per-task routing, Gemini/Anthropic/
                            OpenAI-compatible providers, structured output + repair, rate limit,
                            retry/backoff, model fallback, response cache, usage log, PII guard
  db/     @progresso/db    SQLite (better-sqlite3 + Drizzle): schema, migrations, graph sync, seed,
                            concept mastery (mastery.ts: what drives the constellation), mission
                            service (missions.ts: plan settings, start/answer/finish, progress)
apps/
  cli/    @progresso/cli   command-line tools needing several packages (pnpm analyse, questions:generate,
                            lessons:generate, videos:generate/review, simulate)
  web/    @progresso/web   Next.js 16 app: picker, add report, diagnosis, today / plan / mission player
                           (components/missions, server/missions.ts; explainer video with step-explainer fallback,
                           served by app/media/videos), constellation (components/
                           constellation: three.js engine/ + SVG Map2D fallback). server/data.ts is the only
                           data seam (parser, records, mastery via server/db.ts); styles/tokens.css +
                           components/ui = design system; e2e/ = Playwright + axe + perf. MCP server (Phase 10) to come
config/
  app.json                 paths: concept graph dir, DB, fixtures, LLM cache, usage log
  llm.json                 per-task LLM routing (provider, model, fallbacks, limits, thinking)
data/
  concept-graph-provisional/  provisional graph, one JSON per subject (format is fixed)
  fixtures/demo/              SAMPLE DATA demo students (structured error records)
  fixtures/_answer-key/       intended roots per demo student (tests only, never read by the engine)
  fixtures/demo-recaps/       SAMPLE DATA Mistake Recaps, one per error record (deleted with the fixtures in Phase P)
  explainers/                 verified step explainers, <subject>/<misconception_id>.json (_generation-report.json)
  videos/                     explainer videos: manifest.json + mathematics/<misconception_id>.{mp4,jpg,vtt,py}
  question-bank/              verified prove-it questions, one JSON per misconception (generated offline;
                              _generation-report.json = what was generated and rejected)
  reports/                    real reports (Phase P), git-ignored, never committed
  progresso.db, cache/, logs/ local runtime state, git-ignored
tools/cas/check.py            SymPy checker for generated maths questions (allow-listed parsing)
tools/manim/                  progresso_manim.py (base scene: palette, caption band, layout audit) + lint.py
                              (allow-list check of generated Manim code before it runs)
docs/                         progress log, phase reports, error-record format
```

Key contracts:
- **Error record** (`ErrorRecordSchema`): the parser → engine contract. See `docs/error-record-format.md`.
- **Concept graph files**: `{ subject, syllabus_source, units[], concepts[] }`, validated by `loadConceptGraph()` (unique ids, no dangling prerequisites, no cycles). Switching to the full graph is the one-line `conceptGraphDir` change in `config/app.json` (or `CONCEPT_GRAPH_DIR`).
- **Root-cause engine**: `analyseStudent({ graph, records, mastery?, params? })` → `RootCauseAnalysis` (`packages/core/src/root-cause/types.ts`). Pure and deterministic; every tunable in `root-cause/params.ts`. The LLM may only re-word its explanations (`wordExplanations`, task `explain`).
- **Report parser**: `ReportParser.parse(input, { graph, onProgress })` → `ParsedReport` (`packages/core/src/report-parser/`). Demo implementation `DemoFixtureParser` (SAMPLE DATA) until Phase P.
- **Diagnosis view**: `buildDiagnosisView(analysis, records)` → `DiagnosisView`, what the UI renders (report text stays verbatim).
- **Constellation**: `layoutConstellation(graph, subjects)` (cached per graph) + `buildConstellation({ graph, layout, analysis, records, mastery })` → `ConstellationModel`. Star state comes from `concept_mastery` in the DB: write it with `setConceptMastery()` and the map updates (a root going to `proven` plays the ripple).
- **Missions**: `buildPlan({ graph, analysis, records, settings, today, progress })` → `ComebackPlan` (pure; re-run after any change and it re-flows). Mastery gate `gradeCheck` + `applyCheck` (FSRS via ts-fsrs, max interval 14 days), readiness `computeReadiness` (always a range). Persistence and orchestration: `@progresso/db` `startMission` / `answerQuestion` / `finishMission` (writes `concept_mastery`, so the constellation updates). Tunables in `missions/params.ts`.
- **Prove-it questions**: `ProveItQuestionSchema` (`questions/schema.ts`): every wrong option carries a `misconception_id`. Only verified questions enter `data/question-bank/` (`pnpm questions:generate`); nothing is generated at runtime. The browser never receives the answer key.
- **Lesson content**: `MistakeRecapSchema` (per record; mode `student_working` only when the report quotes the working, and then its lines must reproduce the quote exactly, checked by `checkRecapStructure`; otherwise `typical_step`, labelled "Not your working") and `StepExplainerSchema` (per misconception, starts from the typical wrong step). Generated offline by `pnpm lessons:generate` (structure → SymPy → independent review on a different model), loaded with `loadLessons()` / `recapFor()` (stale recaps ignored via `source_hash`). Nothing generated at runtime.
- **Explainer videos**: one per misconception, made offline by `pnpm videos:generate` (storyboard → Manim code →
  lint → render → duration → layout audit → Gemini frame check; failures fed back, attempts capped). Listed in
  `data/videos/manifest.json` (`VideoEntrySchema`). Served only when `isServable()` (passed, not rejected on hand
  review via `pnpm videos:review`); otherwise the mission player shows the step explainer. Narration is optional
  behind `NarrationProvider` (only `none` now). Needs Manim CE, LaTeX (MiKTeX) and ffmpeg.
- **LLM calls**: `createLlmClient().generateObject(task, { prompt, schema, images? })` or `.generateText(task, ...)`. The task name picks provider/model from `config/llm.json`.

## Conventions

- TypeScript strict, ESM, `moduleResolution: Bundler`. Packages export TS source directly (no build step); scripts run with `tsx`.
- zod for every external boundary (files, LLM output, config). Schemas are strict: unknown keys are errors.
- Ids: lowercase dotted (`math.chain_rule`, misconception `math.chain_rule.m1`, unit `m12.calculus`).
- Domain code takes the `ConceptGraph` as a parameter; it never imports graph files or fixture files directly.
- Each LLM task gets a name in `LLM_TASKS` (`packages/llm/src/config.ts`) and an entry in `config/llm.json`.
- Tests live in `packages/*/test`, run with vitest from the root. Web e2e tests live in `apps/web/e2e` (Playwright).
- Web: client components import only *types* from `@progresso/core` (its index uses `node:fs`); use design tokens, never raw colours; mark sample data with `SampleDataBadge`.
- **Every phase ends with:** its verification gate passing (`pnpm verify` plus the phase's own checks), a phase report in `docs/phase-N-report.md`, an entry in `docs/progress.md`, and a git commit.

## How to run

Prereqs: Node ≥ 22.12 (developed on 24), pnpm 10.

```bash
pnpm install
cp .env.example .env        # then set GEMINI_API_KEY (Google AI Studio)

pnpm verify                 # typecheck + lint + tests + graph validation
pnpm graph:validate         # validate the configured concept graph and print stats (--json for JSON)
pnpm analyse demo-riya      # root-cause analysis for a student (--all, --json, --llm to word explanations via the LLM)
pnpm web:dev                # web app at http://localhost:3100
pnpm e2e                    # production build + Playwright e2e (desktop + phone, axe, then frame-rate runs); screenshots to docs/screenshots/ (local only, git-ignored)
pnpm questions:generate     # generate + verify prove-it questions into data/question-bank (LLM + SymPy; needs Python 3 with sympy)
                            # --missing tops up targets with no verified questions; --only a,b; --list; saves per target
pnpm lessons:generate       # generate + verify Mistake Recaps and step explainers (--recaps/--explainers, --missing, --only, --list,
                            # --model M --review-model R: the reviewer must be a different model)
pnpm videos:generate        # explainer videos for the top 5 maths/physics misconceptions (--top, --only, --subjects, --missing,
                            # --list, --max-attempts, --fresh, --narration); needs manim, latex, dvisvgm, ffmpeg on PATH
pnpm videos:review --list   # hand-review verdicts; <id> --approve|--reject "notes" (rejected = never served)
pnpm simulate demo-riya     # simulate 14 days of missions on a throwaway DB (--days, --minutes, --skip, --out)
pnpm db:seed                # migrate, sync graph, load demo fixtures, print per-student summary
pnpm db:reset               # delete the local DB (then db:seed)
pnpm llm:smoke              # one real structured Gemini call, then the same call from cache
pnpm llm:usage              # token usage per task from data/logs/llm-usage.jsonl
pnpm db:generate            # after editing packages/db/src/schema.ts: write a new SQL migration
```

Switching LLMs: edit `config/llm.json` (per task), or set env `LLM_PROVIDER`/`LLM_MODEL` (all tasks) or `LLM_TASK_<TASK>_PROVIDER`/`_MODEL` (one task). Providers: `gemini` (default), `anthropic` (needs `ANTHROPIC_API_KEY`), `openai_compatible` (e.g. local Ollama at `OPENAI_COMPAT_BASE_URL`).
