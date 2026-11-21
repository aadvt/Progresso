import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { withReport } from "./constellation-helpers";
import { expectAccessible, shot } from "./helpers";

/**
 * Phase 5: a student builds a comeback plan and completes full missions in the
 * UI (recap → explainer → prove it → result), on SAMPLE DATA.
 *
 * The flow adapts to the question bank on disk, which grows over time: if one
 * miss would already fail the gate (few verified questions), Riya fails her
 * first check, the plan re-flows, and she passes the retry the next day.
 */
const PHASE = "phase-5";
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
test.describe.configure({ mode: "serial", timeout: 180_000 });

type Option = { id: string; correct: boolean; misconception_id?: string };
type Q = { id: string; kind: "mcq" | "numeric"; concept_id: string; options?: Option[]; answer?: { value: number }; numeric_wrong?: { value: number }[] };

/** The answer key, read from the verified bank on disk (the browser never has it). */
function loadKey(): Map<string, Q> {
  const out = new Map<string, Q>();
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith(".json") && !f.startsWith("_")) for (const q of (JSON.parse(readFileSync(p, "utf8")) as { questions: Q[] }).questions) out.set(q.id, q);
    }
  };
  walk(join(REPO, "data", "question-bank"));
  return out;
}
const KEY = loadKey();

/** A demo student's own report misconceptions: picking one of these fails the gate whatever the score. */
function ownMisconceptions(file: string): Set<string> {
  const fixture = JSON.parse(readFileSync(join(REPO, "data", "fixtures", "demo", file), "utf8")) as { records: { misconception?: { misconception_id: string } }[] };
  return new Set(fixture.records.flatMap((r) => (r.misconception ? [r.misconception.misconception_id] : [])));
}

