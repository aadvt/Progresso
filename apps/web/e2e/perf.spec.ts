import { expect, test } from "@playwright/test";
import { measureFps, openMap, resetDemo, rootFor, savePerf, state, studentFor, withReport } from "./constellation-helpers";

/**
 * Frame rate of the 3D constellation. Runs in its own projects after every
 * other test has finished, one project at a time (see playwright.config.ts),
 * so nothing else competes for the GPU or CPU while it measures.
 */
test("frame rate: smooth on desktop and with a phone-class CPU, during the ripple too", async ({ page, context }, info) => {
  test.setTimeout(180_000);
  const student = studentFor(info);
  await withReport(context, info, [student]);
  await resetDemo(page, student);
  await openMap(page, student);
  expect((await state(page)).renderer).toBe("3d");
  await page.waitForTimeout(2000);
  const normal = await measureFps(page, 5000);
  const normalStats = (await state(page)).stats;

  const cdp = await context.newCDPSession(page);
  const throttled: Record<string, { fps: number; renderer: string; pixelRatio?: number }> = {};
  for (const rate of [4, 6]) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    await page.waitForTimeout(3000);
    const fps = await measureFps(page, 5000);
    const s = await state(page);
    throttled[`${rate}x`] = { fps, renderer: s.renderer, ...(s.stats ? { pixelRatio: s.stats.pixelRatio } : {}) };
  }
  // The most demanding moment: the chain reaction, on the phone-class CPU.
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.getByRole("button", { name: `Master ${rootFor(info)}` }).click();
  await page.waitForFunction(() => (window.__constellation?.ripples ?? 0) >= 1, null, { timeout: 30_000 });
  const ripple4x = await measureFps(page, 3000);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByRole("button", { name: `Master ${rootFor(info)}` })).toBeVisible();

  savePerf(info, {
    student,
    viewport: page.viewportSize(),
    gpu: normalStats?.renderer,
    unthrottled: { fps: normal, sceneAvgFps: normalStats?.avgFps, pixelRatio: normalStats?.pixelRatio },
    cpuThrottled: throttled,
    rippleAt4x: ripple4x,
    measuredAt: new Date().toISOString(),
  });
  console.log(`[${info.project.name}] fps unthrottled ${normal}, throttled ${JSON.stringify(throttled)}`);
  expect(normal).toBeGreaterThan(45);
  // A phone-class CPU (4x slower) must still be smooth.
  expect(throttled["4x"]!.fps).toBeGreaterThan(30);
  expect(ripple4x).toBeGreaterThan(30);
});

