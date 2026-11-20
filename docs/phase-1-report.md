# Phase 1 report: Foundation

**Status:** verification gate passed · **Date:** 2026-11-21

## What was built

| Area | Where | Summary |
|---|---|---|
| Monorepo | root | pnpm workspaces, TypeScript strict, ESLint (flat config), vitest. `pnpm verify` runs the whole gate. |
| Domain core | `packages/core` | Config loader, concept-graph schema, loader, validator and query API (`ConceptGraph`), error-record schema, student/exam types, demo-fixture loader (isolated entry point). |
| LLM layer | `packages/llm` | One client for every LLM call, routed per task. Gemini (default), Anthropic and OpenAI-compatible providers. Structured output with repair, rate limiting, retry with backoff, model fallback, input-hash cache, per-task token log, PII guard. Smoke test CLI. |
| Database | `packages/db` | SQLite via better-sqlite3 + Drizzle. 14 tables, a committed SQL migration, graph sync, fixture seeding, per-student summary. |
| Concept graph | `data/concept-graph-provisional/` | Mathematics and Chemistry, in the required format. |
| Demo fixtures | `data/fixtures/demo/` | 4 sample students, 42 structured error records, answer key in `data/fixtures/_answer-key/`. |
| Docs | `CLAUDE.md`, `docs/` | Vision, scope rules, roadmap, architecture, conventions; error-record format; progress log; this report. |

## How to run

```bash
pnpm install
cp .env.example .env          # GEMINI_API_KEY=...
pnpm verify                   # typecheck + lint + 65 tests + graph validation
pnpm graph:validate           # stats (add --json for machine-readable)
pnpm db:seed                  # migrate + sync graph + load fixtures + per-student summary
pnpm llm:smoke                # real Gemini call, then the same call served from cache
pnpm llm:usage                # tokens per task
```

## Stack choice

The suggested TypeScript monorepo, kept deliberately thin:

- **pnpm workspaces, no build step.** Packages export TypeScript source; `tsx`, vitest and (in Phase 3) Next.js `transpilePackages` consume it directly. One language end to end (web, MCP server, domain), and the MCP TypeScript SDK and three.js are first-class there.
- **zod 4** at every boundary: graph files, error records, fixtures, LLM config, LLM output. `z.toJSONSchema` turns the same schemas into the JSON Schema we send to Gemini, so one definition drives both the request and the validation.
- **SQLite via better-sqlite3 + Drizzle.** Synchronous, zero-config, a single file, with typed queries and plain SQL migrations committed to git. better-sqlite3 installs from a prebuilt binary on Node 24/Windows (checked). Postgres stays a later swap if ever needed.
- **`@google/genai` 3.6** (the current official SDK; `@google/generative-ai` is deprecated), **`@anthropic-ai/sdk`**, and plain `fetch` for OpenAI-compatible servers (no SDK needed for Ollama).
- **TypeScript 5.9, not 7.** TS 7 (the native compiler) is out, but typescript-eslint only supports TS < 6.1.

## The error-record format

Full spec: [error-record-format.md](error-record-format.md). In short:

- **Required:** `schema_version`, `id`, `student.id` (pseudonymous), `exam {id, name, date, subject}`, `question.ref`, `diagnosis.text` (verbatim report wording), `error_type`, `concepts[]` (may be empty), `provenance`.
- **Optional because reports will vary:** question text, the report's own error label, the student's working (only as a quote from the report), marks (any subset of lost/awarded/max, with consistency checks), correct approach, misconception match, notes.
- **Taxonomy:** conceptual, procedural, calculation, careless, notation, incomplete, unattempted, unclassified. This splits `calculation` out of `careless` and adds `incomplete`/`unattempted`, because they call for different remediation.
- **Re-mappable:** every concept mapping records `mapped_by` and the graph fingerprint. Mappings are soft references in the DB.

## Concept graph stats (`pnpm graph:validate`)

Fingerprint `4fa756f80ab6`. All checks pass: schema, unique ids, unit ids, prerequisite ids exist, no cycles. No warnings.

