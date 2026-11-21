# Phase 3 report: web app shell and the diagnosis experience

Date: 2026-11-21. Status: verification gate passed: `pnpm verify` (typecheck, lint, 101 tests, graph validation), production build with no warnings, and `pnpm e2e` with 12 Playwright tests at desktop (1440×900) and phone (Pixel 7) sizes, including axe WCAG 2.1 AA checks on every screen. The suite was run three times back to back (36/36) to check for flakiness.

Screenshots: [`docs/screenshots/phase-3/`](screenshots/phase-3/) (`desktop-*` and `mobile-*`; full-page shots are `.jpg`, viewport shots `.png`). Screenshots are local only (git-ignored, not in the repo); `pnpm e2e` regenerates them.

## Inputs that were missing

The brief pointed to `docs/design-reference/` (the current Inferentics look) and `docs/report-format.md`. **Neither exists in the repo.** The design follows the brief's description instead (light, clean, soft glassy cards, calm blues and greens), and the report contract is the existing `docs/error-record-format.md`. If the reference screenshots turn up, compare them against the tokens in `apps/web/src/styles/tokens.css`; most adjustments should be token changes.

## What was built

### Domain (`@progresso/core`, reused by the MCP server in Phase 10)

- **Report parser interface** (`src/report-parser/`, also exported as `@progresso/core/report-parser`): `ReportParser.parse(input, { graph, onProgress, signal })` returns `ParsedReport { exams, records, source, notices, parser }`. Parsers report progress by stage (`reading → extracting → mapping → validating`). `source` is either `report_text` (Phase P: shown back to the student) or `demo_fixture` (SAMPLE DATA).
- **`DemoFixtureParser`** (in the SAMPLE DATA module `@progresso/core/demo-fixtures`, deleted in Phase P): returns the chosen demo student's fixture records, checks them against the graph, and emits real stage messages ("Found 11 diagnosed mistakes across 3 exams"). **It never reads pasted text, and says so** in `notices`.
- **`buildDiagnosisView(analysis, records)`** (`src/diagnosis-view/`): pure view model. It joins the engine output back to each record's verbatim report text, builds the headline numbers, folds each root's prerequisite paths into a tree (shared prefixes merged), groups standalone errors and habits with their evidence, and lays out the "original report" (records by exam, questions in numeric order). It adds no diagnosis of its own.

### Web app (`apps/web`, `@progresso/web`, Next.js 16 App Router, React 19)

| Route | What it does |
|---|---|
| `/` | Landing and student picker. Each demo student shows class, subjects, next exam countdown, and whether a report has been added. |
| `/s/[id]/add-report` | Paste or upload (.txt/.md, drag-and-drop) a report, then a progress view driven by the real stream of parser stages. |
| `POST /api/students/[id]/reports` | Runs the parser, then the root-cause engine; streams NDJSON progress events. |
| `/s/[id]/diagnosis` | The diagnosis. Redirects to Add report if this browser hasn't added one. |

**Diagnosis screen**
- **Headline**: "Fix 1 thing → explains 8 of 11 errors → ~12 marks", the largest type in the product. Habit-only students get "Fix 4 habits → behind 10 of 10 errors → ~9 marks". Screen readers get one plain sentence.
- **Root gap cards**: rank, class, subject, chapter, evidence strength, mistakes, exams, marks lost, time to fix, and "shows up in". Expanding "Why this is the root" shows the engine's plain explanation, repeated misconceptions, the **"How one gap spreads" tree** (root → "used in" topics → the mistakes, each with the report's verbatim words, the question when quoted, and the student's working only when the report quotes it), and "How sure we are" (confidence, branch coverage, close calls, counter-evidence). The first root opens by default.
- **One-off mistakes** and **Slips and habits** (each with a "Try this" tip) in separate sections.
- **"Start my comeback plan"** (hero and page end) opens an honest placeholder: plans arrive in Phase 5. It shows the real focus and mission count from the engine.
- **"View original report"**: a side sheet (bottom sheet on phones) with every diagnosed mistake, word for word, by exam. For sample students it says plainly that no report text exists and these are the hand-written lines the sample was built from. **We never generate report text.**
- **Constellation slot** (`[data-slot="constellation"]`): a fixed-size dark panel with a decorative star field and the student's roots as the bright stars, labelled "Coming soon". Phase 4 drops the three.js scene in here. On phones it sits right after the headline.
- Aside: "Where your mistakes come from" breakdown bar, and the exams included.

### Design system

Visual language **"light threads"**: frosted-glass surfaces over a slow aurora with a faint instrument grid. A blue→teal thread of light connects a root to what it causes, and the same motif runs through the logo, the hero illustration, the headline arrows, the parse progress rail, the evidence quotes and the chain tree. Blue means understanding / the root, teal means recovery / marks won back, amber means habits and sample data. The constellation is the one dark surface: a window onto the syllabus.

- **Tokens** (`src/styles/tokens.css`): type scale (Geist Sans and Geist Mono, self-hosted via the `geist` package, so the build needs no network), ink and accent colours with their contrast ratios noted, glass levels, spacing, radii, shadows, focus ring, and motion (durations collapse to 1 ms under reduced motion).
- **Components** (`src/components/ui/`): `Surface` (glass, three levels), `Button`/`ButtonLink` (primary, secondary, ghost), `Badge` and `SampleDataBadge`, `Icon`, `Dialog` (native `<dialog>`, side or centre), `TopBar`, `Backdrop`, `Logo`. Diagnosis pieces (`EvidenceCard`, `RootCard`, `Breakdown`, `ConstellationSlot`, `Headline`) are built only from these.

