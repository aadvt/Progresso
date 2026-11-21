# Phase 5 report: from diagnosis to action

Date: 2026-11-21. Status: the **structure is complete and verified end to end**; the question bank is deliberately small for now (9 verified questions over 3 misconceptions; see "Question bank" below). Agreed with the product owner: ship the general structure now, add the remaining question data later with `pnpm questions:generate --missing`.

Gate results:
- `pnpm verify`: typecheck, lint, **162 tests** (13 files), graph validation: all pass.
- Production build passes. `pnpm e2e`: **33 Playwright tests passed**, 3 skipped by design (desktop-only tests on the phone project); axe WCAG 2.1 AA on every new screen; frame rate unchanged (60 fps desktop and phone, also at 4× and 6× CPU slowdown).
- 14-day simulation: [`phase-5-simulation.md`](phase-5-simulation.md).
- Screenshots: `docs/screenshots/phase-5/`, local only (git-ignored, not in the repo); `pnpm e2e` regenerates them.

Everything shown is SAMPLE DATA (demo fixtures), labelled as such in the UI.

## What was built

### 1. Comeback plan generator (`@progresso/core`, `src/missions/`)

`buildPlan({ graph, analysis, records, settings, today, progress })` → `ComebackPlan`. Pure and deterministic: the plan is never edited, it is **recomputed** from the diagnosis plus progress (mastery and mission history) after every change, so it re-flows by construction.

- **Work** (`work.ts`): one block per root, then one per one-off conceptual gap (slips and habits are not knowledge gaps and get no missions).
  - Blocks go highest marks-per-study-hour first, with one hard constraint: a root never comes before a root it is built on (deepest root first).
  - Inside a root block: re-learn the root (1–3 *learn* missions, scaled by its share of the marks), then one *apply* mission per topic where its mistakes surfaced, in prerequisite order (nearest topics first).
- **Days** (`plan.ts`): working back from the exam date, with `floor(daily_minutes / 25)` mission slots a day.
  - **Reviews** come from FSRS due dates. The plan projects future reviews for concepts it expects to be proven, so the timeline shows them. A review takes a slot when ≥3 are due, when one is ≥2 days overdue, or when there is no learning left. Spare minutes (≥10) host a quick review.
  - **Buffer days** before the exam: 2 if the plan spans ≥14 days, 1 if ≥5. They hold rotating rehearsals, not new topics.
  - Missions that don't fit are listed as unscheduled, lowest marks per hour first, with a warning.
- **Mission structure** is fixed: **Mistake Recap (5 min) → Explainer (10 min) → Prove it (10 min)**. Recap and explainer carry `content: "placeholder"` for Phase 6 to fill; the structure, timings and data flow are real. The recap already shows the report's verbatim evidence; the explainer lists the concept's misconceptions with the student's own flagged "In your report".
- **Re-flow rules:**
  - A skipped day moves everything forward.
  - Early mastery drops the concept's remaining learn missions.
  - A failed final attempt adds a retry, up to `maxRetries` (2). Then comes one last go flagged "needs help", and after that the concept is **parked** (out of the plan, with a "worth asking a teacher" warning) so it can't block everything behind it.
  - A failed review lapses the concept back into learning.
  - A topic whose missions had **no verified questions** counts as studied once its planned missions are done ("Studied but not proven yet" warning) instead of looping.

### 2. "Prove it" questions (`src/questions/`, `apps/cli/src/questions/`, `tools/cas/check.py`)

- `ProveItQuestionSchema` (strict). MCQs have exactly one correct option, and **every wrong option carries a `misconception_id`** and a pre-written explanation. Numeric questions carry anticipated wrong values (`numeric_wrong`), each mapped to a misconception the same way.
- **Generation** (`pnpm questions:generate`), offline only; nothing is generated at runtime.
  - Targets come from the demo diagnoses: each root's misconceptions (×4 questions), each apply topic and each one-off (×3). Distractors are built from the concept's misconceptions **plus the anonymised wording of the student's actual mistakes** (no names, no ids, no exam details in the prompt).
  - Structural checks follow.
  - **SymPy** then recomputes the maths answer from scratch and proves every distractor differs. The checker parses with an identifier allow-list and refuses anything else.
  - An **independent LLM solve** that never sees the key must reach the keyed answer. Questions without a symbolic proof (chemistry) need a **second** solve to agree.
  - Anything that fails any check is discarded and logged in `data/question-bank/_generation-report.json`.
  - New this phase: each target is saved as soon as it finishes, and the report accumulates across runs. `--missing` tops up only the targets with no verified questions yet, and `--only a,b` takes a list.
