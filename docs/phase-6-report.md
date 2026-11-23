# Phase 6 report: Mistake Recap and step explainers

Date: 2026-11-23. Status: **done**. Both pieces work from the report text only: the error record, plus the graph's misconception wording. Everything is generated offline, verified and cached as files; nothing is generated at runtime.

Gate results:
- **Recaps: 11 verified** for real (sample) errors. **7 use the student's own working** (the report quotes it) and **4 use a typical step** (the report names the mistake but doesn't quote the working). Every one was read against its report (below).
- **Step explainers: 6 verified** misconceptions (3 maths, 3 chemistry). Each was read; 4 needed a wording correction (listed below).
- `pnpm verify`: typecheck, lint, **174 tests** (14 files), graph validation: all pass.
- `pnpm e2e` (production build): **37 Playwright tests passed** (3 skipped by design), including 4 new lesson tests on desktop and phone; frame rate unchanged (60 fps). axe WCAG 2.1 AA clean on the new screens.
- Screenshots: `docs/screenshots/phase-6/` (local only, git-ignored like the earlier phases; `pnpm e2e` regenerates them). One per recap and per explainer, desktop and phone.

Everything shown is SAMPLE DATA (demo fixtures), labelled as such in the UI. Recaps made from fixtures live in `data/fixtures/demo-recaps/` and are deleted with the fixtures in Phase P.

## What was built

### 1. Lesson content format (`@progresso/core`, `src/lessons/`)

- `MistakeRecapSchema`: one per error record, keyed by `record_id`, carrying a `source_hash` of the record fields it was made from. A recap whose record has changed is ignored (`recapFor`), so a re-parsed report never shows an out-of-date recap.
- **Two modes, chosen by the record, never by the model** (`recapModeFor`):
  - `student_working`: the report quotes the working (`student_working` exists). The recap's wrong lines must be **that quote cut into consecutive slices**. `checkRecapStructure` joins them back and compares them with the quote, whitespace-insensitively. Each wrong line carries `mark`, the exact substring to circle, which must occur in its line. Nothing can be added to what the student wrote.
  - `typical_step`: no quote. The wrong lines are LaTeX, may not carry a handwriting mark, and the schema refuses the handwriting format for them.
- `StepExplainerSchema`: one per misconception. 4–9 steps (`wrong → why → idea → rule → example → check`). It must start from the typical wrong step and must state the correct idea, with one board formula and one narration line per step.
- `loadLessons()` / `recapFor()`: a file-based library. Content for misconceptions missing from the graph is skipped with a warning, so a graph swap never breaks the app.
- `prettyWorking()`: display-only notation swaps for the handwriting (`x^2` → `x²`, `sqrt(` → `√(`, `theta` → `θ`). It never adds, drops or reorders anything.

### 2. Generation and verification (`pnpm lessons:generate`, `apps/cli/src/lessons/`)

The same discipline as the Phase 5 questions. Each item goes through:
1. **Generate** (tasks `write_recap` / `write_explainer`). The prompt gets the subject, topic, question text, the report's diagnosis and correct approach verbatim, the quote if any, and the misconception wording. **No names or student ids.**
2. **Structural checks** (above). These include LaTeX outside `$…$` and control characters left by JSON-escape damage (`\t` in `\text` → TAB; repaired before checking).
3. **SymPy** for maths (`tools/cas/check.py`, the Phase 5 allow-listed checker): the answer is worked out from scratch. Every line claiming the answer must equal it, and every wrong step must differ from it (a "wrong" step that is secretly right is rejected).
4. **Independent review** on a different model (`review_lesson`). For a recap, the reviewer locates the erroneous line itself (it must be the marked one), and checks that the marked part is the reported error, the note matches the report, the fix is correct and agrees with the report, and a typical step really shows the reported mistake.
5. Rejects are logged to `_generation-report.json` and nothing is saved.

Generator `gemini-3-flash-preview`, reviewer `gemini-2.5-flash`. Flags: `--recaps`, `--explainers`, `--only`, `--missing`, `--list`, `--model`, `--review-model`, `--fresh`.

### 3. Mission player (web)

- **Step 1, Mistake Recap** (`components/missions/MistakeRecap.tsx`). The header gives the real context: exam name, question number, marks lost ("Half-Yearly Examination · Q12 · 2 of 2 marks lost"), then the question.
  - **Own working:** shown in handwriting on ruled paper, labelled *"Your working, as quoted in your report"*. Lines write in one by one, then the error is circled in red with a ✕ and a pen note.
  - **Typical step:** printed (KaTeX, not handwriting) under an amber **"Not your working"** badge: *"Your report names this mistake but doesn't quote what you wrote. This is the kind of step that goes wrong here."*
  - Then the fix appears step by step (KaTeX, with margin notes), then the key idea, then the report's own words. 10–20 s; **Skip animation**, **Replay**; reduced motion shows it all at once. Several of the mission's mistakes get a switcher. Records without a recap fall back to the Phase 5 evidence list.
- **Step 2, Step explainer** (`StepExplainer.tsx`). A board that writes one formula per step (earlier formulas stay above, the wrong one struck through), a narration line, auto-play with Back / Play-Pause / Next / Replay, and step dots. The student's own misconceptions come first, badged "In your report". Board formulas shrink to fit the width on a phone (down to 55%, then scroll).
- **Replays page** (`/s/[id]/replays`): every recap and explainer prepared for a student, linked from Today.
- The browser receives the rendered lesson view only (`server/missions.ts`); the verification detail is reduced to "maths checked by SymPy, reviewed independently".

## Hand check of every recap

Each recap was read against its record: is the marked step the error the report describes, and is every correction right?

