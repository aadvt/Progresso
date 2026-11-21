import { expect, test } from "@playwright/test";
import { expectAccessible, shot } from "./helpers";

/**
 * The Phase 3 flow, end to end, on SAMPLE DATA: pick a student, add a report,
 * see the diagnosis. Runs at desktop and phone sizes (see playwright.config.ts).
 */

test("pick a student, add the sample report, see the diagnosis", async ({ page }, info) => {
  // 1. Landing / student picker
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("exam ready");
  await expect(page.getByText("Sample data").first()).toBeVisible();
  await expectAccessible(page, "landing");
  await shot(page, info, "01-landing", { fullPage: true });

  await page.getByRole("link", { name: /Riya/ }).click();

  // 2. Add exam report
  await expect(page).toHaveURL(/\/s\/demo-riya\/add-report$/);
  await expect(page.getByRole("heading", { name: "Add an exam report" })).toBeVisible();
  await expect(page.getByText("Demo mode")).toBeVisible();
  await expectAccessible(page, "add report");
  await shot(page, info, "02-add-report", { fullPage: true });

  await page.getByRole("button", { name: "Load sample report" }).click();

  // Progress: real parser stages stream in.
  await expect(page.getByText(/Linking mistakes to the syllabus/)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: /Found 11 diagnosed mistakes across 3 exams/ })).toBeVisible();
  await shot(page, info, "03-reading-report");
  // The "ready" panel auto-navigates after 1.4 s; a slow screenshot under load can miss it,
  // so accept either the panel or the diagnosis it leads to.
  const ready = page.getByText("Your diagnosis is ready");
  await expect(ready.or(page.getByRole("heading", { level: 1, name: /^Fix / }))).toBeVisible({ timeout: 15_000 });
  if (await ready.isVisible()) await shot(page, info, "04-report-read");

  // 3. Diagnosis (auto-navigates)
  await expect(page).toHaveURL(/\/s\/demo-riya\/diagnosis$/, { timeout: 10_000 });
  const headline = page.getByRole("heading", { level: 1 });
  await expect(headline).toHaveText(/Fix 1 thing: it explains 8 of your 11 errors, worth about 12 marks\./);
  await expect(page.getByRole("heading", { name: "Chain rule", level: 3 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide the evidence" })).toHaveAttribute("aria-expanded", "true");
  // The report's verbatim words are shown as evidence.
  await expect(page.getByText("The student wrote the derivative as cos(x^2).", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "One-off mistakes" })).toBeVisible();
  await expect(page.locator('[data-slot="constellation"]')).toBeVisible();
  await expectAccessible(page, "diagnosis");
  await shot(page, info, "05-diagnosis", { fullPage: true });
  await shot(page, info, "05a-diagnosis-fold");

  // Working and correct method, only where the report quotes them.
  const firstWorking = page.getByText("Your working and the fix").first();
  await firstWorking.click();
  await expect(page.getByText("Your working, as quoted in the report").first()).toBeVisible();
  await page.getByRole("heading", { name: "How one gap spreads" }).scrollIntoViewIfNeeded();
  await shot(page, info, "06-root-chain");

  // 4. Original report, for trust
  await page.getByRole("button", { name: "View original report" }).click();
  const dialog = page.getByRole("dialog", { name: "The original report" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Sample data.")).toBeVisible();
  await expect(dialog.getByText("Unit Test 1 · Mathematics")).toBeVisible();
  await expectAccessible(page, "report dialog");
  await shot(page, info, "07-original-report");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // 5. Call to action: since Phase 5 it leads to the comeback plan (missions.spec covers that screen).
  await page.getByRole("link", { name: "Start my comeback plan" }).first().click();
  await expect(page).toHaveURL(/\/s\/demo-riya\/today$/);
  await expect(page.getByRole("heading", { level: 1, name: /Two questions, then your plan|Today's mission|Done for today|Nothing due today/ })).toBeVisible();

  // Back on the picker, Riya now shows as ready.
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Riya/ })).toContainText("Diagnosis ready");
});

test("pasted text is accepted but the demo parser says it was not read", async ({ page }, info) => {
  await page.goto("/s/demo-kabir/add-report");
  await page.getByLabel("Report text").fill("Q12: The student used 1 - cos 2x = 2 cos^2 x ...");
  await page.getByRole("button", { name: "Read report" }).click();
  await expect(page.getByText("Your diagnosis is ready")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/the text you added was not read/)).toBeVisible();
  // No auto-redirect while that notice is showing.
  await page.waitForTimeout(2000);
  await expect(page).toHaveURL(/add-report$/);
  await shot(page, info, "09-pasted-text-notice");
  await page.getByRole("button", { name: "See my diagnosis" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Fix 2 things/);
  await expect(page.getByRole("heading", { name: "The 2 root gaps" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Slips and habits" })).toBeVisible();
  await shot(page, info, "10-two-roots", { fullPage: true });
});

test("habits-only student and a deep Class 9 root", async ({ page }, info) => {
  for (const id of ["demo-ananya", "demo-vihaan"]) {
    await page.goto(`/s/${id}/add-report`);
    await page.getByRole("button", { name: "Load sample report" }).click();
    await expect(page).toHaveURL(new RegExp(`/s/${id}/diagnosis$`), { timeout: 15_000 });
  }
  await page.goto("/s/demo-ananya/diagnosis");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Fix 4 checking habits: behind 10 of your 10 errors/);
  await expect(page.getByRole("heading", { name: /root gap/ })).toHaveCount(0);
  await expectAccessible(page, "habits diagnosis");
  await shot(page, info, "11-habits-only", { fullPage: true });

  await page.goto("/s/demo-vihaan/diagnosis");
  await expect(page.getByRole("heading", { name: "Algebraic identities", level: 3 })).toBeVisible();
  await expect(page.getByText("used in", { exact: false }).first()).toBeVisible();
  await page.getByRole("heading", { name: "How one gap spreads" }).scrollIntoViewIfNeeded();
  await shot(page, info, "12-deep-chain");
});

test("diagnosis without a report goes to Add report", async ({ page }) => {
  await page.goto("/s/demo-riya/diagnosis");
  await expect(page).toHaveURL(/\/s\/demo-riya\/add-report$/);
});

test("keyboard only: pick, add, open evidence, open and close the report", async ({ page }) => {
  await page.goto("/");
  // Skip link first, then logo, then the student cards.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  const riya = page.getByRole("link", { name: /Riya/ });
  for (let i = 0; i < 10 && !(await riya.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(riya).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/add-report$/);

  const load = page.getByRole("button", { name: "Load sample report" });
  await load.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/diagnosis$/, { timeout: 20_000 });

  const toggle = page.getByRole("button", { name: "Hide the evidence" });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Why this is the root" })).toHaveAttribute("aria-expanded", "false");

  await page.getByRole("button", { name: "View original report" }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "The original report" });
  await expect(dialog).toBeVisible();
  // Focus is inside the dialog, and Escape returns it.
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "View original report" })).toBeFocused();
});

test("reduced motion turns animation off", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  const duration = await page.locator("[data-enter]").first().evaluate((el) => getComputedStyle(el).animationDuration);
  expect(parseFloat(duration)).toBeLessThanOrEqual(0.001);
  await context.close();
});
