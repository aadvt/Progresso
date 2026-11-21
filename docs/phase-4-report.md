# Phase 4 report: the knowledge constellation

Date: 2026-11-21. Status: verification gate passed. `pnpm verify` (typecheck, lint, 117 tests, graph validation), production build, and `pnpm e2e`: 29 Playwright tests passed, 1 skipped by design (the keyboard test runs on desktop only). That covers desktop (1440×900) and phone (Pixel 7), axe WCAG 2.1 AA on the full map, the 2D map and the diagnosis page with its preview, and two frame-rate projects that run last and alone.

Screenshots: [`docs/screenshots/phase-4/`](screenshots/phase-4/). Frame-rate results: `perf-desktop-perf.json` and `perf-mobile-perf.json` in the same folder. Screenshots are local only (git-ignored, not in the repo); `pnpm e2e` regenerates them.

## What was built

### The model (`@progresso/core`, `src/constellation/`)

Pure, deterministic and UI-free, so the MCP App widget (Phase 10) can draw the same thing.

- **`layoutConstellation(graph, subjects)`**: each subject is a disc.
  - **Rings by class**: Class 9–10 foundations at the core, Class 11 around them, Class 12 at the rim. Prerequisite threads therefore always point outwards (tested: no prerequisite sits on an outer ring), and a chain reaction visibly spreads outwards.
  - **Sectors by unit**: inside a ring, each unit is a wedge, bracketed by a tinted arc and labelled. Sector order is hill-climbed so that units that depend on each other face each other across rings. Concepts are then ordered by barycentric sweeps (crossing reduction), deeper concepts sit further out, and a short force relaxation removes overlaps.
  - **Results**: threads turn less than 0.6× as much as in a shuffled map (tested). No two stars are closer than 7 units. Ring thickness grows with concept count, so the same code lays out a random 600-concept graph in well under a second (tested).
  - The layout depends only on the graph, so the web app caches it per graph fingerprint and subject set. It knows no concept ids.
- **`buildConstellation({ graph, layout, analysis, records, mastery })`** gives every concept a state:

  | State | When | Look |
  |---|---|---|
  | `root` | a root gap from the engine | large red core with sonar rings |
  | `weak` | a mistake surfaced here (root-explained or one-off) | warm orange glow, larger with more mistakes |
  | `learning` | mastery `learning`, **or** every root behind its mistakes is mastered ("expected to clear") | yellow-green |
  | `mastered` | mastery `proven`/`retained` | calm green-white with a halo |
  | `unassessed` | no evidence | dim, tinted by its unit's hue |

  - It also adds `lit` (downstream of a mastered root: brightened), `on_chain` and chain edges (root → mistake paths, drawn as warm flowing threads), the report's evidence verbatim, why-it-matters numbers (topics built on it, board marks resting on it), and a `state_key` that changes whenever any star's look changes.
  - Habit and slip records never make a star weak: they aren't knowledge gaps, so a habits-only student (Ananya) has a calm map.
- **`rippleHops`, `diffConstellation`, `withSavedStates`** (browser-safe entry `@progresso/core/constellation/client`): BFS hop distances for the ripple, the roots that became mastered between two models, and replaying changes since the last visit.

### The data (`@progresso/db`)

- `getConceptMastery`, `setConceptMastery`, `clearConceptMastery` and `isSampleStudent` (`src/mastery.ts`) on the existing `concept_mastery` table. **This is the hook for later phases**: Phase 5 missions and the Phase 10 MCP server write here. The constellation reads it on every request, and any change shows up and animates.
- `ensureDemoData()` syncs the graph cache and seeds the demo students only if they are missing, keeping existing mastery. The web app calls it on first DB use, so a fresh clone works without `pnpm db:seed`.
- `runMigrations(db, folder?)`: Next bundles `@progresso/db`, so the web app passes the migrations folder explicitly.

### The web app

- **`/s/[id]/constellation`**: full-screen night sky with a slim header, the map, a toolbar ("Your root(s)", "Whole map", 2D/3D toggle), a floating key, and a side panel (a bottom sheet on phones).
  - With nothing selected, the panel shows the roots, the demo trigger, "Topics with mistakes", "Recovering", and how to read the map.
  - With a star selected, it shows the state, the engine's explanation and stats for roots, "Traced back to", the mistakes in the report's own words, why it matters, and "Built on" / "Leads to" chips that navigate the map.
