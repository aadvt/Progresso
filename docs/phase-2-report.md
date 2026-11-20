# Phase 2 report: root-cause engine

Date: 2026-11-21. Status: verification gate passed (`pnpm verify`: typecheck, lint, 92 tests, graph validation).

## What was built

- **`analyseStudent({ graph, records, mastery?, params? })`** in `@progresso/core` (`packages/core/src/root-cause/`). Pure, deterministic, no I/O, no LLM, no clock. Takes one student's error records (any number of exams and subjects) and the concept graph, and returns:
  - **roots**: each with the concept, the errors it explains (each with the prerequisite path from the root to the topic the question tested), confidence, marks lost (actual and estimated parts), board marks that build on it, marks recoverable, a study-time estimate (hours and 25-minute missions), the ranking key (marks recoverable per hour), branch coverage, repeated misconceptions, any counter-evidence, close alternatives, and a plain-language explanation;
  - **standalone** errors (no shared root, or unmapped);
  - **habits**: slips grouped into patterns (the same named slip twice, careless, calculation, notation, unfinished answers);
  - a **headline** such as "Fix these 2 things → explains 10 of your 12 errors → about 19 marks at stake."
- **Optional `mastery` input** (`MasteryEvidenceSchema`): evidence that a concept works (a report praising a topic, a correct answer, later a passed Phase 5 "prove it" check). It lowers blame on that concept and its prerequisites.
- **LLM wording** (`wordExplanations(analysis, client)`): the LLM (task `explain`, Gemini Flash by default) may only re-word each root's explanation from a fact sheet. The prompt carries concept names and counts only (no student id, name or report text), the PII guard blocks display names, the response is cached by the LLM layer, and any failure falls back to the template. Core does not depend on `@progresso/llm`; it accepts any client with a `generateObject` method.
- **CLI**: `pnpm analyse <student-id> | --all [--json] [--llm]`, in a new small package `apps/cli` (`@progresso/cli`). It lives there because it needs both `core` and `llm`, and `llm` already depends on `core`.
- **Text formatter** `formatAnalysis()` (core), reusable by the MCP server later.

## The algorithm, in plain words

Think of every error as a clue, and every concept in the graph as a suspect.

