# Phase 7 report: Manim explainer videos

Date: 2026-11-23. Status: **done**. Short explainer animations in the style of 3Blue1Brown, one per **misconception** (not per student), generated offline by `pnpm videos:generate`, checked automatically, reviewed by hand, and shown in the mission player as the explainer. The Phase 6 step explainer is the fallback. Nothing is generated or rendered during a session.

Gate results:
- **Pipeline run on 6 maths misconceptions**, the most frequent in the demo reports. **5 passed** the automatic checks and are served, after **0 to 2 fix iterations** each. 1 (determinants) stopped on the Gemini free-tier daily quota after 2 failed attempts; it has no entry and `--missing` will retry it. There are no physics misconceptions in the provisional graph, so all 6 are maths.
- **Every frame of every passing video was inspected by hand** (5 passing, plus 1 rejected and remade). Contact sheets are in [`docs/phase-7/`](phase-7/). **4 were correct and readable as made. 1 was rejected**: a correct line was crossed out, which the automatic frame check missed. It was regenerated, re-reviewed and approved. All verdicts are recorded in the manifest (`review`).
- **Fallback confirmed** (e2e, desktop and phone): a mission whose misconception has no served video shows the step explainer, and so does a mission whose video file can't load. Failed or rejected videos return 404. Replays list only served videos.
- `pnpm verify`: typecheck, lint, **204 tests** (16 files), graph validation: all pass.
- `pnpm e2e` (production build): **43 passed**, 3 skipped by design, 0 failed. That includes the 6 new video tests (desktop and phone), axe clean on the new screens, and frame rate unchanged (60 fps desktop and phone; 51–58 fps at 6× CPU throttling).

Tools: Manim Community 0.22.1 (installed with `uv tool install manim`), MiKTeX 25.12 (pdfTeX, dvisvgm; packages install on the fly), ffmpeg 2025-06 (gyan.dev full build). On a fresh machine only ffmpeg was present, so Manim and LaTeX were installed this phase.

## Results per misconception

The final run per item. "Fix iterations" counts attempts after the first; each one fed the previous attempt's problems back to the code generator.

| Misconception (students, records) | Attempts → stage | Fix iterations | Length | Automatic | Hand review |
|---|---|---|---|---|---|
| `math.chain_rule.m1` (1, 6) | 1 layout audit (labels below phone size) → 2 passed | 1 | 90.5 s | passed | **approved** |
| `math.algebraic_identities.m1` (1, 2) | 1 layout audit (a/b labels too small) → 2 passed | 1 | 91.5 s | passed | **approved** |
| `math.antiderivative_basics.m1` (1, 2), first version | 1 render error → 2 layout audit (labels too small) → 3 passed | 2 | 94.5 s | passed | **rejected**: a correct line crossed out; label drawn over a curve |
| `math.antiderivative_basics.m1`, remade with `--fresh` | 1 frame check (the "correct rule" lacked + C: blocker) → 2 lint (syntax error) → 3 passed | 2 | 88.5 s | passed | **approved** |
| `math.trig_multiple_angles.m1` (1, 2) | 1 passed | 0 | 106.5 s | passed | **approved** |
| `math.algebraic_identities.m2` (1, 1) | 1 passed | 0 | 98.0 s | passed | **approved** |
| `math.determinants.m1` (1, 1) | 1 render error (`play()` given a mobject) → 2 layout audit (matrix and label overlap) → stopped: Gemini 429 daily quota | (1) | | **error, not served** | |

Renders take 1–4 minutes each at 720p30. LLM use for the whole phase, retries and abandoned runs included: 10 storyboards, 25 code generations and 11 frame checks (about 500k tokens over 132 provider calls). A video costs roughly 1 storyboard + 1–3 code generations + 1–3 frame checks.

## What the automatic checks caught

