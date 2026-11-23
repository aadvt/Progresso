# Phase 10 report: MCP server and MCP Apps widgets

Phases 8 and 9 are skipped for now (decision 2026-11-23).

**Goal.** A student asks Claude (or another MCP Apps host) "what should I study tonight?" and gets tonight's mission as an interactive widget in the conversation. Answers given there are recorded in the same database as the web app, so the web app's constellation updates.

**Status.** Built and verified locally:
- every tool through the official MCP Inspector, over HTTP and stdio;
- both widgets rendered in the ext-apps reference host (basic-host);
- widget → database → open web page, end to end, in a scripted browser run.

The live test in Claude through a tunnel is **pending the user's confirmation** (instructions: [mcp-connector.md](mcp-connector.md)).

---

## What was built

### `packages/service` (`@progresso/service`): one data seam for both apps

The web app's data loading moved here. The service does three things:
- loads the graph, the demo fixtures (SAMPLE DATA), the question bank, lessons and videos once;
- opens, migrates and seeds the one SQLite file;
- provides `studentContext()`, `studentToday()` and `constellation()`.

`apps/web/src/server/data.ts` now wraps it, with the same exports, so no page changed. The MCP server calls the same functions on the same file. Phase P swaps fixtures for real records in **one** place, not two (CLAUDE.md rule 5 updated).

### `apps/mcp` (`@progresso/mcp`)

Built on the current SDKs, read from their docs and source before use:
- `@modelcontextprotocol/server`, `/node`, `/express` 2.x. The monolithic `@modelcontextprotocol/sdk` 1.x is superseded: ext-apps 2.x requires the split 2.x packages.
- `@modelcontextprotocol/ext-apps` 2.0.4 (`registerAppTool`, `registerAppResource`; `App` in the widgets).