1. **Where does each clue point?** An error record names the concept the question tested (primary), sometimes other concepts involved (secondary), and sometimes a named misconception, which belongs to a concept. Those are the error's *anchors*. Each anchor gets a strength: the mapping's confidence (secondary × 0.85; a named misconception counts at its own confidence).
2. **Walk back through the prerequisites.** From each anchor we walk up the graph. Every concept on the way could be the real cause, but each step back the clue gets weaker (× 0.65 per step), because one more step means one more place the mistake could have come from. That stops the most basic concept from collecting everything. We keep, for each concept, the strongest link and its path.
3. **How much does each clue count?** By error type: conceptual 1, procedural 0.7, unclassified 0.5, incomplete 0.4, unattempted 0.3. **Careless, calculation and notation slips count 0**: they are habits, not knowledge gaps, so they never start a root hunt and go to the habits section instead. Older exams count a bit less (half-life 120 days, never below 0.6), measured from the student's own latest exam, not the clock.
4. **Evidence the student knows something.** A careless or calculation slip means the method was right, which is weak evidence (0.3) that the concept and, fading by step, its prerequisites are understood. Explicit `mastery` evidence works the same way at its stated strength. Combined, this cancels part of the blame on a concept.
5. **Choose the smallest set of roots that explains the most.** Each error is assigned to whichever chosen root explains it best. A root earns the evidence of its errors (repeat errors in the same exam count 0.75, because the same mistake in different exams is stronger than twice in one paper) and pays a cost:
   - a fixed cost of 1 (Occam's razor: a root must be worth naming),
   - plus up to 0.6 more if few of the topics built *directly* on it show mistakes. A real gap shows up across what is built on it ("resonance: mistakes in 6 of the 6 topics built on it"); an over-general ancestor has mistakes in one corner only.

   A root must explain at least 2 errors, and must still have real evidence (0.4) after setting aside its single strongest error, so one strong error plus faint distant links cannot form a root. We maximise "evidence − cost" with a greedy search plus local moves: add, remove, swap, and **split** (replace one broad root by two narrower ones). Upper bounds prune moves that cannot win, so results are identical but much faster.
6. **Report.** Confidence is a noisy-OR over the explained errors (each strong error alone gives at most 0.6), scaled down by counter-evidence. Marks lost use the record's marks; when a record has none we estimate (question max × the student's typical lost share, else the student's typical marks lost, else 2) and flag it. Board marks resting on a root are each unit's board marks × the share of that unit's concepts that are the root or build on it. **Marks recoverable** = confidence × (marks lost + 0.1 × board marks resting on it). Study time is 1.5 h plus 0.5 h per distinct topic to practise it in (max 6 h). Roots are ranked by marks recoverable per hour.

Why this design: every number a student or teacher sees can be traced to a plain sentence ("8 errors across 3 exams; 6 of the 7 topics built on the chain rule show mistakes; the report names the same misconception 6 times"). We did not use an opaque probabilistic model, because the student must be shown why.

Nothing in the engine knows a subject, a concept id, a graph size or a fixture. Every tunable number is in `params.ts` with its reason, and can be overridden per call.

### Parameters and how they were set

All defaults were reasoned out first. The five that interact (step decay, root cost, branch cost, slip strength, shared-evidence floor) were then checked **on the random-graph scale scenarios only**; the demo fixtures were used purely as a check afterwards. Sensitivity (60 random 600-concept graphs, 3 planted roots each, changing one parameter at a time from the defaults):

| Variant | Planted roots recovered | False roots per student |
|---|---|---|
| **defaults** | **0.95** | **0.08** |
| hopDecay 0.6 | 0.86 | 0.05 |
| hopDecay 0.7 | 0.89 | 0.28 |
| rootCost 0.9 | 0.97 | 0.10 |
| rootCost 1.2 | 0.73 | 0.03 |
| branchCost 0 (off) | 0.92 | 0.25 |
| branchCost 0.4 | 0.94 | 0.12 |
| branchCost 0.8 | 0.92 | 0.08 |
| slipMasteryStrength 0.5 | 0.87 | 0.08 |
| sameExamRepeatFactor 1 (off) | 0.97 | 0.12 |
| minSharedEvidence 0 (off) | 0.94 | 0.12 |

The defaults sit on a plateau (neighbouring values behave similarly), and all four demo students give the same roots for every hopDecay 0.6–0.7 × rootCost 0.9–1.0 combination. Below rootCost 0.9, Kabir's trig root starts to split in two, so 1.0 keeps a margin.

## Verification gate

### Unit tests with hand-built graphs (`packages/core/test/root-cause.test.ts`, 20 tests, all pass)

| Case | Result |
|---|---|
| One root explaining everything (errors 1–2 steps below it, path checked) | root found, explains 4/4, path `r1 → a1 → d1` |
| Two independent roots under a shared ancestor | both found, ancestor not blamed (needed the split move, see below) |
| Only careless/calculation/notation errors | no root, 3 habit patterns, "No single knowledge gap" headline |
| Same named slip twice (different error types) | one "repeated slip" habit |
| Basic concept with 3 erring children: sanity, no counter-evidence | blamed (correct) |
| …with explicit mastery of it | not blamed; errors stand alone |
| Basic concept above a real root, errors spread over its branches | blamed without counter-evidence; with careless slips in its other branches, or explicit mastery, blame moves down to the real root |
| Partial counter-evidence | root kept, confidence lower, counter-evidence listed, explanation hedged |
| Same root across exams vs one exam | higher confidence across exams; a pair of errors is a root across two exams but not within one |
| Older exams | lower confidence |
| Missing marks (none / max only / mixed) | flagged estimates, no NaN, estimate follows the student's own typical loss |
| Unmapped records, unknown concept ids | standalone with reason, warning emitted |
| Determinism | identical JSON with records reversed |
| Empty input; mixed students | handled; mixed students rejected |
| LLM wording | prompt carries no student id; wording applied; failure falls back to template |

### Scale test (`packages/core/test/root-cause-scale.test.ts`)

Random valid graphs, 3 subjects × 200 concepts (Classes 9–12, 8 units each with board marks, 1–3 prerequisites per concept biased to make deep chains, ~5% cross-subject edges; ~1,180 edges, depth up to ~30). Per graph, a student with 3 unrelated planted roots (4 errors each, one per branch, 1–2 steps below the root, 70% conceptual / 30% procedural, mapping confidence 0.6–0.95, 35% with a secondary mapping naming the root), 6 unrelated conceptual noise errors and 6 slips, over 3 exams, 25% without marks.

| Metric (40 graphs × 600 concepts) | Result |
|---|---|
| Planted roots recovered exactly | **104 / 110 (0.945)** (gate in test: ≥ 0.85) |
| False roots | **2 in 40 students** (gate: ≤ 0.4 per student) |
| Planted errors attributed to their planted root | 416 / 440 |
| Engine time per student | **median 1.1 ms, max 5.6 ms** (gate: median < 100 ms, max < 500 ms) |
| Heavy student: 150 errors (2 planted roots + 108 noise errors + 30 slips), 600 concepts | **179 ms** (gate < 2 s); 1 of 2 planted roots recovered, 15 roots total (see limitations) |

On the demo data with the provisional graph (119 concepts) the engine takes 0.4–4.6 ms per student.

### Demo students vs. the Phase 1 answer key (`packages/core/test/root-cause-fixtures.test.ts`)

The test reads `data/fixtures/_answer-key/expected-roots.json`; the engine never does.

| Student | Expected | Engine | Explained records | Standalone records left alone |
|---|---|---|---|---|
| Riya | chain rule | chain rule (97%, high) | 8/8 exact | 3/3 |
| Kabir | resonance effect; multiple-angle formulae (or compound angles) | both (85%, 86%) | 5/5 and 5/5 exact | 2/2 |
| Ananya | no root; habits incl. repeated +C | no root; 4 habit patterns, repeated +C slip found | n/a | 10/10 |
| Vihaan | algebraic identities (or factorisation) | algebraic identities (87%, high) | 5/5 exact | 4/4 |

**Final result: 4/4 students match exactly, no extra roots.**

### Every miss along the way, and its cause

| Miss | Where the fault was | Fix |
|---|---|---|
| Vihaan got a spurious 2nd root, **Hybridisation**, from one error mapped straight to it plus one error 3 steps away (Saytzeff), both in one exam | Algorithm: one strong error plus a faint link should not make a "shared" root | `minSharedEvidence`: a root must keep 0.4 of evidence after setting aside its strongest error |
| Unit test: two independent roots merged into their common parent | Algorithm: greedy search reached a local optimum; once the parent was chosen, no single add/remove/swap improved | **Split** move: replace one root by two narrower candidates that share its errors |
| Scale test recall was 0.38–0.48 at first | Partly the generator (planted roots sharing descendants, errors bunched under one child, which made a child the correct answer); mostly the algorithm: an absolute "topics built on it without errors" penalty acted like a flat extra cost and sank genuine mid-level roots; slips counted too much as mastery | Generator fixed to plant unambiguous cases. Penalty replaced by **branch coverage** (share of directly dependent topics with errors), slip strength 0.5 → 0.3, step decay 0.7 → 0.65 |
| Kabir's and Riya's explanations said topics "are built on" the root when the graph has no such link | Provisional graph: `math.limits_trig` and the inverse-trig simplification don't list multiple-angle formulae as a prerequisite; the basic exp/log derivative doesn't list the chain rule (true for d/dx log x, but every composite log question needs it). The engine still linked them, through the report's own misconception or secondary mapping | Template only says "built on" where the graph path exists; otherwise "the report itself points to X". Graph gap noted for Phase P |

No fixture had to change.

## Demo results with a teacher's judgement

Full CLI output (`pnpm analyse --all`, template wording). SAMPLE DATA: hand-written demo fixtures, not real students or real Inferentics reports. `*` marks an estimated mark.

```text
Riya (sample)  [SAMPLE DATA: hand-written demo fixture, not a real student or a real Inferentics report.]
=========================================================================================================
Student demo-riya | 3 exam(s): Unit Test 1 (Mathematics, 2026-07-18); Half-Yearly Examination (Mathematics, 2026-09-22); Pre-Board 1 (Mathematics, 2026-11-10)

>> Fix this 1 thing → explains 8 of your 11 errors → about 12 marks at stake.

11 errors: 8 explained by roots, 3 stand alone, 0 slips/habits. Marks lost: 15 total, 12 on root-explained errors (* = estimated, record gave no marks).

ROOT GAPS (1), ranked by marks recoverable per study hour

#1 Chain rule [math.chain_rule], Class 12, Mathematics
   confidence 97% (high) | explains 8 errors across 3 exam(s)
   marks: 12 lost (1 estimated), 30.8 board marks build on it, 14.6 recoverable
   coverage: mistakes in 6 of the 7 examined topics built directly on it, and in the topic itself
   study: ~5 h (12 missions) | priority 2.92 marks/hour
   why: 8 of your mistakes, in Chain rule itself and in Derivatives of exponential and logarithmic functions, Implicit differentiation, Integration by substitution and Rate of change of quantities and more, trace back to Chain rule. Implicit differentiation, Integration by substitution, Rate of change of quantities and Derivatives of inverse trigonometric functions and more are built on Chain rule, so one gap there shows up there too. In your Derivatives of exponential and logarithmic functions question, the report itself points to Chain rule as the step that went wrong. The same wrong idea keeps coming back: Forgets to multiply by the derivative of the inner function (6 times). It happened in 3 different exams, so it is not a one-off. Fixing it is worth about 12 marks you already lost.
   evidence:
     - Unit Test 1 Q11 (conceptual, 2 lost): Chain rule (in a question on Derivatives of exponential and logarithmic functions)  [misconception named in report, link 0.8]
     - Unit Test 1 Q7 (conceptual, 1 lost): Chain rule  [primary mapping, link 0.95]
     - Half-Yearly Examination Q18 (conceptual, 2 lost): Chain rule → Implicit differentiation  [primary mapping, 1 step(s) back, link 0.59]
     - Half-Yearly Examination Q22 (procedural, 1 lost): Chain rule → Integration by substitution  [primary mapping, 1 step(s) back, link 0.59]
     - Half-Yearly Examination Q30 (conceptual, 1* lost): Chain rule → Rate of change of quantities  [misconception named in report, link 0.6]
     - Pre-Board 1 Q15 (conceptual, 1 lost): Chain rule → Derivatives of inverse trigonometric functions  [misconception named in report, link 0.85]
     - Pre-Board 1 Q24 (conceptual, 2 lost): Chain rule → Second order derivatives  [misconception named in report, link 0.7]
     - Pre-Board 1 Q9 (conceptual, 2 lost): Chain rule → Derivatives of parametric functions  [misconception named in report, link 0.85]
   repeated misconception x6: Forgets to multiply by the derivative of the inner function
   repeated misconception x1: Differentiates y^2 as 2y without the factor dy/dx
   repeated misconception x1: Substitutes u but leaves dx unconverted (does not replace dx by du/g'(x))

STANDALONE ERRORS (3): fix one at a time
  - Half-Yearly Examination Q5 (conceptual, 1 lost) Inverse trigonometric functions [math.inverse_trig_functions]: A one-off mistake in Inverse trigonometric functions: nothing else you got wrong points the same way, so fix it on its own.
  - Pre-Board 1 Q3 (conceptual, 1 lost) Inverse of a matrix and linear systems [math.matrix_inverse]: A one-off mistake in Inverse of a matrix and linear systems: nothing else you got wrong points the same way, so fix it on its own.
  - Unit Test 1 Q4 (procedural, 1 lost) Continuity [math.continuity]: A one-off mistake in Continuity: nothing else you got wrong points the same way, so fix it on its own.

HABITS AND SLIPS (0 pattern(s))
(engine 3.7 ms)

Kabir (sample)  [SAMPLE DATA: hand-written demo fixture, not a real student or a real Inferentics report.]
==========================================================================================================
Student demo-kabir | 4 exam(s): Half-Yearly Examination (Mathematics, 2026-09-24); Half-Yearly Examination (Chemistry, 2026-09-26); Pre-Board 1 (Mathematics, 2026-11-11); Pre-Board 1 (Chemistry, 2026-11-13)

>> Fix these 2 things → explains 10 of your 12 errors → about 19 marks at stake.

12 errors: 10 explained by roots, 1 stand alone, 1 slips/habits. Marks lost: 21 total, 19 on root-explained errors (* = estimated, record gave no marks).

ROOT GAPS (2), ranked by marks recoverable per study hour

#1 Multiple and sub-multiple angle formulae [math.trig_multiple_angles], Class 11, Mathematics
   confidence 85% (high) | explains 5 errors across 2 exam(s)
   marks: 10 lost, 3.7 board marks build on it, 8.8 recoverable
   coverage: mistakes in 1 of the 1 examined topics built directly on it, and in the topic itself
   study: ~3 h (8 missions) | priority 2.93 marks/hour
   why: 5 of your mistakes in Integration using trigonometric identities, Continuity and Derivatives of inverse trigonometric functions trace back to Multiple and sub-multiple angle formulae. Integration using trigonometric identities is built on Multiple and sub-multiple angle formulae, so one gap there shows up there too. In your Continuity and Derivatives of inverse trigonometric functions questions, the report itself points to Multiple and sub-multiple angle formulae as the step that went wrong. The same wrong idea keeps coming back: Mixes up the forms of cos 2x: writes 1 - cos 2x = 2 cos^2 x instead of 2 sin^2 x (2 times). It happened in 2 different exams, so it is not a one-off. Fixing it is worth 10 marks you already lost.
   evidence:
     - Half-Yearly Examination Q12 (conceptual, 2 lost): Multiple and sub-multiple angle formulae → Integration using trigonometric identities  [primary mapping, 1 step(s) back, link 0.59]
     - Half-Yearly Examination Q16 (conceptual, 2 lost): Multiple and sub-multiple angle formulae (in a question on Continuity)  [misconception named in report, link 0.85]
     - Half-Yearly Examination Q8 (conceptual, 1 lost): Multiple and sub-multiple angle formulae → Integration using trigonometric identities  [misconception named in report, link 0.8]
     - Pre-Board 1 Q19 (procedural, 2 lost): Multiple and sub-multiple angle formulae (in a question on Derivatives of inverse trigonometric functions)  [secondary mapping, link 0.64]
     - Pre-Board 1 Q25 (conceptual, 3 lost): Multiple and sub-multiple angle formulae → Integration using trigonometric identities  [primary mapping, 1 step(s) back, link 0.55]
   repeated misconception x2: Mixes up the forms of cos 2x: writes 1 - cos 2x = 2 cos^2 x instead of 2 sin^2 x
   repeated misconception x1: Integrates sin^2 x as sin^3 x / 3, applying the power rule to a trigonometric function
   repeated misconception x1: Treats sin A cos B as a single sine or cosine of a combined angle

#2 Resonance (mesomeric) effect [chem.resonance_effect], Class 11, Chemistry
   confidence 86% (high) | explains 5 errors across 2 exam(s)
   marks: 9 lost (2 estimated), 26.5 board marks build on it, 10 recoverable
   coverage: mistakes in 6 of the 6 examined topics built directly on it, and in the topic itself
   study: ~4 h (10 missions) | priority 2.5 marks/hour
   why: 5 of your mistakes in Acidity of phenols, Directive influence of substituents, Reactivity of haloarenes and SN1 mechanism and more trace back to Resonance (mesomeric) effect. Those topics are all built on Resonance (mesomeric) effect, so one gap there shows up in all of them. It happened in 2 different exams, so it is not a one-off. Fixing it is worth about 9 marks you already lost.
   evidence:
     - Half-Yearly Examination Q14 (conceptual, 1 lost): Resonance (mesomeric) effect → Acidity of phenols  [secondary mapping, link 0.6]
     - Half-Yearly Examination Q19 (conceptual, 2 lost): Resonance (mesomeric) effect → Directive influence of substituents  [misconception named in report, link 0.9]
     - Pre-Board 1 Q11 (conceptual, 2 lost): Resonance (mesomeric) effect → Reactivity of haloarenes  [primary mapping, 1 step(s) back, link 0.55]
     - Pre-Board 1 Q21 (conceptual, 2* lost): Resonance (mesomeric) effect → Stability of carbocations and radicals → SN1 mechanism  [misconception named in report, link 0.55]
     - Pre-Board 1 Q8 (conceptual, 2 lost): Resonance (mesomeric) effect → Basicity of amines  [secondary mapping, link 0.6]
   repeated misconception x1: Thinks aniline is more basic than aliphatic amines, ignoring delocalisation of the nitrogen lone pair into the ring
   repeated misconception x1: Ranks carbocations by degree (3/2/1) only, ignoring resonance stabilisation of allylic or benzylic cations
   repeated misconception x1: Thinks an electron-withdrawing group such as -NO2 decreases the acidity of phenol
   repeated misconception x1: Judges a group's net effect on a ring or charge by its inductive effect alone, ignoring its resonance effect (e.g. calls -OCH3 deactivating)

STANDALONE ERRORS (1): fix one at a time
  - Pre-Board 1 Q6 (conceptual, 1 lost) Scalar (dot) product [math.dot_product]: A one-off mistake in Scalar (dot) product: nothing else you got wrong points the same way, so fix it on its own.

HABITS AND SLIPS (1 pattern(s))
  * Notation, units and conventions: 1x, 1 mark lost. Tip: Before moving on, check: +C, units, signs, naming rules, arrow directions.
      Half-Yearly Examination Q3 (notation, 1 lost) chem.iupac_nomenclature
(engine 1.6 ms)

Ananya (sample)  [SAMPLE DATA: hand-written demo fixture, not a real student or a real Inferentics report.]
===========================================================================================================
Student demo-ananya | 4 exam(s): Half-Yearly Examination (Mathematics, 2026-09-22); Half-Yearly Examination (Chemistry, 2026-09-25); Pre-Board 1 (Mathematics, 2026-11-10); Pre-Board 1 (Chemistry, 2026-11-12)

>> No single knowledge gap behind your mistakes: 10 of your 10 errors were slips and habits → about 9 marks to win back by checking your work.

10 errors: 0 explained by roots, 0 stand alone, 10 slips/habits. Marks lost: 9 total, 0 on root-explained errors.

ROOT GAPS (0), ranked by marks recoverable per study hour
  none: no shared knowledge gap explains these errors

STANDALONE ERRORS (0): fix one at a time

HABITS AND SLIPS (4 pattern(s))
  * Misreading and copying slips: 4x, 4 marks lost. Tip: Underline what the question asks, and check your final line answers exactly that.
      Half-Yearly Examination Q26 (careless, 1 lost) math.increasing_decreasing
      Pre-Board 1 Q13 (careless, 1 lost) math.logarithmic_differentiation
      Pre-Board 1 Q22 (careless, 1 lost) chem.reaction_types
      Pre-Board 1 Q9 (careless, 1 lost) chem.stoichiometry
  * Notation, units and conventions: 3x, 3 marks lost. Tip: Before moving on, check: +C, units, signs, naming rules, arrow directions.
      Half-Yearly Examination Q16 (notation, 1 lost) chem.sn2_mechanism
      Half-Yearly Examination Q5 (notation, 1 lost) chem.iupac_nomenclature
      Pre-Board 1 Q20 (notation, 0.5 lost) math.area_under_curves
  * The same slip more than once: Omits the constant of integration C: 2x, 2 marks lost. Tip: Add this to your final-answer checklist; it has cost you marks more than once.
      Half-Yearly Examination Q2 (notation, 0.5 lost) math.antiderivative_basics
      Pre-Board 1 Q28 (incomplete, 1 lost) math.linear_de
  * Arithmetic and algebra slips: 1x, 1 mark lost. Tip: Re-check each line of arithmetic, and substitute your answer back where you can.
      Half-Yearly Examination Q17 (calculation, 1 lost) math.determinants
(engine 0.4 ms)

Vihaan (sample)  [SAMPLE DATA: hand-written demo fixture, not a real student or a real Inferentics report.]
===========================================================================================================
Student demo-vihaan | 4 exam(s): Unit Test 1 (Mathematics, 2026-07-20); Half-Yearly Examination (Mathematics, 2026-09-23); Pre-Board 1 (Mathematics, 2026-11-10); Pre-Board 1 (Chemistry, 2026-11-13)

>> Fix this 1 thing → explains 5 of your 9 errors → about 11 marks at stake.

9 errors: 5 explained by roots, 4 stand alone, 0 slips/habits. Marks lost: 18 total, 11 on root-explained errors (* = estimated, record gave no marks).

ROOT GAPS (1), ranked by marks recoverable per study hour

#1 Algebraic identities [math.algebraic_identities], Class 9, Mathematics
   confidence 87% (high) | explains 5 errors across 3 exam(s)
   marks: 11 lost, 66.1 board marks build on it, 15.3 recoverable
   coverage: mistakes in 2 of the 3 examined topics built directly on it, and in the topic itself
   study: ~4 h (10 missions) | priority 3.83 marks/hour
   why: 5 of your mistakes in Continuity, Standard derivatives and basic rules, Increasing and decreasing functions and Integration by partial fractions and more trace back to Algebraic identities. Those topics are all built on Algebraic identities, so one gap there shows up in all of them. The same wrong idea keeps coming back: Expands (a + b)^2 as a^2 + b^2, dropping the 2ab term (2 times). It happened in 3 different exams, so it is not a one-off. It is a Class 9 topic, so going back to basics here will unlock the harder chapters. Fixing it is worth 11 marks you already lost.
   evidence:
     - Unit Test 1 Q6 (conceptual, 2 lost): Algebraic identities → Factorisation of polynomials → Algebraic fractions → Algebraic limits → Continuity  [misconception named in report, link 0.9]
     - Unit Test 1 Q9 (conceptual, 2 lost): Algebraic identities → Factorisation of polynomials → Algebraic fractions → Algebraic limits → Derivative from first principles → Standard derivatives and basic rules  [misconception named in report, link 0.9]
     - Half-Yearly Examination Q21 (procedural, 2 lost): Algebraic identities → Factorisation of polynomials → Increasing and decreasing functions  [secondary mapping, 1 step(s) back, link 0.47]
     - Half-Yearly Examination Q27 (incomplete, 3 lost): Algebraic identities → Factorisation of polynomials → Algebraic fractions → Integration by partial fractions  [secondary mapping, 1 step(s) back, link 0.47]
     - Pre-Board 1 Q14 (conceptual, 2 lost): Algebraic identities → Factorisation of polynomials → Algebraic fractions → Algebraic limits → Continuity → Differentiability  [misconception named in report, link 0.9]
   repeated misconception x2: Expands (a + b)^2 as a^2 + b^2, dropping the 2ab term
   repeated misconception x1: Factorises a^3 - b^3 as (a - b)(a^2 - ab + b^2), using the sum-of-cubes sign pattern

STANDALONE ERRORS (4): fix one at a time
  - Pre-Board 1 Q34 (conceptual, 3 lost) [unmapped]: This question's topic isn't in our concept map yet, so treat it as its own fix.
  - Pre-Board 1 Q17 (conceptual, 2* lost) Elimination reactions (Saytzeff rule) [chem.elimination_reactions]: A one-off mistake in Elimination reactions (Saytzeff rule): nothing else you got wrong points the same way, so fix it on its own.
  - Pre-Board 1 Q4 (conceptual, 1 lost) Reactive intermediates [chem.reactive_intermediates]: A one-off mistake in Reactive intermediates: nothing else you got wrong points the same way, so fix it on its own.
  - Pre-Board 1 Q8 (procedural, 1 lost) Determinants [math.determinants]: A one-off mistake in Determinants: nothing else you got wrong points the same way, so fix it on its own.

HABITS AND SLIPS (0 pattern(s))
(engine 0.5 ms)
```

LLM-worded example (Kabir, task `explain`, Gemini Flash, second run served from cache):

> Five of your mistakes across Integration using trigonometric identities, Continuity, and Derivatives of inverse trigonometric functions stem from your Class 11 topic, Multiple and sub-multiple angle formulae. You repeatedly mixed up forms of cos 2x, like writing 1 - cos 2x = 2 cos^2 x instead of 2 sin^2 x twice, and this error appeared in 2 different exams. Sorting out this single core area can help you recover the 10 marks you lost.

### As a maths/science teacher would see it

**Riya.** Right call. Eight of eleven errors are the same missing inner derivative: sin(x²), log(cos x), sin⁻¹(2x), implicit, parametric, e^(2x), the rate-of-change question and the dt/2 in substitution. The report names the misconception six times across three exams. I would teach exactly this. Two remarks:
- The substitution error (x dx not replaced by dt/2) is as much a substitution-procedure slip as a chain-rule gap. Attributing it to the chain rule is defensible because substitution is the chain rule run backwards.
- 30.8 board marks build on the chain rule, which matches Class 12 calculus.

The three standalones (piecewise continuity, principal value of tan⁻¹, |adj A|) are genuinely unrelated one-offs. Five hours / 12 missions is realistic for re-learning the rule and practising it in seven contexts.

**Kabir.** Both roots are right and well separated: one in maths, one in chemistry, no cross-talk.
- **Resonance**: mistakes in all 6 topics built directly on it (phenol acidity, -OCH₃ directing, aniline basicity, chlorobenzene, benzylic SN1). That is the textbook signature of not understanding +R/−R.
- **Multiple-angle formulae**: correct. The provisional graph only links it to trig integration, so the limit question and the inverse-trig simplification were caught through the report's own mapping. The full graph should add those prerequisite edges.
- **Ranking**: I would personally put resonance first for a board exam, because much of organic chemistry (26.5 board marks here) rests on it, against 3.7 for multiple angles. The engine ranks trig first because it lost slightly more marks for fewer hours. This is a product decision about how much future board weight should count against marks already lost (`boardMarksFactor`, now 0.1), not a bug. Worth discussing before Phase 5.
- The IUPAC numbering slip going to habits and the dot-product error standing alone are both right.

**Ananya.** Right: no knowledge gap. The engine doesn't invent a root just because there are ten errors, and it surfaces the one thing a teacher would underline: the missing +C twice, once in a plain integral and once in the linear differential equation. One caveat: the "notation" group holds the IUPAC numbering error ("numbered from the wrong end, prefixes not alphabetical"). A chemistry teacher might call that a naming-rule gap rather than presentation. We follow the report's label because we don't re-diagnose.

**Vihaan.** Right, and the most valuable case. Class 12 marks are lost to Class 9 algebra: (a+b)² without 2ab twice, the a³−b³ sign pattern, and quadratics that won't factorise. The engine goes back to algebraic identities and says plainly that it's a Class 9 topic. Notes:
- The graph paths shown are true but long (identities → factorisation → algebraic fractions → algebraic limits → continuity). The real evidence is that the report names the identity in those questions. The UI should lead with "the report says you expanded (3+h)² as 9+h²", not the five-step chain.
- The two chemistry errors (sp³ carbocation, Saytzeff) are left standalone. A chemistry teacher might sense one underlying idea (carbocation and alkene stability), but two errors in one paper with no shared named concept is too thin. This was the spurious root the shared-evidence rule removed.
- The unmapped Bayes question correctly stands alone and, at 3 marks, tops the standalone list.

## Limitations and open items

- **Calibrated without real data.** Parameters come from reasoning plus random-graph scenarios. In Phase P, re-check them on real reports, ideally against teacher-labelled roots for a sample of students. `params` can be overridden per call for that.
- **Positive evidence is thin.** Reports list errors, not correct answers, so "this concept is fine" comes only from slips and the optional `mastery` input. If real reports mention strengths, the parser should emit them as `MasteryEvidence`, and Phase 5 missions should feed passed checks back in.
- **Noisy students produce many weak roots.** A student with 108 unrelated errors got 15 roots, mostly low/medium confidence. The UI should show the top few by priority and hide low-confidence ones behind "more".
- **Coincidences.** Two unrelated errors in neighbouring topics can form a medium-confidence root (the 2 false roots in the scale test were of this kind). That is correct given the evidence, but it is a guess, and the confidence label says so.
- **Search is heuristic.** Greedy plus local moves (add, remove, swap, split) is not guaranteed optimal. It is deterministic, and on all tests it found the planted structure.
- **Ranking weights** (lost marks vs. board marks resting on a root) are a product decision; see Kabir.
- **Study-time estimates are rough** (1.5 h + 0.5 h per topic, max 6 h). Phase 5 should refine them from mission data.
- **Provisional-graph gaps** found: multiple-angle formulae should be a prerequisite of trig limits and inverse-trig simplification; the chain rule matters for composite exp/log derivatives. The engine coped via report mappings. Pass these to whoever builds the full graph.
- Coverage scope ("examined topics") is approximated from the subjects in the records and the highest class mapped. It does not use the exam syllabus, which reports may not give.

## Files

- `packages/core/src/root-cause/`: `params.ts` (every tunable, with reasons), `types.ts` (output and `MasteryEvidence`), `evidence.ts` (records → observations, links, marks estimates, mastery), `select.ts` (objective and search), `engine.ts` (`analyseStudent`, coverage, board marks), `explain.ts` (templates, headline, habit text), `wording.ts` (LLM re-wording), `format.ts` (text output).
- `apps/cli/`: `pnpm analyse`.
- Tests: `packages/core/test/root-cause.test.ts`, `root-cause-scale.test.ts`, `root-cause-fixtures.test.ts`, helpers in `packages/core/test/helpers/`.