All of these happened during the phase. Each was fed back and fixed without help:
- **Static lint**: a syntax error in generated code (antiderivative, attempt 2).
- **Render errors**: a string passed where Manim expects a direction; an animation call given a shape instead of an animation; a tangent-line helper used wrongly. The traceback, cut down to the frames in the generated file, went back to the model.
- **Layout audit**, measured inside Manim at every step: text below the phone-readable size (5 times), and two texts overlapping (determinants: a matrix and its label).
- **Vision frame check (Gemini)**:
  - an arrow covering the "2" of 2x cos(x²) (chain rule, an earlier run);
  - a stray solid green block where a highlight box should be (algebraic identities, an earlier run);
  - the general rule shown as ∫f dx = F(x) without + C (antiderivative remake, attempt 1).

## What they missed, and what changed

In the first antiderivative video, a red cross covered **d/dx(x²−3) = 2x**, which is correct. The intended target was the wrong ∫2x dx = x². The formula d/dx(x²+C) = 2x was also drawn on top of a curve. The frame check said the maths was correct. Hand review rejected it ([frames](phase-7/math.antiderivative_basics.m1-REJECTED-frames.jpg)). Changes:
- The frame-check prompt now requires checking exactly which expression every cross or strike covers, and flags any correct expression that is crossed out. It now counts labels drawn over curves as overlaps, and curves running out of frame as off-screen. In the remake, this stricter check caught the missing + C.
- The manifest has a `review` verdict (`pnpm videos:review <id> --approve|--reject "notes"`). A rejected video is **never served**, whatever the automatic status. `--missing` makes it again, and a replaced entry's files are deleted.

**One video in five passed automatically while still wrong.** Until the miss rate is measured on more videos, every new video should get a hand review before it reaches students. See open items.

## Hand review of the frames

Each sheet shows the frames the checker saw: one or two per scene, taken while the scene is still. Every expression was checked by hand.

- **Chain rule** ([frames](phase-7/math.chain_rule.m1-attempt-2-frames.jpg)): d/dx sin(x²) = cos(x²) shown, then crossed in red. Then Δ(x²) ≈ 2x·Δx on two number lines, a gears picture (outer × inner speed), and the chain rule with the inner function and its derivative labelled. Worked: cos(x²)·d/dx(x²) = 2x cos(x²). Correct. Nit: formulas are smallish on a phone.
- **(a+b)² ≠ a²+b²** ([frames](phase-7/math.algebraic_identities.m1-attempt-2-frames.jpg)): (x+3)² = x²+9 crossed out. The test x = 1 gives 16 ≠ 10, and the missing 6 = 2·1·3. Then the area model, (a+b)² = a²+2ab+b², (x+3)² = x²+6x+9, and the check 1+6+9 = 16. Correct. Nits: the grey "Missing Difference" label is low contrast; a caption uses `^`.
- **+ C** ([frames](phase-7/math.antiderivative_basics.m1-attempt-3-frames.jpg), remake): ∫2x dx = x² looks right because d/dx(x²) = 2x. But x²+5 and x²−3 have the same derivative. Then the family of curves y = x²+C, ∫f dx = F(x)+C, and ∫cos x dx = sin x + C. Correct. Nits: the small red ✗ over +5/−3 means "the constant vanishes", but red reads as wrong; the opening example is not finished as x²+C.
- **1 − cos 2x** ([frames](phase-7/math.trig_multiple_angles.m1-attempt-1-frames.jpg)): 1 − cos 2x = 2cos²x is tested at x = 0 (0 ≠ 2) and crossed out. Derived from cos²x − sin²x: 1 − cos 2x = 2sin²x. The pair "minus → sine, plus → cosine", then 1 − cos 60° = 0.5 = 2sin²30°. Correct. Nits: captions write `cos^2 x`; "cos(60)" lacks the degree sign. (The storyboard prompt now asks for superscripts and units.)
- **a³ − b³** ([frames](phase-7/math.algebraic_identities.m2-attempt-1-frames.jpg)): (a−b)(a²−ab+b²) expands to a³ − 2a²b + 2ab² − b³ ≠ a³ − b³, so it's crossed. With +ab the middle terms cancel. Then x³ − 27 = (x−3)(x²+3x+9). Correct. Nits: the cross covers the whole "≠ a³−b³" block; the long expansion line is small on a phone.