| Tool | UI | What it does |
|---|---|---|
| `get_tonight_mission` | `ui://progresso/mission.html` | Tonight's mission from the plan (`nextMission(buildPlan(...))` via the mission service). Starts it so its 3 questions are fixed and shared with the web player. Sets up a default plan (next exam, 25 min/day) if there is none. Returns the root gap, a Mistake Recap preview (verbatim diagnosis; the student's own working only when the report quotes it), explainer video and step-explainer links, and the questions without the answer key. |
| `submit_answer` | – | Grades and stores one answer (`answerQuestion`). Option letters are case-insensitive. The last answer finishes the mission (`finishMission`: mastery gate, FSRS, writes `concept_mastery`). Returns feedback, the misconception a wrong answer shows (and whether the report found the same one), and the worked solution. |
| `finish_mission` | – | For missions without verified questions ("studied, not proven"). Idempotent. |
| `get_progress` | `ui://progresso/progress.html` | Roots fixed, readiness (always a range, labelled Estimate), missions/topics proven, mistakes still showing up in checks, and a mini constellation from the same layout and mastery as the web map. |
| `explain_my_mistake` | – | Grounded facts for Claude to explain from, no LLM call. Accepts `question_id` (a prove-it answer → the misconception → the report's records with it) or `about` (question ref, exam, topic or misconception; scored match, top 3; lists all mistakes when nothing matches). Returns the report's diagnosis, quoted working and correct approach verbatim, the prerequisite path to the root, and the verified recap fix and explainer. |
| `list_students` | – | Pseudonymous ids, class, subjects, next exam. No display names. |

**Text first.** Every tool returns Markdown `content` that stands on its own (what the model reads, and all a host without MCP Apps shows), including how to run the questions with `submit_answer`. `structuredContent` (`src/shared/types.ts`) feeds the widgets. Maths stays `$…$` in text.

**No LLM calls.** The student's own Claude does the conversational part. The server's job is grounded data and UI. Instructions sent at `initialize` tell Claude to ground explanations in the tool output, never present working as the student's unless the report quotes it, and not reveal answers early.

### Widgets

Vanilla TypeScript plus the ext-apps `App`, bundled by `scripts/build-ui.ts` (esbuild) into one self-contained HTML file each: inline JS and CSS, no external requests, so no CSP domains are declared.
- **Maths is rendered on the server** with KaTeX to MathML only. Browsers draw it natively, so the widget ships no KaTeX script, CSS or fonts. A thin space is added before operator names (`6x tan`, not `6xtan`), which native MathML omits.
- **Size**: 420 KB per widget, about 115 KB gzipped. Almost all of it is the MCP client SDK plus zod core that `App` needs. zod's 40 locale files (260 KB, not tree-shakable) are aliased to English only at build time, so the original 675 KB is down to 420 KB.
- **Visual language**: the web app's tokens: the frosted card, the blue→teal thread, the root star (red, then green when fixed), the answer-sheet paper with the student's quoted working in a hand font and the mistake circled in red pen, "Not your working" for typical steps, and the night-sky constellation. It follows the host theme (dark mode tested).
- **Mission widget**: header and steps; the root gap (rank, mistakes, exams, marks; "Why this is the root"); the Mistake Recap (sheet, then "Show the fix" with the key idea); explainer buttons (`openLink` to the video and to the full mission in the web app) and "watch for" mistakes; then Prove it one question at a time, as in the web player.
- **After each answer**:
  - `submit_answer` → feedback in place (a tag "Same mistake as Unit Test 1 Q7 in your report"; the worked solution);
  - `updateModelContext` with a YAML-fronted summary of every answer so far (question ids, misconceptions, the result), so Claude knows what happened without being asked;
  - "Ask Claude why →" and, at the end, "Go over my mistakes with Claude" / "What's next?" use `sendMessage` so Claude follows up in the conversation.
- **Progress widget**: readiness bar (now vs start), stats, roots list, a mini SVG constellation with roots named, and "What should I study tonight?" (`sendMessage`).

### Transports and auth

- **Streamable HTTP**: stateless, a fresh server and transport per request, at `/mcp`, plus `/health`.
- **stdio**: `--stdio`, logs to stderr only. The widgets are bundled at startup.
- **`Authenticator`** (`src/auth.ts`) runs at the HTTP boundary, before any MCP message. The demo implementation:
  - **optional shared token** (`PROGRESSO_MCP_TOKEN`): checked against `?token=` or `Authorization: Bearer`, compared in constant time; a wrong or missing token gets `401` + `WWW-Authenticate`;
  - **optional student binding** (`?student=`, the `X-Progresso-Student` header, or `PROGRESSO_STUDENT` on stdio): a bound connection's tools drop the `student` argument and can only act for that student. Unbound, `student` is required and validated.
- **Host checks**: with no token, DNS-rebinding protection stays on (localhost plus `MCP_ALLOWED_HOSTS`). With a token, any Host is accepted, because tunnel hostnames change on every restart and the token is the protection.

### Web app

- `LiveSync` polls `GET /api/students/:id/version` (`progressVersion()` in `@progresso/db`: a hash over mastery, answers, missions and plan settings) every 3 s while the tab is visible. It calls `router.refresh()` only when the version changes.
- It is on Today, Plan, Diagnosis, Replays and the constellation. It is not on the mission player, so the player is never refreshed mid-mission.
- The constellation already animated any new model from the server, so an answer in Claude now plays the change, and the ripple, on an open page.

---

## Verification

### Unit and integration tests: `apps/mcp/test/mcp.test.ts` (16 tests, throwaway DB)

- tools/list and UI links;
- resources are one self-contained HTML file each (no external script, link or url);
- **no answer key** in the output before answering (no `correct`, `misconception_id` or solution text);
- the recap diagnosis is verbatim;
- idempotent `get_tonight_mission`;
- all-correct answers finish the mission, write `concept_mastery` and change the constellation's `state_key` (ripple root reported);
- a second answer to a finished mission is rejected;
- progress ranges are ordered;
- a wrong answer → misconception → `explain_my_mistake` by question id returns verbatim report text; search by topic and by exam+ref; no-match lists every mistake; quoted working only when the record has it;
- a bound connection exposes no `student` argument and can't act for anyone else;
- token and student checks;
- a real HTTP round trip with the token and binding in the URL (and `401` without);
- MathML rendering, escaping, and operator spacing.

`pnpm verify`: typecheck (7 workspace packages, plus the widget code against the DOM types), lint, **220 tests** (17 test files), graph validation: all pass. Web e2e (`pnpm e2e`, desktop + phone, axe, perf) after the data-layer refactor: **43 passed, 3 skipped** (the same skips as before), so the web app is unchanged for the user.

### MCP Inspector (official, v2.16.0 CLI): every tool, saved in [phase-10/inspector/](phase-10/inspector/)

| # | Call | Result |
|---|---|---|
| 01 | `tools/list --strict` (HTTP, Bearer token) | 6 tools, schemas portable (no strict-mode findings) |
| 02 | `tools/list --app-info --advertise-apps` | `get_tonight_mission` → `ui://progresso/mission.html`, `get_progress` → `ui://progresso/progress.html`, mime `text/html;profile=mcp-app` |
| 03–04 | `resources/list`, `resources/read` | both widgets; one HTML document |
| 05 | `list_students` | 4 ids, no display names |
| 06 | `get_tonight_mission student=demo-riya` | plan created; *Fix the root: Chain rule*; recap Unit Test 1 Q7 with the quoted working; video + explainer; 3 questions, no key |
| 07 | `submit_answer … answer=a` (wrong) | "Not quite (answered A)", misconception "Differentiates the inner function but leaves the outer function undifferentiated", worked solution, hint to call explain_my_mistake |
| 08 | `explain_my_mistake question_id=…` | their answer and the misconception, then the 3 report records with that root (verbatim diagnosis, quoted working, path to the root, verified fix) |
| 09 | `explain_my_mistake about="Half-Yearly Q18"` | the implicit-differentiation record, path Chain rule → Implicit differentiation |
| 10–11 | remaining answers | last answer finishes: "2/3 correct, new → learning. 3 needed", readiness 91 → 93 (mid) |
| 12 | `finish_mission` again | stored result (idempotent) |
| 13 | `get_progress` | 0 of 1 fixed, ranges, sky data |
| 14 | `get_tonight_mission` again | "Tonight's mission is done ✓" with the result |
| 15 | URL `?token=…&student=demo-kabir`, no args | Kabir's plan and mission (bound connection) |
| 16 | no token | `401`; the Inspector then tries OAuth discovery (expected; hence the token in the connector URL) |
| 17 | bound to Kabir, `student=demo-riya` passed | the stray argument is dropped by the bound schema and Kabir's progress is returned (it can never act for Riya) |
| 18–19 | **stdio**, `PROGRESSO_STUDENT=demo-vihaan` | tools/list; `get_progress` for Vihaan |

Two Inspector outputs (12, 14) were from before two small fixes made after review:
- `finish_mission` on a finished mission no longer prints a "before → after" readiness that was the same value twice;
- the mastery state "none" now reads "new".

### MCP Apps host: ext-apps `basic-host` + real DB + web app

`pnpm mcp:host-check` (Playwright) drives the reference host from `modelcontextprotocol/ext-apps` (commit `ea3e9d0`; its Bun server run with tsx). The web app's constellation (production build) is open in a second tab the whole time. Screenshots: [phase-10/screenshots/](phase-10/screenshots/).

Run 1:
1. The widget renders in the host's double-iframe sandbox (`host-01`).
2. Question 1 answered wrong in the widget: the feedback appears, and the `question_attempts` row is in SQLite (`correct:false, revealed_misconception_id: …m1`) (`host-02`).
3. The web app's `/version` changes.
4. The host's **Model Context** panel shows the widget's `updateModelContext` summary. **Messages** shows "Why was my answer to this prove-it question wrong? (question_id …)" from "Ask Claude why" (`host-03`).
5. The last two answered right: "Not proven yet". The open web map updates to learning (`web-02`).

Run 2 (plan reset):
6. Three right answers: "Mission passed ✓ · Chain rule is fixed" (`host-05`).
7. **On the open web page the constellation plays the ripple** (`window.__constellation.ripples` 0 → 1) with no reload (`web-03`).
8. The progress widget: "1 of 1 root gap fixed", the mini constellation with the fixed root (`host-06`), and dark theme via the host's toggle (`host-07`).

Riya's plan is reset afterwards, so the live demo starts clean.

### Live test in Claude

**Pending.** See [mcp-connector.md](mcp-connector.md) for the tunnel, the connector and the demo script.

---

## Decisions later phases rely on

- `@progresso/service` is the data seam for every server-side consumer. Phase P replaces `demoStudent`/`analysed` there (and the web report parser).
- Progress sync between processes is just the shared SQLite file (WAL) plus `progressVersion()` polling. If the DB moves to a server database, keep `progressVersion` (or push events) and LiveSync works unchanged.
- MCP tool output is text first, widget second; the answer key stays server-side; no display names; no LLM calls in tools.
- Auth lives in `Authenticator` at the HTTP boundary; tools only see a `Principal`.

## Adding OAuth later

1. Use an identity provider (Auth0, Cognito, Keycloak…) or the SDK's OAuth server helpers. Students sign in there; map the token's `sub` to a student id (a table `student_identities`).
2. Serve Protected Resource Metadata at `/.well-known/oauth-protected-resource` (the SDK's `mcpAuthMetadataRouter` / `getOAuthProtectedResourceMetadataUrl`). The authorization server advertises CIMD (`client_id_metadata_document_supported`), so Claude needs no dynamic registration.
3. Add `OAuthAuthenticator implements Authenticator`. It verifies the Bearer JWT against the IdP's JWKS (issuer, **audience = this server's URL**, expiry, scope `progresso:student`), returns `{ studentId: sub→student, via: "oauth" }`, and answers `401` with `WWW-Authenticate: Bearer resource_metadata="…"` otherwise. Remove `?student=` and the shared token.
4. Optional: per-tool scopes (e.g. read-only `get_progress` vs `submit_answer`) using the per-tool 401 pattern from the ext-apps authorization guide.
5. Nothing in `server.ts`, the views or the widgets changes: they only see the `Principal`.

## Open items

- Confirm the live test in Claude (pending).
- Widget size is mostly the MCP client SDK and zod. If hosts start providing a shared runtime, or ext-apps ships a slimmer `App`, drop it.
- `progressVersion` polling is every 3 s per open tab; fine for the prototype, swap for server-sent events if many tabs or students.
- The explainer video and "Open in Progresso" links point at `PROGRESSO_WEB_URL` (localhost by default), so they only open on the machine running the web app. A deployed web app fixes this. Embedding the video in the widget would need `resourceDomains` in the CSP.
- Questions exist for only 3 misconceptions (Phase 5 open item). Students whose root has none get recap + explainer and `finish_mission` ("studied, not proven").
- basic-host's server needs Bun. We ran its `serve.ts` with tsx; the ext-apps workspace install is required (its root install builds the SDK the host links to).