| Subject | Units | Concepts | Prereq. edges | Misconceptions | Roots | Leaves | Max depth | By class |
|---|---|---|---|---|---|---|---|---|
| Chemistry | 12 | 50 | 93 | 49 | 2 | 13 | 10 | 9:1 · 10:3 · 11:30 · 12:16 |
| Mathematics | 9 | 69 | 105 | 77 | 5 | 18 | 12 | 9:6 · 10:5 · 11:24 · 12:34 |
| **Total** | 21 | **119** | **198** | **126** | 7 | 31 | 12 | |

- **Deepest chain (12 edges):** sets → functions → standard functions → idea of a limit → algebraic limits → first principles → standard derivatives → **chain rule** → inverse-trig derivatives → standard integrals → substitution → variable-separable DEs → homogeneous DEs.
- **Roots.** Maths: algebraic manipulation, laws of exponents, basic trig ratios, sets, permutations and combinations. Chemistry: atoms/valency/formulae, introductory acids and bases.
- **Coverage.** Maths: Class 12 calculus in full (continuity through linear DEs), the Class 11 limits/derivatives it rests on, functions and trigonometry (compound, multiple-angle, sum-product), Class 9–10 algebra (identities, factorisation, algebraic fractions, completing the square), and a slice of matrices/determinants and vectors. Chemistry: the full GOC chapter (fission, intermediates, electrophiles/nucleophiles, curved arrows, inductive, resonance, hyperconjugation and electromeric effects, carbocation stability, organic acidity), hydrocarbons (Markovnikov, peroxide effect, aromaticity, EAS, directing effects), Class 12 haloalkanes (SN1/SN2, optical isomerism, elimination, haloarenes), alcohols/phenols, carbonyls and amines, plus bonding, atomic structure, periodicity, equilibrium and the mole concept underneath.
- `board_marks` are approximate unit weightages (CBSE 2025-26 rationalised syllabus). Foundation units carry 0. The `syllabus_source` string says so in each file.

## Demo fixtures (`pnpm db:seed`, read back from the DB)

All labelled `[SAMPLE]` / "(sample)", with `provenance.kind = demo_fixture` and `sample_data: true`.