- **Selection** per mission is greedy and deterministic. It prefers the student's own report misconceptions, then misconceptions still "alive", unseen questions, coverage spread, and one numeric question when available.
- **Grading happens on the server only.** The browser never receives the answer key; feedback arrives after the answer is locked (first answer counts).
- **KaTeX** renders `$…$` maths (`MathText`, `trust: false`). Radio options get a plain-text accessible name (`plainMath`), because KaTeX markup alone has none. Axe caught this.

### 3. Mastery gating and FSRS (`mastery.ts`)

- **Mastery rule.** A check is 4 questions. It **passes with ≥75% right AND no wrong answer revealing one of the student's own report misconceptions** (repeating the original mistake means it isn't fixed, whatever the score). With fewer questions available, the same share applies (3 questions: 3/3).
- **Ratings to FSRS:** fail = Again, pass with a miss = Hard, all right = Good. Reviews (2 questions) pass with at least half right.
- **States:**
  - `learning` → `proven` on a gate pass;
  - `proven` → `retained` after a passed review ≥3 days later;
  - a failed review lapses the concept to `learning`;
  - a first check with nothing right marks a `gap`.
- **Misconceptions** have a status. Report misconceptions start alive; picking a wrong option revives its misconception; a right answer to a question aimed at it clears it. Today shows "Still to shake off".
- **FSRS:** ts-fsrs 5.4.2, request retention 0.9, no fuzz, **maximum interval 14 days** so nothing drifts past the exam. A manual clamp is needed because ts-fsrs overshoots by a day.
- `finishMission` writes `concept_mastery` (state, FSRS card, due date) and `review_log`. Because the constellation reads `concept_mastery`, **a root going to `proven` plays the Phase 4 ripple** (the result screen's "See the chain reaction" opens `/constellation?ripple=<root>`).

### 4. Readiness meter (`readiness.ts`)

- Always a **range**, always labelled **Estimate**, per subject then averaged, with three values: *when you started*, *now* and *if you finish the plan*.
- **What each mistake costs:** marks lost ÷ that exam's maximum, averaged over the subject's exams.
- **How likely it's fixed:**
  - for a root-explained mistake, 0.7 × the root's fix probability + 0.3 × the tested topic's;
  - for a one-off, the topic's own;
  - habits have their own small factor.
- **Fix probabilities come from mastery state:** none/gap ≈ 0, learning ≈ 0.35, proven ≈ 0.75, retained ≈ 0.88. The low end of a proven topic is discounted by its FSRS retrievability on the exam date.
- **No marks in the report:** the cost is estimated from the unit's board weightage (capped at a long question), and the range widens by half that estimate. The UI then says so.
- **Exam noise** of ±3 points widens every range.

### 5. UI (`apps/web`)

- **Today** (`/s/[id]/today`):
  - first visit shows "Two questions, then your plan" (exam name and date, 25/50/75 minutes a day);
  - after that: today's mission card, plan progress, "Coming up", "Still to shake off", the readiness meter and warnings;
  - a demo clock ("Skip to tomorrow", "Reset plan") for sample students.
- **Mission player** (`/s/[id]/mission/[id]`):
  - a stepper with focus management, recap, explainer, then the questions;
  - **right answers** get a short burst and an encouraging line;
  - **wrong answers** get "Not quite, and here's exactly why.", then the slip named in plain words, the pre-generated explanation for *that* wrong option, "Same slip as in your ‹exam›, ‹Q›" when it matches the report, and a worked solution;
  - the **result** shows proven / "Not yet, and that's useful" per concept (before → after), the readiness change, the ripple link and the next mission;
  - with no verified questions yet: "Mark as studied" (counts as learning, never as proven);
  - reduced motion respected.
- **Plan** (`/s/[id]/plan`): the full timeline by week to exam day, with Today, Buffer, missed and skipped days, the exam, and "Not in the plan".
- Navigation: Today / Plan / Diagnosis / Map tabs (a bottom tab bar on phones). The diagnosis call to action now leads to Today (the Phase 3 placeholder dialog is gone).

## Question bank

| | |
|---|---|
| Targets in the full list (`--list`) | 37 targets (concept, misconception), 4 demo students |
| Targets generated so far | 3 (2 chemistry, 1 maths) |
| Questions generated / verified / rejected | 10 / 9 / 1 |
| Misconceptions covered | 3 (`math.chain_rule.m2`, `chem.amine_basicity.m1`, `chem.resonance_effect.m1`), Mathematics and Chemistry |

`_generation-report.json` lists the two chemistry targets (6/6 verified). The chain-rule file comes from the first trial run, which verified 3 of 4 questions (one rejected because the independent solver disagreed). That run predates the per-target report saving, so its entry isn't in the report file.

**Why the bank is small (honestly):**
1. The configured model (gemini-3.8-flash) returned 503/504 on every call. Generation was switched to gemini-3.6-flash with an env override.
2. A full parallel run was stopped by the machine running low on memory. Before this phase's fix the generator wrote files only at the end, so that run's verified targets were lost. It now saves each target as it finishes.
3. The API key's free tier then hit its daily quota (429: 20 requests a day for that model).

**Caveat on the chemistry second opinion:** with only one model reachable, the second solve was the *same* model using a different method (option-by-option elimination), not a second model. It is a weaker check than two models. `--second-model <name>` switches it when another model is available, and the report records which was used.

The brief's target ("≥10 misconceptions across subjects") is **not met yet**. The product owner chose to add the data later; `pnpm questions:generate --missing` resumes where this left off.

### Five examples, checked by hand

Every keyed answer below was worked by hand and is correct; each wrong option's misconception matches the slip it represents.

1. **`math.chain_rule.m2.chain_rule.1`**: Find d/dx cos(x³).
   - **Key B: −3x² sin(x³).** SymPy: pass; independent solve: pass.
   - A: −sin(x³) → `math.chain_rule.m1` (chain rule not applied: forgot the inner derivative).
   - C: 3x² cos(x³) → `math.chain_rule.m2` (differentiated the inside, left the outside unchanged).
   - D: 3x² sin(x³) → `math.derivative_basics.m1` (sign of d/dx cos dropped).
2. **`math.chain_rule.m2.chain_rule.2`**: dy/dx for y = tan(3x²).
   - **Key C: 6x sec²(3x²).** ✓
   - A: 6x tan(3x²) → `m2` (outer left alone).
   - B: sec²(3x²) → `m1` (no inner factor).
   - D: 6x tan(x) → `math.composite_functions.m2` (treats the composition as a product).
3. **`math.chain_rule.m2.chain_rule.3`**: dy/dx for y = e^{cos 3x}.
   - **Key D: −3 sin(3x) e^{cos 3x}.** ✓
   - A: −sin(3x)e^{cos 3x} → `math.chain_rule.m3` (stops one layer early in a triple composition).
   - B: 3 sin(3x)e^{cos 3x} → `derivative_basics.m1` (sign).
   - C: 3e^{cos 3x} → `m2`.
4. **`chem.amine_basicity.m1.amine_basicity.2`**: decreasing basicity of CH₃NH₂ (I), aniline (II), m-nitroaniline (III), p-nitroaniline (IV).
   - **Key: I > II > III > IV.** ✓ (alkylamine > aniline; –NO₂ withdraws by −I from meta but by −R and −I from para, so para is the weakest.) Two independent solves agreed.
   - II > I > … → `chem.amine_basicity.m1` (thinks the ring donates to N).
   - IV > III > II > I → `chem.organic_acidity_basicity.m1` (judges by stability of the neutral molecule).
   - I > II > IV > III → `chem.resonance_effect.m2` (resonance acting at meta).
5. **`chem.resonance_effect.m1.directive_influence.2`**: why phenol is far more reactive than benzene to electrophilic substitution.
   - **Key: –OH donates by +R, outweighing its −I, activating the ring.** ✓ Two solves agreed.
   - "–OH withdraws by −I so the ring is electron-poor" → `chem.resonance_effect.m1` (electronegativity only, resonance ignored).
   - "all o/p directors deactivate" → `chem.directive_influence.m1`.
   - "undergoes addition instead of substitution" → `chem.electrophilic_aromatic_substitution.m1`.

The other four questions (dimethylamine as the strongest base; benzylamine > p-anisidine; anisole's –OCH₃ and acetanilide's –NHCOCH₃ as activating o/p directors) were also checked and are correct.

## Simulation: Riya, 14 days at 25 min/day

`pnpm simulate demo-riya --out docs/phase-5-simulation.md` runs the real services (`startMission` / `answerQuestion` / `finishMission`) on a throwaway in-memory database with the real bank. The answer script is seeded (~70% right). On day 1 it brings back her report's own mistake once; day 2 is all right; day 4 is skipped; day 5 is mostly wrong.

| Day | What happened | Plan | Mastery / map | Readiness (mid) |
|---|---|---|---|---|
| 1 | Chain rule check 2/3, and the wrong pick was her own report misconception (`m1`): **not proven** | learning 1/13, new topics done by 6 Dec | chain rule → learning; 10 weak stars | 89–98% (93.0) |
| 2 | Retry 3/3: **proven, ripple fires** | remaining learn missions drop: 2/12, done by 5 Dec | root mastered, **21 stars lit**, weak 10 → 4 | 90–100% (95.1) |
| 3 | Apply: exp/log derivatives (no questions yet → studied) | 3/12 | learning 7 | 95.3 |
| 4 | **Skipped** | everything shifts a day: done by 7 Dec | unchanged | 95.3 |
| 5–6 | Apply: implicit, parametric differentiation (studied) | 5/12, done by 5 Dec again | | 95.5 |
| 7 | **FSRS review** of the chain rule, 1/2 right: passes | | chain rule proven → **retained** | 91–100% (96.2) |
| 8–11 | Apply: second-order, inverse-trig derivatives, substitution, rates of change | 9/12 | | 96.5 |
| 12–14 | One-offs: continuity, inverse-trig principal values, matrix inverse | **12/12 learning done** | weak 0, learning 10, mastered 1 | 92–100% (97.0) |

What this shows:
- The gate refuses a pass that repeats the original mistake (day 1).
- The ripple fires from the database write (day 2).
- The plan absorbs a skipped day (day 4) and slots an FSRS review on time (day 7).
- Readiness moves only when real progress happens.

One effect is masked: day 5's "mostly wrong" script had nothing to bite on, because only the root has questions. In the first simulation run (before the "studied, not proven" rule) the empty apply topic looped for 10 days. That's the bug the run exposed and this phase fixed (unit-tested).

**Readiness numbers are high in absolute terms** because the sample fixtures list only a few mistakes: Riya has 11 records over three papers (200 marks). Only 3 records state marks (5 marks lost), and the other 8 are estimated from board weightage. The model assumes what the reports don't mention was right. With real reports covering every lost mark the levels will be lower; the movement is the point here.

## End to end (Playwright)

`e2e/missions.spec.ts` runs on desktop (1440×900) and phone (Pixel 7). It plays Riya's full flow, adapting to the bank on disk:

1. Plan setup → Today (mission card with the three steps, readiness "Estimate") → Plan timeline (buffer days).
2. Mission: recap (the report's words) → explainer ("In your report") → question 1 answered **wrong**, then "The slip: …" with the misconception's explanation → the rest right.
3. With 3 questions, one miss fails the gate, so the result is "Not yet, and that's useful". Then "Skip to tomorrow": the plan has re-flowed with a retry of the root, and the retry is answered all right → **"Proven: Chain rule"** with the readiness delta.
4. "See the chain reaction" → the constellation plays the ripple from the DB write.
5. Today: "Done for today", "points since you started", "Next up: Chain rule in …". Skipping again gives the first apply mission. Then reset.

Also covered:
- a topic without verified questions (Kabir's root): "Mark as studied" → "Studied: …";
- a habits-only student (Ananya): "no knowledge gap to fix".

Axe runs on every step. Mission tests run in their own projects after the map tests, because both write mastery for the same demo students.

Screenshots (prefix `missions-desktop-` / `missions-mobile-`):

| Step | Files |
|---|---|
| Setup, Today, Plan | 01–03 |
| Recap, explainer | 04–05 |
| Question, wrong / right feedback | 06–08 |
| Not yet, proven | 09a, 09 |
| Ripple, Today after | 10–11 |
| Habits-only, no questions yet, studied | 12–14 |

## Decisions later phases rely on

- **Mastery is an overlay** on the report's diagnosis: roots are never removed from the diagnosis by it, only shown as fixed.
- Any writer of `concept_mastery` moves the map; `finishMission` is the one mission path.
- The plan is a pure function of (diagnosis, settings, today, progress); never store a plan, only progress. The MCP server (Phase 10) answers "what tonight?" with `nextMission(buildPlan(...))`.
- Phase 6 fills `MissionStep.content` for `recap` and `explainer`. The steps, timings, and the recap's verbatim evidence are already wired.
- Phase 9 (calendar) can read `ComebackPlan.days` directly.
- The question bank is data. The app loads whatever is in `data/question-bank/`, and every screen copes with none.

## Open items

- **Question data:** run `pnpm questions:generate --missing` when quota allows (34 targets left); ideally with a second model for chemistry (`--second-model`). The bank-integrity test checks every file that lands.
- The explainer and recap content are placeholders (Phase 6).
- Readiness on real reports: re-tune `fixProbability` and the weightage estimate once real outcomes exist. The error-record format has no total score per exam, so the meter can't anchor to actual marks yet (Phase P).
- `MasteryEvidence` from missions isn't fed back into the root-cause engine; mastery stays an overlay (decision above).
- The demo clock (`demo_day_offset`) is for sample students only; real students use the real date.
