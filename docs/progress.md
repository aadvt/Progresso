# Progress log

Running log. Every phase appends an entry when its verification gate passes: what was built, the decisions that matter to later phases, and open items.

---

## Phase 1: Foundation (2026-11-21) ✅

Report: [phase-1-report.md](phase-1-report.md)

**Built**
- pnpm TypeScript monorepo: `@progresso/core` (domain), `@progresso/llm` (LLM layer), `@progresso/db` (SQLite + Drizzle).
- Error-record format v1.0 (`docs/error-record-format.md`): the parser → engine contract.
- Provisional concept graph: Mathematics (69 concepts) and Chemistry (50 concepts), down to Class 9–10 roots. Validated loader (unique ids, no dangling prerequisites, no cycles).
- LLM layer: per-task routing (`config/llm.json`), Gemini default, Anthropic and OpenAI-compatible optional; structured output with zod validation and repair; RPM limiter; retry with backoff; model fallback; file cache keyed by input hash; JSONL usage log; PII guard.
- DB schema for students, exams, reports, error records, concept mappings, graph cache, and foreseen diagnoses / missions / mastery (FSRS fields) / review log.
- 4 demo students (SAMPLE DATA), 42 error records, plus an answer key of intended roots for Phase 2 tests.

**Decisions later phases rely on**
- Default model `gemini-3.8-flash`, falling back to `gemini-3.6-flash`. 3.8 returned 503/504 under load during Phase 1; the fallback answered.
- Fixture records map to the concept the question *tested* (symptom), never to the root. Phase 2 must find roots by traversing the graph.
- Concept mappings are soft references tagged with a graph fingerprint, so a graph swap never deletes student data.
- Ranking input "marks recoverable" comes from `marksLost(record)`. Many records won't have marks, so Phase 2 needs a fallback weight.

**Open items**
- Phase 2: root-cause engine, tested against `data/fixtures/_answer-key/expected-roots.json`.
- Rate limiting is per process. If the web app and MCP server ever run LLM-heavy work at the same time, move the limiter to the DB.

---

## Phase 2: Root-cause engine (2026-11-21) ✅

Report: [phase-2-report.md](phase-2-report.md)

**Built**
- `analyseStudent({ graph, records, mastery?, params? })` in `@progresso/core` (`src/root-cause/`): finds the smallest set of root gaps that best explains a student's errors across exams and subjects, and ranks them by marks recoverable per study hour. Returns roots (explained errors with prerequisite paths, confidence, marks lost/estimated, board marks resting on it, study hours/missions, branch coverage, counter-evidence, close alternatives, plain-language explanation), standalone errors, habit patterns and a headline.
- Explainable scoring: error-type weights (slips 0 → habits), per-step decay up the graph, fixed root cost plus a branch-coverage cost, same-exam repeat discount, recency, counter-evidence from slips and optional `MasteryEvidence`. Greedy + add/remove/swap/split search with exact upper-bound pruning. All tunables in `params.ts`.
- `wordExplanations()` re-words explanations through the LLM layer (task `explain`, cached, PII-guarded, template fallback). Core doesn't depend on `@progresso/llm`.
- `pnpm analyse <student-id> | --all [--json] [--llm]` in a new `apps/cli` package.

**Results**
- Demo students: 4/4 match the answer key exactly (roots, explained records, standalones).
- Scale: 40 random 600-concept graphs, 104/110 planted roots recovered, 2 false roots in total, median 1.1 ms per student; 150-error student in ~180 ms.

**Decisions later phases rely on**
- The engine depends only on error records + graph; output types in `root-cause/types.ts` are what the web app (Phase 3) and MCP server (Phase 10) render.
- `MasteryEvidence` is the way to tell the engine a concept works. Phase 5 should feed passed "prove it" checks into it; the Phase P parser should emit report-stated strengths as it.
- Ranking = confidence × (marks lost + 0.1 × board marks resting on the root) / study hours. How much future board weight should count is an open product question (see Kabir in the report).

**Open items**
- Re-check parameters on real reports in Phase P (ideally against teacher-labelled roots).
- Provisional-graph gaps found: multiple-angle formulae → trig limits and inverse-trig simplification; chain rule ↔ composite exp/log derivatives.
- UI should cap the list of roots for very noisy students and lead with the report's own words when the graph path is long.

---

## Phase 3: Web app and diagnosis view (2026-11-21) ✅

Report: [phase-3-report.md](phase-3-report.md). Screenshots: [screenshots/phase-3/](screenshots/phase-3/).

**Built**
- `apps/web` (Next.js 16, React 19): student picker → "Add exam report" (paste/upload, live parse progress) → diagnosis (headline "Fix N things → explains X of Y errors → ~Z marks", expandable root cards with a "how one gap spreads" tree of the report's verbatim evidence, one-offs, habits, original-report sheet, comeback-plan placeholder, constellation slot).
- Core: `ReportParser` interface with streamed stages (`@progresso/core/report-parser`), `DemoFixtureParser` (SAMPLE DATA, never reads pasted text and says so), `buildDiagnosisView()` view model.
- Design system "light threads": tokens in `apps/web/src/styles/tokens.css`, glass `ui/` components, one motif (blue→teal thread = cause → effect).
- Playwright e2e (desktop + phone) with axe WCAG 2.1 AA checks, keyboard-only and reduced-motion tests; `pnpm e2e`.

**Decisions later phases rely on**
- Phase P swaps `getReportParser()` and `getDiagnosis()` in `apps/web/src/server/data.ts`; nothing else in the web app touches fixtures.
- Phase 4 fills `ConstellationSlot` (`[data-slot="constellation"]`); Phase 5 replaces `PlanDialog`; Phase 10 reuses `buildDiagnosisView`.
- Client components import only types from `@progresso/core`; runtime constants use browser-safe subpaths.

**Open items**
- `docs/design-reference/` and `docs/report-format.md` referenced by the brief don't exist; design followed the written brief.
- Report-added state is a cookie (no logins); move to DB in Phase P. Upload is text-only. No cap yet on very many roots. LLM re-wording not wired into the web app.
