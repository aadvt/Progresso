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

---

## Phase 4: Knowledge constellation (2026-11-21) ✅

Report: [phase-4-report.md](phase-4-report.md). Screenshots and frame-rate JSON: [screenshots/phase-4/](screenshots/phase-4/).

**Built**
- Core `src/constellation/`: a deterministic layout (a disc per subject; foundations at the core, Class 11 then Class 12 at the rim; units as sectors ordered to keep threads short), `buildConstellation()` (star states from the analysis plus DB mastery: root, weak, learning, mastered, unassessed, plus `lit` downstream of a mastered root), and the ripple helpers (browser entry `@progresso/core/constellation/client`).
- DB: `getConceptMastery` / `setConceptMastery` / `clearConceptMastery` and `ensureDemoData()`. The web app now opens the DB (it auto-migrates and seeds the demo students).
- Web: `/s/[id]/constellation` (full screen: toolbar, "Your roots", focus panel with verbatim evidence and why it matters, demo trigger) and a live preview in the diagnosis slot.
  - A three.js renderer: instanced stars, shader-driven threads and ripple, no post-processing.
  - An SVG 2D fallback, chosen for no WebGL, weak devices, Data Saver, or a measured frame rate below 24 fps. The pixel ratio adapts first.
  - Reduced motion supported.

**Results**
- 60 fps on desktop and the phone viewport. With the CPU 4× slower: 60 / 58 fps, and 49 / 60 fps during the ripple (Intel UHD; see the report for caveats). All fallback paths tested in e2e.

**Decisions later phases rely on**
- Missions (Phase 5) and the MCP server (Phase 10) update the map just by writing `concept_mastery`. A root going to `proven` plays the chain reaction on the next render.
- Mastery is an overlay on the report-based diagnosis; roots are never removed by it.

**Open items**
- Verify on a physical mid-range Android phone. Unit labels may need a zoom threshold on the full graph. If the ripple gets heavy on the full graph, move per-star blending into the shader.

---

## Phase 5: Missions, prove-it questions, mastery, readiness (2026-11-21) ✅ (structure; question data to follow)

Report: [phase-5-report.md](phase-5-report.md). Simulation: [phase-5-simulation.md](phase-5-simulation.md). Screenshots: [screenshots/phase-5/](screenshots/phase-5/).

**Built**
- Core `src/missions/`:
  - `buildPlan()`: a pure, deterministic day-by-day plan of 25-minute missions back from the exam date. Roots go by marks per hour, deepest root first; learn the root, then apply it per symptom topic; one-offs after the roots; FSRS reviews interleaved; buffer days before the exam.
  - The plan re-flows by recomputation from progress (skips, early mastery, retries, then needs-help and parking; untestable topics are "studied, not proven").
  - Also: the mastery gate with FSRS (ts-fsrs, max interval 14 days) and `computeReadiness()` (always a range, labelled Estimate, with a weightage fallback).
- Core `src/questions/`: the prove-it schema (every wrong option carries a `misconception_id`), server-side grading, selection and the bank loader.
- CLI `questions:generate`: LLM generation, then a SymPy check (`tools/cas/check.py`), then an independent LLM solve. Saves per target; `--missing` tops up. CLI `simulate` runs N days of missions on a throwaway DB.
- DB: plan settings, per-slot missions, question attempts, FSRS cards. `startMission` / `answerQuestion` / `finishMission` write `concept_mastery`, so the map's ripple fires.
- Web: Today (mission, progress, readiness meter, demo clock), mission player (recap → explainer → prove it → result, KaTeX, misconception-specific feedback), Plan timeline, and student tabs.

**Results**
- 162 unit tests. 33 e2e tests pass on desktop and phone (full mission with a fail → re-flow → retry → proven → ripple; no-questions path; habits-only); axe clean.
- The 14-day simulation shows the gate refusing a repeated report mistake, the ripple on day 2, a skipped day absorbed, an FSRS review, and readiness 93.0 → 97.0 mid.
- Question bank: **9 verified of 10 generated over 3 misconceptions** (maths and chemistry), all checked by hand. The ≥10-misconception target is deferred: Gemini outage, memory, then free-tier quota. Data to be added with `pnpm questions:generate --missing`.

**Decisions later phases rely on**
- Store progress, never plans. `nextMission(buildPlan(...))` is the answer to "what tonight?" (Phase 10).
- Phase 6 fills the recap and explainer `content` (placeholders now); the structure and timings are fixed.
- The bank is data in `data/question-bank/`; every screen copes with none.