None of the served videos has overlapping text, cut-off text or wrong maths.

## What was built

### Pipeline (`pnpm videos:generate`, `apps/cli/src/videos/`)

Per misconception:
1. **Targets**: `rankMisconceptions()` (core) ranks the misconceptions named in the students' reports, by number of students, then records. Default: the top 5 in Mathematics/Physics. `--only`, `--subjects`, `--top`, `--missing`, `--list`.
2. **Storyboard** (task `write_storyboard`): 5–8 scenes, 60–120 s, one idea. It starts from the typical wrong step and builds intuition visually, then gives the rule, a worked example and the takeaway. Each scene has a caption (≤ 120 characters), visual directions, the LaTeX shown, seconds, and optional narration. It is built on the **verified Phase 6 step explainer** when one exists (same wrong step, rule and numbers). Validated by `StoryboardSchema`; invalid replies go back for repair. Input is graph text only: videos are per misconception, so **no student data** is involved.
3. **Code** (task `codegen_manim`): one `ExplainerScene(ProgressoScene)` file built on the shared base scene.
4. **Quality loop**, at most `--max-attempts` (default 4) renders. Each failure's problems go back to the generator with the previous code:
   - **lint** (`tools/manim/lint.py`, an allow-list, because the code runs on this machine): only manim/numpy/math/random imports; no file, process or reflection builtins; no dunder access; no images, SVGs or sounds; no `while`; no reassigning Manim's direction constants or the palette; no overriding the audit hooks; at least 3 captions.
   - **render** (Manim 720p30, 20-minute timeout, traceback reduced to the generated file's frames);
   - **duration** 55–130 s (ffprobe);
   - **layout audit**: the base scene measures every visible text after every animation. It flags text off the frame, text in the caption band, overlapping texts, text below phone-readable size (Text < 28, MathTex < 34 font size) and captions over two lines;
   - **frame check** (task `check_frames`, Gemini multimodal): frames are taken from the middle of the scene's **still moments** (`wait()`s, recorded by the base scene), never mid-animation. Gemini gets the storyboard and the caption each frame should show. It reports overlap, off-screen, wrong maths (including correct expressions crossed out), unreadable layout and mismatches as blocker or minor. Any blocker, or `maths_correct: false`, fails the attempt.
5. **Pass**: a web-ready H.264 MP4 (faststart, CRF 26, about 0.6–1.1 MB), a poster, WebVTT captions from the recorded caption times, and the scene code go to `data/videos/mathematics/`; the entry goes to `data/videos/manifest.json`. **Fail**: a `failed` entry with every attempt's problems, never served.

Rate limits: every call goes through the LLM layer (per-provider limiter, backoff, fallback models, response cache), and renders run one at a time. Runs resume cheaply: storyboards and code come from the cache unless `--fresh` is passed.

**Narration** is optional and swappable: `NarrationProvider` (`narration.ts`) turns the storyboard's narration lines and the caption timings into an audio track, which the pipeline muxes in. Only `none` exists now (captions only). A text-to-speech engine is one implementation plus registering it; `--narration <name>` selects it.

### Base scene (`tools/manim/progresso_manim.py`)

A palette (WRONG red, CORRECT green, HILITE yellow, ACCENT blue), a content box above a fixed caption band, `caption()`, `clear_content()` and `fit()`. It records the layout audit, caption times and still moments, written as JSON to `$PROGRESSO_AUDIT`.

### Format and loading (`@progresso/core`, `src/videos/`)

- `StoryboardSchema`, `VideoEntrySchema` and `VideoManifestSchema` are all strict. A passing entry needs its files, captions, a frame check, and a passing last attempt. File paths can't leave the videos dir.
- `loadVideoLibrary(dir, graph)` serves only entries that passed, are not rejected on review, have every file present, and whose misconception is in the current graph. A graph swap never breaks it.
- `captionsToVtt()`, `rankMisconceptions()`, `isServable()`.
- `config/app.json` gained `videosDir` (`VIDEOS_DIR`).

### LLM layer (`@progresso/llm`)

- **Images**: `images: [{ mimeType, data, label }]` on any call. Gemini sends them as inline parts, Anthropic as image blocks, OpenAI-compatible as data URLs. The cache key includes each image's hash, and the PII guard checks image labels.
- New task `write_storyboard`; `codegen_manim` and `check_frames` configured, with `gemini-3-flash-preview` as an extra fallback.
- **Two reliability fixes**, found when runs hung:
  - A hard client-side deadline on Gemini calls (AbortController), because the SDK's timeout wasn't always enforced.
  - A 429 asking to wait more than 60 s (an exhausted daily quota) now moves straight to the next fallback model instead of sleeping until the quota resets.

### Web

- `/media/videos/<misconception>/{video.mp4, poster.jpg, captions.vtt}` serves only manifest entries (the path never comes from the URL), with byte ranges so the player can seek.
- **Mission player, step 2**: when a served video exists for one of the mission's misconceptions (the student's own first), it is the explainer. The video never auto-plays (phone data). It has a captions track and a "Read the captions" transcript, and "Prefer to go step by step?" opens the step explainer. With no video, or if the video fails to load, the step explainer is shown as before.
- **Replays**: an "Explainer videos" section.
- `stepContent` counts a video as explainer content.

