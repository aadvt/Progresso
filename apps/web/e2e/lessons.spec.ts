import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { withReport } from "./constellation-helpers";
import { expectAccessible, SCREENSHOTS_ROOT, shot } from "./helpers";

/**
 * Phase 6: Mistake Recap and step explainers, on SAMPLE DATA.
 * - In a mission: the recap animates (working → red mark → fix → key idea),
 *   is skippable and replayable; the explainer plays step by step.
 * - On the replays page: every generated recap and explainer, screenshotted
 *   one by one for the hand check in docs/phase-6-report.md.
 */
const PHASE = "phase-6";
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
test.describe.configure({ mode: "serial", timeout: 180_000 });

type RecapFile = { recap: { record_id: string; mode: "student_working" | "typical_step" } };
const RECAPS: RecapFile["recap"][] = readdirSync(join(REPO, "data", "fixtures", "demo-recaps"))
  .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
  .map((f) => (JSON.parse(readFileSync(join(REPO, "data", "fixtures", "demo-recaps", f), "utf8")) as RecapFile).recap);

async function boardShot(page: Page, info: TestInfo, selector: string, name: string): Promise<void> {
  const dir = join(SCREENSHOTS_ROOT, PHASE);
  mkdirSync(dir, { recursive: true });
  const el = page.locator(selector);
  await el.scrollIntoViewIfNeeded();
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  // Hide the fixed top bar, tab bar and skip link: element shots scroll under them.
  await el.screenshot({ path: join(dir, `${info.project.name}-${name}.png`), style: "header, nav[aria-label='Your sections'], .skip-link { visibility: hidden !important; }" });
}