**Open items**
- Fill the bank (34 targets), ideally with a second model for the chemistry second opinion (it currently uses the same model with a different method).
- Re-tune readiness on real reports (absolute levels are high on sparse fixtures).

---

## Phase 6: Mistake Recap and step explainers (2026-11-23) ✅

Report: [phase-6-report.md](phase-6-report.md). Screenshots: `docs/screenshots/phase-6/` (local only).

**Built**
- Core `src/lessons/`: recap and explainer schemas, structure checks (own working must reproduce the report's quote exactly; typical steps can't use handwriting), a file library with stale-recap detection. Browser entry `@progresso/core/lessons/client`.
- CLI `lessons:generate`: LLM generation, then structure checks, SymPy, and an independent review on a different model. Rejects are logged, nothing is saved for them.
- Web: Mistake Recap in mission step 1 (handwritten own working with the error circled, or a printed typical step labelled "Not your working"; then the fix line by line and the key idea; exam, question and marks lost on top; skippable, replayable, reduced motion). Step explainer in step 2 (a board, narration, auto-play, step controls; formulas shrink to fit on a phone). A Replays page per student.

**Results**
- 11 verified recaps (7 from the student's quoted working, 4 typical steps) and 6 verified explainers (3 maths, 3 chemistry), each read against its report or misconception. All 11 recaps were correct. 4 explainers had factual slips that the automatic review missed (3 chemistry, 1 maths); their text was corrected after verification and is listed in the report for confirmation.
- 174 unit tests; 37 e2e tests pass on desktop and phone (axe clean), including a no-overflow check on every explainer board.

**Decisions later phases rely on**
- `student_working` alone decides the recap mode (Phase P parser). Manim videos (Phase 7) sit on top of the step explainer, which stays the fallback.

**Open items**
- Confirm the 4 hand edits; add a second-vendor or human reviewer for chemistry content.
- Fill the remaining 30 recaps and 27 explainers (`--missing`; Gemini returned 503s this session).
- Allow `.subs()` in the CAS checker; render `adj` and chemical formulas upright.


---

## Phase 7: Manim explainer videos (2026-11-23) ✅

Report: [phase-7-report.md](phase-7-report.md). Sample frames: [phase-7/](phase-7/). Screenshots: `docs/screenshots/phase-7/` (local only).

**Built**
- CLI `videos:generate` (offline, one video per misconception, most frequent first):
  - storyboard of 60–120 s, starting from the wrong step and built on the verified step explainer;
  - Manim code on a shared base scene;
  - a capped quality loop, each failure fed back to the code generator: safety lint → render → duration → measured layout audit → Gemini vision check of frames taken at still moments;
  - output: web MP4, poster, WebVTT and code, plus `data/videos/manifest.json`.
- `videos:review` records hand verdicts; a rejected video is never served.
- Narration is optional, behind `NarrationProvider` (captions only for now).
- Core `src/videos/`: schemas, `loadVideoLibrary`, `rankMisconceptions`, `isServable`, `captionsToVtt`.
- LLM layer: image inputs (Gemini, Anthropic, OpenAI-compatible), task `write_storyboard`, a hard Gemini deadline, and fallback instead of sleeping on long quota waits.
- Web:
  - `/media/videos/…` (manifest-only, byte ranges);
  - the mission player shows the video as the explainer, with the step explainer behind "Prefer to go step by step?" and as the fallback (no video, or the file fails to load);
  - Replays lists the videos.

**Results**
- 6 maths misconceptions run (there is no physics in the provisional graph). 5 passed, with 0–2 fix iterations each; 1 stopped on the free-tier quota (retry with `--missing`).
- Every frame of every passing video checked by hand: 4 correct as made, 1 rejected (a correct line crossed out, missed by the frame check), then remade and approved. The frame-check prompt was tightened, and in the remake it caught a missing + C.
- Fallback confirmed in e2e on desktop and phone.

**Decisions later phases rely on**
- Videos are per misconception and data-only (`data/videos/`); every screen copes with none.
- `isServable()` is the single gate; switching to "approved only" is a one-line change.

**Open items**
- Hand review before serving (1 in 5 automatic passes was wrong). Bigger formulas for phones. Remaining misconceptions once the quota resets. Chemistry-specific checks.
