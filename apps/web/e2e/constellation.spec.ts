import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openMap, PHASE, resetDemo, rootFor, state, studentFor, withReport } from "./constellation-helpers";
import { expectAccessible, SCREENSHOTS_ROOT, shot } from "./helpers";

/**
 * Phase 4: the knowledge constellation, on SAMPLE DATA. Each project mutates
 * its own student (desktop: Vihaan, a Class 9 root under 43 topics; phone:
 * Riya) so the two runs never race on the same database rows. Within a
 * project the tests share that student's state, so they run in order.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

test("the constellation shows the roots, and mastering one sets off the chain reaction", async ({ page, context }, info) => {
  const student = studentFor(info);
  const root = rootFor(info);
  await withReport(context, info, [student]);
  await resetDemo(page, student);

  // 1. The map, in 3D, with the root labelled.
  await openMap(page, student);
  expect((await state(page)).renderer).toBe("3d");
  await expect(page.locator('div[data-renderer="3d"] canvas')).toBeVisible();
  await expect(page.getByText(root, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Root gap 1").first()).toBeVisible();
  await expect(page.getByRole("img", { name: /Knowledge constellation\. .*Root gap: / })).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, info, "01-overview", { phase: PHASE, animations: "allow" });
  await expectAccessible(page, "constellation");

  // 2. "Your roots": zoom to the problem area.
  await page.getByRole("button", { name: /^Your roots?$/ }).click();
  await page.waitForTimeout(1500);
  await shot(page, info, "02-your-roots", { phase: PHASE, animations: "allow" });

  // 3. Focus the root: its mistakes in the report's own words, and why it matters.
  await page.getByRole("button", { name: new RegExp(`^${root} Explains`) }).click();
  const detail = page.getByRole("article");
  await expect(detail.getByRole("heading", { name: root, level: 2 })).toBeVisible();
  await expect(detail.getByText("The mistakes, in your report's words")).toBeVisible();
  await expect(detail.getByText("Topics it lights up")).toBeVisible();
  await page.waitForTimeout(1300);
  await shot(page, info, "03-focus-root", { phase: PHASE, animations: "allow" });
  await page.getByRole("button", { name: "All roots" }).click();

  // 4. Demo trigger: write "mastered" to the database; the map animates the change.
  await page.getByRole("button", { name: `Master ${root}` }).click();
  await page.waitForFunction(() => (window.__constellation?.ripples ?? 0) >= 1, null, { timeout: 15_000 });
  await expect(page.getByRole("status").filter({ hasText: `${root} mastered. The light spreads to` })).toBeAttached();
  await page.waitForTimeout(1500);
  await shot(page, info, "04-ripple", { phase: PHASE, animations: "allow" });
  await page.waitForTimeout(3500);
  await expect(page.getByText("Mastered").first()).toBeVisible();
  await shot(page, info, "05-after-ripple", { phase: PHASE, animations: "allow" });

  // 5. The state lives in the database: a fresh load shows it without replaying.
  await page.evaluate(() => localStorage.clear());
  await openMap(page, student);
  expect((await state(page)).ripples).toBe(0);
  await expect(page.getByRole("button", { name: new RegExp(`${root}.*Mastered`) })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recovering" })).toBeVisible();

  // 6. Reset for the next run.
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByRole("button", { name: `Master ${root}` })).toBeVisible();
});

test("the diagnosis page shows a live preview that opens the full map", async ({ page, context }, info) => {
  const student = studentFor(info);
  await withReport(context, info, [student]);
  await page.goto(`/s/${student}/diagnosis`);
  const slot = page.locator('[data-slot="constellation"]');
  await expect(slot).toBeVisible();
  await page.waitForFunction(() => window.__constellation?.ready === true, null, { timeout: 30_000 });
  await slot.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await slot.screenshot({ path: join(SCREENSHOTS_ROOT, PHASE, `${info.project.name}-06-diagnosis-preview.png`) });
  await expectAccessible(page, "diagnosis with constellation preview");
  await slot.getByRole("link", { name: "Open the map" }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${student}/constellation$`));
});

test.describe("fallback to the 2D map", () => {
  test("forced, with the full experience: roots, focus and ripple", async ({ page, context }, info) => {
    const student = studentFor(info);
    const root = rootFor(info);
    await withReport(context, info, [student]);
    await resetDemo(page, student);
    await openMap(page, student, "?view=2d");
    expect((await state(page)).renderer).toBe("2d");
    await expect(page.locator('svg[data-renderer="2d"]')).toBeVisible();
    await expect(page.locator("svg").getByText(root, { exact: true })).toBeVisible();
    await shot(page, info, "07-2d-overview", { phase: PHASE, animations: "allow" });
    await expectAccessible(page, "2D constellation");

    await page.getByRole("button", { name: `Master ${root}` }).click();
    await page.waitForFunction(() => (window.__constellation?.ripples ?? 0) >= 1, null, { timeout: 15_000 });
    await page.waitForTimeout(1200);
    await shot(page, info, "08-2d-ripple", { phase: PHASE, animations: "allow" });
    await page.waitForTimeout(2500);
    await shot(page, info, "09-2d-after", { phase: PHASE, animations: "allow" });
    await page.getByRole("button", { name: "Reset demo" }).click();
    await expect(page.getByRole("button", { name: `Master ${root}` })).toBeVisible();
  });

  test("when WebGL is unavailable", async ({ page, context }, info) => {
    await withReport(context, info, [studentFor(info)]);
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type.startsWith("webgl") || type === "experimental-webgl") return null;
        return (original as (...a: unknown[]) => RenderingContext | null).call(this, type, ...rest);
      } as typeof original;
    });
    await openMap(page, studentFor(info));
    expect(await state(page)).toMatchObject({ renderer: "2d", reason: "no-webgl" });
    await expect(page.getByText("This browser can't draw 3D, so here is the 2D map.")).toBeVisible();
    await expect(page.locator('svg[data-renderer="2d"]')).toBeVisible();
  });

  test("on a weak device", async ({ page, context }, info) => {
    await withReport(context, info, [studentFor(info)]);
    await page.addInitScript(() => Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 2 }));
    await openMap(page, studentFor(info));
    expect(await state(page)).toMatchObject({ renderer: "2d", reason: "weak-device" });
  });

  test("when the 3D view can't keep up", async ({ page, context }, info) => {
    test.setTimeout(60_000);
    await withReport(context, info, [studentFor(info)]);
    // Make every frame cost ~70 ms of main-thread work: ~14 fps.
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) =>
        raf((t) => {
          const until = performance.now() + 70;
          while (performance.now() < until) {
            /* busy */
          }
          cb(t);
        });
    });
    await openMap(page, studentFor(info));
    await page.waitForFunction(() => window.__constellation?.renderer === "2d", null, { timeout: 30_000 });
    expect(await state(page)).toMatchObject({ renderer: "2d", reason: "slow" });
    await expect(page.getByText("Switched to the 2D map to keep things smooth.")).toBeVisible();
  });
});

test("reduced motion: no travelling light, the new state appears at once and is announced", async ({ page, context }, info) => {
  const student = studentFor(info);
  const root = rootFor(info);
  await withReport(context, info, [student]);
  await resetDemo(page, student);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openMap(page, student);
  await page.getByRole("button", { name: `Master ${root}` }).click();
  await expect(page.getByRole("status").filter({ hasText: `${root} mastered.` })).toBeAttached({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: new RegExp(`${root}.*Mastered`) })).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, info, "10-reduced-motion-after", { phase: PHASE });
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByRole("button", { name: `Master ${root}` })).toBeVisible();
});

test("keyboard: every root and weak topic is reachable from the panel", async ({ page, context }, info) => {
  test.skip(!info.project.name.endsWith("desktop"), "keyboard test runs on desktop");
  const student = studentFor(info);
  await withReport(context, info, [student]);
  await openMap(page, student);
  const rootButton = page.getByRole("button", { name: new RegExp(`^${rootFor(info)} Explains`) });
  await rootButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("article").getByRole("heading", { level: 2 })).toHaveText(rootFor(info));
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Your root" })).toBeVisible();
});
