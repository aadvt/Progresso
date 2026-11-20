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