test("a mission's recap animates, marks the step and corrects it; the explainer plays", async ({ page, context }, info) => {
  const STUDENT = "demo-riya";
  await withReport(context, info, [STUDENT]);
  await page.goto(`/s/${STUDENT}/today`);
  const reset = page.getByRole("button", { name: "Reset plan" });
  if (await reset.isVisible()) await reset.click();
  await page.getByRole("button", { name: "Build my plan" }).click();
  await expect(page.getByRole("heading", { name: "Today's mission", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /^(Start|Continue) mission$/ }).click();

  // 1. Recap: the student's own quoted working comes first, in handwriting.
  await expect(page.getByRole("heading", { level: 1, name: /replayed/ })).toBeVisible();
  const board = page.locator("[data-recap-mode]");
  await expect(board).toHaveAttribute("data-recap-mode", "student_working");
  await expect(board.getByText("Your working, as quoted in your report")).toBeVisible();
  await expect(board.getByText(/Pre-Board 1|Unit Test 1|Half-Yearly/).first()).toBeVisible();
  // It plays by itself and finishes well inside a minute.
  const t0 = Date.now();
  await expect(board.getByText("This step has the error.")).toBeAttached({ timeout: 10_000 });
  await shot(page, info, "01-recap-marked", { phase: PHASE });
  await expect(board).toHaveAttribute("data-done", "true", { timeout: 60_000 });
  expect(Date.now() - t0).toBeLessThan(60_000);
  await shot(page, info, "02-recap-done", { phase: PHASE });
  await expectAccessible(page, "mistake recap");

  // Replayable, and skippable.
  await board.getByRole("button", { name: "Replay" }).click();
  await expect(board).not.toHaveAttribute("data-done", "true");
  await board.getByRole("button", { name: "Skip animation" }).click();
  await expect(board).toHaveAttribute("data-done", "true");

  // A typical step (no quoted working) is labelled as not the student's own.
  const typical = RECAPS.find((r) => r.record_id.startsWith(STUDENT) && r.mode === "typical_step");
  if (typical) {
    const chip = page.getByRole("group", { name: "Choose a mistake to replay" }).getByRole("button");
    const n = await chip.count();
    for (let i = 0; i < n; i++) {
      await chip.nth(i).click();
      if ((await page.locator("[data-recap-mode]").getAttribute("data-recap-mode")) === "typical_step") break;
    }
    const t = page.locator("[data-recap-mode]");
    if ((await t.getAttribute("data-recap-mode")) === "typical_step") {
      await expect(t.getByText("Not your working")).toBeVisible();
      await expect(t.getByText("This is the kind of step that goes wrong here.")).toBeVisible();
      await expect(t.locator('[class*="hand"]')).toHaveCount(0);
      await t.getByRole("button", { name: "Skip animation" }).click();
      await shot(page, info, "03-recap-typical", { phase: PHASE });
    }
  }

  // 2. Explainer: plays from the wrong step; can be stepped through.
  await page.getByRole("button", { name: "Continue" }).click();
  const ex = page.locator("[data-explainer]").first();
  await expect(ex).toBeVisible();
  await expect(ex.getByText("The tempting step")).toBeVisible();
  await shot(page, info, "04-explainer-start", { phase: PHASE });
  const pause = ex.getByRole("button", { name: "Pause" });
  if (await pause.isVisible()) await pause.click();
  const next = ex.getByRole("button", { name: "Next" });
  while (await next.isEnabled()) await next.click();
  await expect(ex.getByText("Remember.")).toBeVisible();
  await shot(page, info, "05-explainer-end", { phase: PHASE });
  await expectAccessible(page, "step explainer");
});

test("replays page: every recap and explainer, one by one", async ({ page, context }, info) => {
  const students = [...new Set(RECAPS.map((r) => r.record_id.split(".")[0]!))];
  await withReport(context, info, students);
  for (const s of students) {
    await page.goto(`/s/${s}/today`);
    if (await page.getByRole("button", { name: "Build my plan" }).isVisible()) await page.getByRole("button", { name: "Build my plan" }).click();
    await expect(page.getByRole("link", { name: /Replay your mistakes/ })).toBeVisible();
    await page.getByRole("link", { name: /Replay your mistakes/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Replay your mistakes" })).toBeVisible();
    const mine = RECAPS.filter((r) => r.record_id.startsWith(`${s}.`));
    await expect(page.locator("[data-recap-mode]")).toHaveCount(mine.length);
    for (const r of mine) {
      const sel = `[data-record-id="${r.record_id}"]`;
      await expect(page.locator(sel)).toHaveAttribute("data-recap-mode", r.mode);
      if (r.mode === "typical_step") await expect(page.locator(sel).getByText("Not your working")).toBeVisible();
      else await expect(page.locator(sel).getByText("Your working, as quoted in your report")).toBeVisible();
      await boardShot(page, info, sel, `recap-${r.record_id}`);
    }
    for (const id of await page.locator("[data-explainer]").evaluateAll((els) => els.map((e) => e.getAttribute("data-explainer")!))) {
      const ex = page.locator(`[data-explainer="${id}"]`);
      // Show the whole walk-through: step to the end, then shoot the wrong step and the end.
      await boardShot(page, info, `[data-explainer="${id}"]`, `explainer-${id}-1`);
      const next = ex.getByRole("button", { name: "Next" });
      // Every board formula must fit the board (they shrink to fit on a phone).
      const overflow = async () => ex.locator(".katex-display").evaluateAll((els) => els.filter((e) => Math.max(...[...e.querySelectorAll(".base")].map((b) => b.getBoundingClientRect().right)) > e.closest("[aria-label=Board]")!.getBoundingClientRect().right + 1).map((e) => e.textContent));
      expect(await overflow(), `${id}: formula wider than the board`).toEqual([]);
      while (await next.isEnabled()) {
        await next.click();
        await page.waitForTimeout(50);
        expect(await overflow(), `${id}: formula wider than the board`).toEqual([]);
      }
      await boardShot(page, info, `[data-explainer="${id}"]`, `explainer-${id}-end`);
    }
    await expectAccessible(page, `replays ${s}`);
  }
});