| Record | Mode | Marked step | Correction (verified) | Verdict |
|---|---|---|---|---|
| demo-riya.ut1.q7 (sin x²) | own working | `cos(x^2)` | 2x cos(x²) | ✔ |
| demo-riya.hy.q18 (implicit) | own working | `y + 2y` (xy → y, y² → 2y, no dy/dx) | −(2x+y)/(x+2y) | ✔ |
| demo-riya.pb1.q9 (parametric) | own working | `(3a sin^2 θ)/(3a cos^2 θ)` (inner derivatives missing) | −tan θ | ✔ |
| demo-kabir.hy.math.q12 (∫sin²x) | own working | `(sin^3 x)/3` (power rule on sin x) | x/2 − sin2x/4 + C | ✔ |
| demo-kabir.hy.math.q8 (∫cos²x) | own working | `(1 - cos 2x)/2` (sin² identity used for cos²) | x/2 + sin2x/4 + C | ✔ |
| demo-kabir.hy.chem.q19 (anisole) | own working | "electron withdrawing group", "deactivates" (−I only) | +R > −I, activating, o/p | ✔ |
| demo-vihaan.ut1.math.q9 | own working | `(x + 1)/x` (2√x dropped) | −x^(−3/2) − x^(−2) | ✔ |
| demo-riya.ut1.q11 (log cos x) | typical step | dy/dx = 1/cos x | −tan x | ✔ |
| demo-riya.hy.q22 (∫x e^(x²)) | typical step | x dx replaced by dt | ½ e^(x²) + C | ✔ |
| demo-riya.hy.q30 (ink blot) | typical step | dA/dt = 2πr (no dr/dt) | 4π cm²/s | ✔ |
| demo-riya.pb1.q3 (\|adj A\|) | typical step | \|adj A\| = \|A\| | 4² = 16 | ✔ |

- In every own-working recap the lines reproduce the report's quote exactly. Where a later line is wrong only as a *consequence* (Kabir Q8's final integral), only the root step is circled, as the report describes.
- Every typical-step recap carries the "Not your working" label, and its wrong step arrives at the answer the report says the student gave.
- Cosmetic, not fixed: `adj` and `OCH₃` render in maths italics.

Not shipped:
- `demo-kabir.pb1.chem.q8`: the reviewer put the error on a different line; rejected.
- `demo-vihaan.pb1.math.q14`: the generated SymPy used `.subs()`, which the checker's allow-list refuses; rejected.
- `demo-riya.pb1.q15`: logged as verified by an earlier run, but its file is not in the library (it was removed before this session). Not reviewed, not shipped.

## Hand check of every explainer

| Misconception | Subject | Checks | Corrected? |
|---|---|---|---|
| math.chain_rule.m1 | Maths | structure, SymPy, review | yes (1) |
| math.algebraic_identities.m1 | Maths | structure, SymPy, review | no |
| math.integration_trig_identities.m1 | Maths | structure, SymPy, review | no |
| chem.resonance_effect.m1 | Chemistry | structure, review | yes (2) |
| chem.amine_basicity.m1 | Chemistry | structure, review | yes (3) |
| chem.phenol_acidity.m1 | Chemistry | structure, review | yes (4) |

The automatic pipeline passed all six, but reading them found four factual slips. I corrected the text by hand (wording only, no maths changed). **These edits were made after the automatic verification and have not been re-reviewed by a person; please confirm them:**
1. `math.chain_rule.m1`, "why": "x² changes much faster than x" is false near 0 → "If x changes by a little, x² changes by about 2x times as much."
2. `chem.resonance_effect.m1`, "why": an unsourced "about 10,000 times faster" → "much faster than benzene".
3. `chem.amine_basicity.m1`, board: "Anilinium ion has NO resonance" (the ring keeps its resonance) → "Anilinium: no lone-pair delocalisation".
4. `chem.phenol_acidity.m1`, "idea": the arrows `O⁻ ⟵ Ring ⟵ NO₂` pointed the wrong way → `O⁻ ⟶ Ring ⟶ NO₂`, and the narration now says the charge is pulled away from the oxygen onto the nitro group.

Lesson: chemistry explainers have no machine check equivalent to SymPy, and the same-family LLM reviewer passed all three chemistry slips. A second-vendor reviewer (or a person) for chemistry is an open item.

Rejected by the pipeline this session (working as intended):
- `math.implicit_differentiation.m1`: the reviewer found an incorrect step.
- `math.increasing_decreasing.m1`: SymPy showed the "wrong step" was equal to the answer.
- Five more targets hit Gemini 503 (high demand); retry with `pnpm lessons:generate --explainers --missing`.

## Phone readability

On the phone viewport, long board formulas (chemistry `\text{…}` lines) were clipped. They now shrink to fit the board. The recap's fix lines scroll sideways if they ever exceed the width. Element screenshots now hide the fixed top bar and tab bar (they used to overlay the shots).

## Decisions later phases rely on

- Phase 7 (Manim) adds videos **on top of** `StepExplainer`. The explainer stays the always-available fallback, keyed by `misconception_id`.
- Phase P: the parser fills `student_working` only when the report quotes it. That single field decides the recap mode, and the structure check guarantees the quote is shown verbatim. Real recaps should go to a non-fixture directory (`recapsDir` in `config/app.json`).
- Lesson content is data. A missing recap or explainer degrades to the Phase 5 evidence list or a "not made yet" panel.

## Open items

- Fill the remaining targets: 30 recaps, 27 explainers (`--missing`).
- A second-vendor or human reviewer for chemistry content (see above); confirm the four hand edits.
- Allow `.subs()` in the CAS checker for "evaluate at a point" questions, or prompt for numeric mode.
- Render `adj` and chemical formulas upright (`\operatorname{adj}`, `\text{OCH}_3`).