- **Diagnosis slot**: the Phase 3 placeholder is replaced by a live preview that frames the problem area, orbits slowly, and opens the full map on tap or through "Open the map". It doesn't capture page scroll.
- **3D renderer** (`components/constellation/engine/scene.ts`, plain three.js r187, loaded with a dynamic import so other pages never download it):
  - Stars are one instanced billboard draw call. Glow, sonar rings, halo and twinkle all come from the shader; there is no post-processing.
  - Threads are one `LineSegments` draw call of Bézier arcs, with the flowing chain glow and the ripple front in the shader.
  - Also: a sky gradient, nebulae, dotted ring guides, unit arcs, and background dust.
  - Labels are DOM elements, placed greedily by priority with overlap culling (focus > hover > roots > subject > units).
  - Picking uses screen-space nearest-star with touch-friendly radii. OrbitControls handle rotate, zoom and pan; camera flights use a fit that binary-searches the distance at which every target star is on screen.
  - When the stage is narrower than 1.1:1, two subjects are viewed lengthwise so they stack.
- **The ripple**: when a root becomes mastered, light leaves the root hop by hop along the dependency threads (0.42 s per hop, roots staggered).
  - A shockwave ring spreads across the disc. Each star flashes as the light arrives, then settles into its new look: symptoms warm to green, everything built on the root brightens.
  - The camera frames the root and everything it reaches, and the root's label switches to "Mastered" as it fires.
- **2D renderer** (`Map2D.tsx`): the same layout from above in SVG, with the same states, roots, labels, focus, "your roots", drag, wheel and pinch zoom. The ripple uses CSS animations with per-star delays, so it costs almost nothing.
- **Demo trigger** (SAMPLE DATA students only): "Master ‹root›" calls a server action that **writes `proven` to `concept_mastery`** exactly as a passed Phase 5 check will. Then `router.refresh()` re-renders from the database, and the client diffs the old and new models and plays the ripple. "Reset demo" clears the mastery.
  - The server only accepts the student's own roots, and only for sample students.
  - The same diff path handles any update. A `localStorage` snapshot also replays changes made since the last visit (for example, after a mission).

## Choosing the renderer, and falling back

`chooseRenderer()` picks the 2D map when:

- WebGL is missing,
- `navigator.deviceMemory < 2`, or `hardwareConcurrency ≤ 2`,
- Data Saver is on, or
- the URL says `?view=2d`.

At runtime the scene watches its own frame rate:

- below 40 fps it first lowers the pixel ratio (from ≤1.75 down to 1);
- below 24 fps for three consecutive seconds, or on WebGL context loss, it switches to the 2D map and says why.

The user can switch either way at any time.

Tested in e2e:

- forced 2D with the full experience (roots, ripple, axe);
- WebGL stubbed out → `no-webgl`;
- `hardwareConcurrency = 2` → `weak-device`;
- every frame made ~70 ms slower → the scene switches itself to 2D (`slow`) with the notice "Switched to the 2D map to keep things smooth."

An unplanned live confirmation also happened. The first e2e run had 8 workers fighting over one integrated GPU, and the scene correctly measured ~17 fps and downgraded itself to 2D. That is why the frame-rate tests now run in their own projects, after everything else.

## Frame rate

Measured with `requestAnimationFrame` in the page over 5 s, on this machine's Intel UHD integrated GPU (ANGLE/Direct3D 11), headless Chromium with the GPU enabled. CPU throttling uses Chrome DevTools' `Emulation.setCPUThrottlingRate`; 4× is the usual stand-in for a mid-range Android phone.

| | Desktop 1440×900, Vihaan (119 stars, 2 subjects) | Phone Pixel 7 viewport, Riya (69 stars), pixel ratio 1.75 |
|---|---|---|
| No throttling | **60.1 fps** | **60.2 fps** |
| CPU 4× slower | **60.3 fps** | **58.4 fps** |
| CPU 6× slower | 37.1 fps | 58.7 fps |
| During the ripple at 4× | **49.4 fps** | **60.2 fps** |