| Student | Exams | Records | Error types | Marks lost (records with marks) | With working | Intended story (answer key) |
|---|---|---|---|---|---|---|
| Riya (sample) | 3 maths | 11 | conceptual 9, procedural 2 | 14 (10/11) | 4 | **One root, the chain rule**, behind 8 errors (sin(x²), log cos x, implicit, substitution, rates, parametric, sin⁻¹2x, second derivative); 3 unrelated. |
| Kabir (sample) | 2 maths + 2 chem | 12 | conceptual 10, procedural 1, notation 1 | 19 (11/12) | 5 | **Two independent roots:** multiple-angle formulae (5 maths errors) and the resonance effect (5 chemistry errors); 2 standalone. |
| Ananya (sample) | 2 maths + 2 chem | 10 | notation 4, careless 4, calculation 1, incomplete 1 | 9 (10/10) | 4 | **Conceptually strong:** no root should dominate. Habits (+C, units, sign care, misread reagent). |
| Vihaan (sample) | 3 maths + 1 chem | 9 | conceptual 6, procedural 2, incomplete 1 | 16 (8/9) | 4 | **Deep Class 9 gap:** algebraic identities / factorisation behind 5 calculus errors; 4 standalone, one deliberately **unmapped** (Bayes' theorem, outside the graph). |

Each record is mapped to the concept its question **tested**, never to the intended root. That keeps Phase 2 honest: the engine has to traverse the graph. A test checks that every record in the answer key does reach its stated root through the graph. All maths and chemistry in the fixtures (answers, factorisations, identities, IUPAC names, reaction outcomes) was worked through and checked.

## LLM smoke test (`pnpm llm:smoke`)

A real, structured (JSON Schema + zod-validated) call through the full layer, then the identical call again:

```
Task "smoke_test" -> provider=gemini model=gemini-3.8-flash fallbacks=[gemini-3.6-flash]
1) Live call
{
  "rule_name": "Chain Rule",
  "one_sentence_explanation": "The Chain Rule states that to differentiate a composite function f(g(x)), you differentiate the outer function with respect to the inner function and multiply it by the derivative of the inner function with respect to x.",
  "worked_example": {
    "function": "y = sin(x^2)",
    "derivative": "dy/dx = cos(x^2) * d/dx(x^2) = 2x * cos(x^2)"
  }
}
   answered by gemini-3.6-flash | calls=3 repairs=0 | 194617 ms | tokens in=62 out=127 thinking=0 total=189
2) Same call again -> cached=true, calls=0, tokens=0, 3 ms
```

- **Answer is correct:** d/dx sin(x²) = 2x·cos(x²).
- **Fallback path exercised:** `gemini-3.8-flash` failed twice with Google-side 503/504 errors (each about 55–95 s before Google gave up), then `gemini-3.6-flash` answered. That accounts for the 195 s latency. It is Google's capacity, not our layer; with 3.8 available a call returns in a few seconds.
- **Cache hit:** 3 ms, 0 tokens, 0 provider calls.

Logged token usage (`data/logs/llm-usage.jsonl`, one line per run):

```json
{"task":"smoke_test","provider":"gemini","requestedModel":"gemini-3.8-flash","answeredBy":"gemini-3.6-flash","cached":false,"ok":true,"calls":3,"repairs":0,"latencyMs":194617,"usage":{"inputTokens":62,"outputTokens":127,"thinkingTokens":0,"cachedInputTokens":0,"totalTokens":189}}
{"task":"smoke_test","provider":"gemini","requestedModel":"gemini-3.8-flash","answeredBy":"gemini-3.6-flash","cached":true,"ok":true,"calls":0,"repairs":0,"latencyMs":3,"usage":{"inputTokens":0,"outputTokens":0,"thinkingTokens":0,"cachedInputTokens":0,"totalTokens":0}}
```

`pnpm llm:usage` across all Phase 1 runs: 5 runs of `smoke_test`, 2 cache hits, 1 failure (the run that exposed the fallback-config bug, since fixed), 7 provider calls, 361 tokens in total, all answered by `gemini-3.6-flash`.

## Verification gate

| Check | Result |
|---|---|
| `pnpm typecheck` | ✅ core, llm, db |
| `pnpm lint` | ✅ 0 problems (includes the rule banning hard-coded concept ids; probed: it flags `"math.chain_rule"` in source) |
| `pnpm test` | ✅ 65 tests in 5 files: error-record schema (20), graph loading and validation incl. the deliberately broken graph on disk (13), fixtures and answer key (7), LLM client with a fake provider (20), database (5) |
| LLM smoke test against Gemini | ✅ see above |
| `pnpm db:seed` | ✅ 4 students, 42 records, per-student summary above |
| `pnpm graph:validate` | ✅ stats above |

## Trade-offs and judgement calls

1. **Model fallback is configured, not just retry.** In this phase `gemini-3.8-flash` (current stable Flash) returned 503 "high demand" and 504 timeouts; `gemini-3.6-flash` answered. Every task now tries 3.8 twice and then falls back. The usage log records `requestedModel` and `answeredBy` separately, so quality comparisons stay honest. Trade-off: a call can land on the older model without the caller noticing, unless they read `RunResult.model`.
2. **Temperature is not set by default.** Gemini 3-series models are tuned for their default temperature, and current Claude models reject sampling parameters. Depth is controlled with a provider-neutral `thinking` level per task instead.
3. **Cache key = the request, not the task name.** Identical prompt + schema + model chain + limits hit the cache across tasks. Bump `cacheVersion` in `config/llm.json` to invalidate everything. Failed or invalid outputs are never cached; cached structured outputs are re-validated on read.
4. **PII guard is a backstop, not the protection.** The protection is the data model: pseudonymous ids, and a strict schema that rejects a `name` on a record. The guard blocks emails, Indian phone numbers, Aadhaar-like numbers and configured terms (such as display names) before any *external* call. Local providers are exempt.
5. **Strict schemas everywhere** (unknown keys rejected) for graph files, records and fixtures. This catches typos such as `"prerequisite"`. If the Phase P graph arrives with extra fields, add them to the schema deliberately rather than loosening it.
6. **The graph lives in files; the DB holds a cache of it.** Files are the source of truth (reviewable, diffable); `db:migrate`/`db:seed` sync them into tables tagged with the fingerprint. Error-record concept mappings are deliberately not foreign keys, so a graph swap never deletes or blocks student data.
7. **Mission/mastery tables exist now, but minimal**: `diagnoses`, `concept_mastery` (FSRS stability/difficulty/due), `missions`, `review_log`. Enough to avoid painting Phase 5 into a corner; they will change via migrations.
8. **No web app scaffolded yet.** Phase 3 owns Next.js. Adding it now would mean committing to versions and config with nothing to render.
9. **Product name.** I used "Progresso" to match the repo you created; the folder is still `LearnOS`.

## Known limitations

- Graph slice only: probability, statistics, LPP, 3D planes, physical chemistry (except the mole concept), inorganic chemistry and biomolecules are absent. Errors there will be unmapped, which the format supports.
- No cross-subject prerequisites yet (for example, chemistry's pH needs logarithms). The loader supports them; the provisional graph has none.
- `board_marks` are approximate, and `class` for bridging topics (such as logarithms) is a judgement call.
- The rate limiter is per process. The web app and the MCP server will not share one budget.
- Repair prompts resend the original prompt, so a repair costs about the same as the first call.
- Gemini 3.8 Flash availability on the free tier was unreliable during this phase. Latency on 504s is about 55 s per attempt on Google's side.
- Anthropic and OpenAI-compatible providers are typechecked and unit-tested through the shared client, but were not exercised against live endpoints (no keys or local server in this phase).

## Phase P checklist (when real reports arrive)

**Format fit**
- [ ] Do reports give a question reference for every error? If not, what anchors an error to the paper?
- [ ] Is the exam date always present? Exact day, or month only?
- [ ] Do reports quote the student's working, as text or LaTeX? Is any of it OCR-garbled? Keep `origin: report_quote` true to the source.
- [ ] Are marks given per error, per question, or only as totals? Do half marks appear?
- [ ] What error labels do reports use? Build the `error_type_original` → taxonomy mapping table from real data and check none is forced into the wrong bucket.
- [ ] Does one report paragraph describe several errors? Does one question have multiple errors? (Record ids must stay unique.)
- [ ] Do reports name topics or chapters explicitly? If so, use `mapped_by: "report"` with high confidence.
- [ ] Do reports contain student names, roll numbers or school names? Strip them at ingest; confirm none reach `diagnosis.text`. Add them as `blockedTerms` in the PII guard.
- [ ] Is anything in reports that the format can't hold? Extend the schema deliberately (bump `schema_version`).

**Graph**
- [ ] Full graph passes `pnpm graph:validate` (schema is strict; check for extra fields).
- [ ] Switch `conceptGraphDir` to `data/concept-graph` in `config/app.json`; re-run `pnpm verify`.
- [ ] Check concept-id continuity with the provisional graph. Write an id-mapping table for renamed concepts.
- [ ] Re-validate `board_marks` against the official syllabus, and add cross-subject prerequisites where real.

**Parser**
- [ ] Parser output validates against `ErrorRecordSchema` (use `errorRecordJsonSchema()` as the structured-output target of task `parse_report`).
- [ ] Measure mapping accuracy on a hand-labelled sample of real reports before trusting `parser_llm` confidences.
- [ ] Re-parsing the same report is idempotent (stable record ids).

**Cleanup**
- [ ] Delete `data/fixtures/`, `packages/core/src/demo-fixtures/`, `packages/db/src/seed.ts` + `cli/seed.ts`, and the fixture tests. Remove `isSample` students.
- [ ] Re-point Phase 2 engine tests from the answer key to a labelled set of real students.
- [ ] Search the UI for "sample" labels and remove them only once the data is real.