### Accessibility and responsiveness

- axe (WCAG 2.0/2.1 A and AA) runs in the e2e suite on the landing, add-report, diagnosis, habits diagnosis and report-dialog screens, and fails the test on any violation. `eslint-plugin-jsx-a11y` and `react-hooks` lint the app.
- Keyboard: skip link; every action reachable by Tab; tabs with arrow keys; disclosures use `aria-expanded`/`aria-controls`; dialogs trap focus, close on Escape and return focus to their trigger (tested). After parsing, focus moves to the result.
- Screen readers: the headline is one sentence; parse progress is announced through a polite live region; lists keep `role="list"` (Safari drops list semantics under `list-style: none`).
- Reduced motion: all animation and transition durations go to 1 ms, the aurora, sweep and pulses stop (tested).
- Responsive: one column under 1024 px, with the constellation moved up. On phones the headline becomes a compact list on a vertical thread, stat grids go two-up, dialogs become bottom sheets, and buttons go full width.

### Prototype state

Which students have a report added is kept in a cookie (`progresso-reports`); there are no logins (scope rule 2). "Reset demo" on the landing page clears it. Phase P moves this to the database with the parsed records.

## How it was verified, and what the screenshots changed

The first full Playwright run produced screenshots that I reviewed one by one. Problems found and fixed:

| Seen in the screenshots / axe | Fix |
|---|---|
| Headline arrows showed as bare ">" glyphs: an SVG gradient on a zero-height horizontal line paints nothing | Arrows rebuilt as stretchable thread lines with a separate arrowhead. The equation now fills the hero width. |
| Headline terms on different baselines (gradient-text padding) | One line height for all values, solid teal for the marks figure, smaller separate tilde |
| On phones the headline filled a whole screen, with tiny "﹀" arrows | Compact three-row list joined by a vertical thread with dots |
| Deep chain (Vihaan, 5 levels): stacked parallel lines, connectors overshooting | Tree geometry rebuilt on shared variables so every connector meets its thread; runs of topics that lead to only one other topic and hold no mistakes collapse into one path ("used in A → B → C") |
| A stray grey rule above each root card | Removed |
| Error-type chips mixed the report's labels ("Conceptual error") with ours ("Concept") | Cards use our taxonomy. The report's own label stays in the original-report sheet. |
| Report sheet on phones: page text bled through the translucent panel; monospace paragraphs were tiring | Solid reading surface; report text in the reading face with a quote rule |
| Sticky top bar too transparent when scrolled | More opaque |
| Landing: empty right half; student card headers wrapped into a cramped 3-line stack and misaligned | Hero illustration of the core idea (one root → topics → mistakes, no data); subjects on their own line with equal header heights |
| Landing (phone): a stray step connector wrapped to a new line (`.steps li` beat the mobile `display:none`) | Steps stack vertically on phones |
| Parse progress card floated high above empty space | Vertically balanced |
| axe: student chip's accessible name didn't contain its visible text | Name is now the visible text plus visually-hidden words |
| axe: report sheet body scrolls but had nothing focusable | Scroll region is focusable and labelled |
| axe: contrast sampled mid fade-in | Test waits for entrance animations before auditing (real contrast passes) |
| One flaky run: the "ready" panel auto-navigates after 1.4 s and a slow screenshot missed it | Test accepts the panel or the diagnosis it leads to. Suite then ran 36/36. |

## Decisions later phases rely on

- **Parser contract**: Phase P implements `ReportParser` and returns it from `getReportParser()` in `apps/web/src/server/data.ts`. That file is the only place the web app touches fixtures; swap `getDiagnosis()` to read records from the DB at the same time. Stage names are shared through `@progresso/core/report-parser`.
- **View model**: the web app renders `DiagnosisView` only. The MCP server (Phase 10) should reuse `buildDiagnosisView`.
- **Constellation**: Phase 4 replaces the contents of `ConstellationSlot` and keeps the `[data-slot="constellation"]` container and its size.
- **Comeback plan**: `PlanDialog` is the placeholder Phase 5 replaces. Mission counts and hours already come from the engine's `missions` and `study_hours`.
- **Design tokens and `ui/` components are the API for later phases.** Add tokens rather than raw colours, and use the thread motif for "this causes that" everywhere.
- Client components may import only types from `@progresso/core` (its index pulls in `node:fs`). Runtime constants go through a browser-safe subpath such as `@progresso/core/report-parser`.
- `packages/core/src/config.ts` marks its runtime path resolution with `/*turbopackIgnore: true*/`, so the bundler doesn't trace the whole repo.

## Open items

- `docs/design-reference/` and `docs/report-format.md` were not in the repo (see above).
- Upload reads only text files. PDF and image reports would need a reader, and scope rule 1 says the report *text* is our only input, so Phase P should decide how reports arrive.
- Report-added state is per browser (cookie). Phase P: database.
- Very noisy students (many roots) are not capped in the UI yet. Phase 2 suggested a cap; there is no fixture to design it against.
- Root explanations are long template paragraphs. `pnpm analyse --llm` can re-word them; the web app doesn't call the LLM yet (it would need caching per student and a loading state).
- Screenshots weigh about 13 MB, mostly tall full-page phone shots.

## How to run

```bash
pnpm web:dev        # http://localhost:3100
pnpm web:build && pnpm web:start
pnpm e2e            # production build + Playwright (desktop + phone), screenshots to docs/screenshots/phase-3/
```

First time: `pnpm --filter @progresso/web exec playwright install chromium`.