Caveats, honestly stated:

- CPU throttling slows JavaScript, not the GPU. A real mid-range Android GPU is weaker than this laptop's. The per-frame GPU work is small (a few thousand additive quad fragments and ~6k line vertices; no post-processing), and the adaptive pixel ratio plus the 2D fallback catch devices that can't keep up.
- I couldn't test on a physical phone in this environment. Checking on a real device is worth doing when one is to hand: open `/s/demo-vihaan/constellation` and read `window.__constellation.stats` from remote DevTools.
- The ripple at 4× on desktop dips to ~49 fps because each frame updates every star's attributes on the CPU while light is travelling. It's still smooth. If the full Phase P graph makes it heavier, move the per-star blending into the shader (an arrival-time attribute).

## Reduced motion

Under `prefers-reduced-motion`:

- no auto-rotation, twinkle, flowing threads, sonar rings (a still ring marks roots instead) or shockwave;
- camera moves are instant, and the scene renders only on demand;
- a mastered root's new state appears at once and is announced through a polite live region ("Chain rule mastered. The light spreads to 21 topics built on it."). Tested.

## Accessibility

- The canvas or SVG is decorative (`aria-hidden`), inside a `role="img"` with a one-sentence summary ("119 topics of Mathematics and Chemistry. Root gap: Algebraic identities. 8 topics with mistakes.").
- Everything on the map can be reached from the panel with the keyboard: roots, topics with mistakes, recovering topics, and prerequisite and dependent chips. Escape returns to the overview. Tested.
- State is never shown by colour alone: every label and button carries its state in words.
- axe found one real issue: on phones the header's back link lost its text (`display: none`). It now has an accessible name.

## How the screenshots shaped it

| Seen | Fix |
|---|---|
| The nebula drew as an opaque black square (a transparent canvas plus additive output writes alpha) | Opaque canvas; the sky gradient is drawn in-scene |
| Stars too small and dim; the map read as empty | Wider glow, twinkle; bigger stars for topics more of the syllabus builds on |
| Dotted rings and unit arcs louder than the stars | Halved their intensity |
| "Calculus" appeared twice | Duplicate unit names get the class: "Calculus · 11" / "Calculus · 12" |
| Dimmed stars vanished in focus mode | Dim to 34%, not 22% |
| Root label said "Root gap 1" while the star had already turned green | Labels switch to the target state when the ripple fires |
| Phone: two side-by-side discs became tiny (the stage above the sheet is almost square) | Stack the subjects whenever the stage is narrower than 1.1:1 |
| Diagnosis preview: whole map tiny, hidden under the caption | Preview frames the problem area, offsets the view above a one-line caption, compact key on top |
| 2D ripple zoomed to 4× on a root with one dependent | Never zoom into less than ~70 units of map; max 3× |

## Decisions later phases rely on

- **Phase 5**: write mastery with `setConceptMastery(db, { studentId, conceptId, state })`. `learning` makes a star warm towards green; `proven`/`retained` makes it mastered, and for a root it triggers the ripple the next time the map renders. `gap` marks a star weak. FSRS fields are untouched.
- **Mastery is an overlay**: the diagnosis (roots) stays the engine's output from the reports. A mastered root is drawn as fixed, not removed. When Phase 5 feeds passed checks into the engine as `MasteryEvidence`, decide whether the diagnosis page should also say "fixed".
- **Phase 10**: the MCP App widget can reuse `buildConstellation` and either renderer. `ConstellationModel` is plain JSON.
- **Phase P**: the full graph needs no code changes. If the layout ever needs tuning, the knobs are in `DEFAULT_LAYOUT_PARAMS`.

## Open items

- Measure on a physical mid-range Android phone (see the caveat above).
- With hundreds of stars, unit labels will need a zoom threshold in 3D as well. The overlap culling already keeps them readable.
- The demo trigger is visible to anyone viewing a SAMPLE DATA student. Real students never see it.
- e2e uses its own database (`data/progresso-e2e.db`, git-ignored) so runs never disturb local demo state.