async function answer(page: Page, right: boolean, own: Set<string>): Promise<void> {
  const section = page.locator("[data-question-id]");
  const id = (await section.getAttribute("data-question-id"))!;
  const q = KEY.get(id)!;
  if (q.kind === "mcq") {
    const opt = right ? q.options!.find((o) => o.correct)! : (q.options!.find((o) => !o.correct && !own.has(o.misconception_id!)) ?? q.options!.find((o) => !o.correct)!);
    await section.locator("label").nth(q.options!.findIndex((o) => o.id === opt.id)).click();
  } else {
    await section.getByLabel(/Your answer/).fill(String(right ? q.answer!.value : (q.numeric_wrong?.[0]?.value ?? q.answer!.value + 5)));
  }
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.getByRole("status").filter({ hasText: right ? /Spot on|Exactly right|Nailed it|That's it/ : /Not quite/ })).toBeVisible();
}

/** Number of questions in the current check. */
async function questionCount(page: Page): Promise<number> {
  const text = (await page.getByText(/Question 1 of \d+/).textContent()) ?? "";
  return Number(/of (\d+)/.exec(text)![1]);
}

/** Answer the remaining questions right, then score the check. */
async function answerRestRight(page: Page, own: Set<string>): Promise<void> {
  for (;;) {
    const next = page.getByRole("button", { name: "Next question" });
    if (!(await next.isVisible())) break;
    await next.click();
    await answer(page, true, own);
  }
  await page.getByRole("button", { name: "See my result" }).click();
}

async function freshPlan(page: Page, student: string): Promise<void> {
  await page.goto(`/s/${student}/today`);
  const reset = page.getByRole("button", { name: "Reset plan" });
  if (await reset.isVisible()) await reset.click();
  await expect(page.getByRole("heading", { name: "Two questions, then your plan" })).toBeVisible();
}

/** From Today: start the mission and walk through the recap and the explainer. */
async function throughRecapAndExplainer(page: Page, concept: string, info: Parameters<typeof shot>[1] | null): Promise<void> {
  await page.getByRole("button", { name: /^(Start|Continue) mission$/ }).click();
  await expect(page).toHaveURL(/\/mission\//);
  // 1. Mistake Recap: the report's own words.
  await expect(page.getByRole("heading", { level: 1, name: /mistake/ })).toBeVisible();
  await expect(page.getByText("The report says").first()).toBeVisible();
  if (info) {
    await shot(page, info, "04-recap", { phase: PHASE });
    await expectAccessible(page, "mission recap");
  }
  await page.getByRole("button", { name: "Continue" }).click();
  // 2. Explainer (placeholder content, real structure): what to watch out for.
  await expect(page.getByRole("heading", { level: 1, name: concept })).toBeVisible();
  await expect(page.getByText("In your report").first()).toBeVisible();
  if (info) await shot(page, info, "05-explainer", { phase: PHASE });
  await page.getByRole("button", { name: "I'm ready: prove it" }).click();
}

test("build a plan, then complete full missions: recap, explainer, prove it, result, re-flow, ripple", async ({ page, context }, info) => {
  const STUDENT = "demo-riya";
  const ROOT = "Chain rule";
  const own = ownMisconceptions("01-riya.json");
  await withReport(context, info, [STUDENT]);
  await freshPlan(page, STUDENT);
  await shot(page, info, "01-plan-setup", { phase: PHASE });
  await expectAccessible(page, "plan setup");

  await page.getByRole("radio", { name: /50 min a day/ }).check();
  await page.getByRole("radio", { name: /25 min a day/ }).check();
  await page.getByRole("button", { name: "Build my plan" }).click();

  // Today: the first mission is on the top root, with its fixed structure.
  await expect(page.getByRole("heading", { name: "Today's mission", level: 1 })).toBeVisible();
  const mission = page.getByRole("article").first();
  await expect(mission.getByRole("heading", { name: `Fix the root: ${ROOT}` })).toBeVisible();
  await expect(mission.getByRole("list", { name: "Mission steps" }).getByRole("listitem")).toHaveText([/Mistake Recap/, /Explainer/, /Prove it/]);
  await expect(page.getByRole("heading", { name: /Readiness for Pre-Board 2/ })).toBeVisible();
  await expect(page.getByText("Estimate", { exact: true })).toBeVisible();
  await shot(page, info, "02-today", { phase: PHASE });
  await shot(page, info, "02b-today-full", { phase: PHASE, fullPage: true });
  await expectAccessible(page, "today");

  // The plan timeline to exam day.
  await page.getByRole("link", { name: "Plan", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /days to Pre-Board 2/ })).toBeVisible();
  await expect(page.getByText("Buffer").first()).toBeVisible();
  await shot(page, info, "03-plan", { phase: PHASE });
  await shot(page, info, "03b-plan-full", { phase: PHASE, fullPage: true });
  await expectAccessible(page, "plan");

  await page.getByRole("link", { name: "Today", exact: true }).click();
  await throughRecapAndExplainer(page, ROOT, info);

  // 3. Prove it: the first answer is a wrong one (a slip that isn't the report's own when the question allows it).
  await expect(page.getByText(/Question 1 of/)).toBeVisible();
  const n = await questionCount(page);
  const oneMissPasses = (n - 1) / n >= 0.75;
  await shot(page, info, "06-question", { phase: PHASE });
  await answer(page, false, own);
  await expect(page.getByText(/The slip:/)).toBeVisible();
  await shot(page, info, "07-wrong-feedback", { phase: PHASE });
  await expectAccessible(page, "wrong-answer feedback");
  if (n > 1) {
    await page.getByRole("button", { name: "Next question" }).click();
    await answer(page, true, own);
    await page.waitForTimeout(500);
    await shot(page, info, "08-right-feedback", { phase: PHASE, animations: "allow" });
  }
  await answerRestRight(page, own);

  if (!oneMissPasses) {
    // Not proven: the result says so kindly, and the plan re-flows with a retry.
    await expect(page.getByRole("heading", { level: 1, name: "Not yet, and that's useful" })).toBeVisible();
    await shot(page, info, "09a-not-yet", { phase: PHASE });
    await expectAccessible(page, "mission result (not yet)");
    await page.getByRole("link", { name: "Back to today" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Done for today" })).toBeVisible();
    // Demo clock: tomorrow brings the root back.
    await page.getByRole("button", { name: "Skip to tomorrow" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Today's mission" })).toBeVisible();
    await expect(page.getByRole("article").first().getByRole("heading", { name: `Fix the root: ${ROOT}` })).toBeVisible();
    await throughRecapAndExplainer(page, ROOT, null);
    await answer(page, true, own);
    await answerRestRight(page, own);
  }

  // 4. Result: proven, and the root lights up the map.
  await expect(page.getByRole("heading", { level: 1, name: `Proven: ${ROOT}` })).toBeVisible();
  await expect(page.getByText(/Readiness for the exam/)).toBeVisible();
  await page.waitForTimeout(900);
  await shot(page, info, "09-result", { phase: PHASE, animations: "allow" });
  await expectAccessible(page, "mission result");

  // The chain reaction on the map, driven by the mastery the mission just wrote.
  await page.getByRole("link", { name: "See the chain reaction" }).click();
  await page.waitForFunction(() => (window.__constellation?.ripples ?? 0) >= 1, null, { timeout: 30_000 });
  await page.waitForTimeout(1600);
  await shot(page, info, "10-ripple-after-mission", { phase: PHASE, animations: "allow" });

  // Back on Today: done, readiness moved, the plan re-flowed (the root's remaining learn parts are gone).
  await page.goto(`/s/${STUDENT}/today`);
  await expect(page.getByRole("heading", { level: 1, name: "Done for today" })).toBeVisible();
  await expect(page.getByText(/points since you started/)).toBeVisible();
  await expect(page.getByText(new RegExp(`Next up: .*${ROOT} in `))).toBeVisible();
  await shot(page, info, "11-today-after", { phase: PHASE });

  // Demo clock: the next mission applies the fixed root to a topic where the mistakes showed up.
  await page.getByRole("button", { name: "Skip to tomorrow" }).click();
  await expect(page.getByRole("article").first().getByRole("heading", { name: new RegExp(`${ROOT} in `) })).toBeVisible();

  // Clean up for the next run.
  await page.getByRole("button", { name: "Reset plan" }).click();
  await expect(page.getByRole("heading", { name: "Two questions, then your plan" })).toBeVisible();
});

test("a topic without verified questions yet can still be studied, but isn't proven", async ({ page, context }, info) => {
  test.skip(!info.project.name.endsWith("desktop"), "desktop only");
  const ROOT = "Multiple and sub-multiple angle formulae";
  const conceptHasQuestions = [...KEY.values()].some((q) => q.concept_id === "math.trig_multiple_angles");
  test.skip(conceptHasQuestions, "the bank now has questions for this root");
  await withReport(context, info, ["demo-kabir"]);
  await freshPlan(page, "demo-kabir");
  await page.getByRole("button", { name: "Build my plan" }).click();
  await expect(page.getByRole("article").first().getByRole("heading", { name: `Fix the root: ${ROOT}` })).toBeVisible();
  await throughRecapAndExplainer(page, ROOT, null);
  await expect(page.getByRole("heading", { level: 1, name: "No verified questions for this topic yet" })).toBeVisible();
  await shot(page, info, "13-no-questions-yet", { phase: PHASE });
  await expectAccessible(page, "no questions yet");
  await page.getByRole("button", { name: "Mark as studied" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Studied: ${ROOT}` })).toBeVisible();
  await expect(page.getByText("Result · no check yet")).toBeVisible();
  await shot(page, info, "14-studied", { phase: PHASE });
  await page.goto("/s/demo-kabir/today");
  await expect(page.getByRole("heading", { level: 1, name: "Done for today" })).toBeVisible();
  await page.getByRole("button", { name: "Reset plan" }).click();
});

test("a habits-only student gets an honest plan: no knowledge gap to fix", async ({ page, context }, info) => {
  test.skip(!info.project.name.endsWith("desktop"), "desktop only");
  await withReport(context, info, ["demo-ananya"]);
  await page.goto("/s/demo-ananya/today");
  const reset = page.getByRole("button", { name: "Reset plan" });
  if (await reset.isVisible()) await reset.click();
  await page.getByRole("button", { name: "Build my plan" }).click();
  await expect(page.getByText(/no knowledge gap to fix/)).toBeVisible();
  await shot(page, info, "12-habits-only", { phase: PHASE });
  await page.getByRole("button", { name: "Reset plan" }).click();
});