### Tests

- Unit:
  - storyboard length and caption limits;
  - manifest rules, including path traversal;
  - library loading (failed, rejected, missing files, unknown misconception, broken manifest);
  - ranking, WebVTT;
  - the lint allow-list (13 cases);
  - LLM images (pass-through, cache key, PII guard);
  - quota fallback without sleeping.
- E2E (`e2e/videos.spec.ts`, desktop and phone):
  1. a served video plays, seeks with a 206 range response, has a captions track and transcript, and passes axe; step-by-step stays available;
  2. an unreachable video file falls back to the step explainer;
  3. a mission with no served video shows the step explainer. Kabir's trig topics are marked proven in the e2e database, so his plan re-flows to his chemistry root. Failed or rejected videos and a path-traversal URL return 404, and Replays lists only served videos.
- The Phase 6 lesson test now opens the step explainer behind the video when one leads.

## Development notes (fixed during the phase)

- Manim names the output folder after the module, so a successful render was first reported as failed.
- The palette's green was first named `RIGHT`, which overwrote Manim's direction vector. The lint now forbids reassigning such constants.
- Frames sampled at fixed points landed mid-animation (a half-written expression was reported as cut off). They are now taken from still moments.
- Stopping a run's shell didn't stop its node processes, so several runs competed for the free-tier quota until they were found and killed.

## Open items

- **Hand review before serving.** The automatic checks passed one wrong video in five. Recommended: serve only `approved` videos once there is a reviewer. That is a one-line change in `isServable()`, kept off for now so the pipeline stays fully automatic as specified. Or add a second reviewer model from another vendor.
- **Sizes on phones**: formulas are readable but smallish at 360 px wide. Raise the minimum MathTex size (34 → 44) and use more of the content area.
- **Determinants** and the rest: `pnpm videos:generate --missing --top 10` once the daily Gemini quota resets. The free tier (20 requests a day per model) covers about 2–3 videos a day; a paid key removes the limit.
- **Chemistry** works through `--subjects Chemistry` but hasn't been run. It needs checks suited to chemistry (structures and mechanisms rather than equations). **Physics** needs a physics graph (Phase P).
- Captions written by earlier storyboards use `^`; the prompt is fixed for new ones.
- Narration: plug in a TTS provider if wanted. The interface is ready.
