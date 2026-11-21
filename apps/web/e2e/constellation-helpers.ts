import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { SCREENSHOTS_ROOT } from "./helpers";

/** Shared by the constellation and performance specs. */
export const PHASE = "phase-4";
export const isDesktop = (info: TestInfo) => info.project.name.endsWith("desktop");
export const studentFor = (info: TestInfo) => (isDesktop(info) ? "demo-vihaan" : "demo-riya");
export const rootFor = (info: TestInfo) => (isDesktop(info) ? "Algebraic identities" : "Chain rule");

export type Stats = { renderer: string; reason: string; ready: boolean; ripples: number; stats?: { fps: number; avgFps: number; pixelRatio: number; renderer: string } };
export const state = (page: Page) => page.evaluate(() => window.__constellation as unknown as Stats);

export async function withReport(context: BrowserContext, info: TestInfo, ids: string[]): Promise<void> {
  await context.addCookies([{ name: "progresso-reports", value: ids.join(","), url: info.project.use.baseURL! }]);
}

export async function openMap(page: Page, studentId: string, query = ""): Promise<void> {
  await page.goto(`/s/${studentId}/constellation${query}`);
  await page.waitForFunction(() => window.__constellation?.ready === true, null, { timeout: 30_000 });
}

/** Start from the diagnosis as the report gave it: no mastery in the database. */
export async function resetDemo(page: Page, studentId: string): Promise<void> {
  await openMap(page, studentId, "?view=2d");
  const reset = page.getByRole("button", { name: "Reset demo" });
  if (await reset.isVisible()) {
    await reset.click();
    await expect(reset).toBeHidden();
  }
  await page.evaluate(() => localStorage.clear());
}

/** Frames per second measured by the page itself over `ms`. */
export async function measureFps(page: Page, ms: number): Promise<number> {
  return page.evaluate(
    (duration) =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = (now: number) => {
          frames++;
          if (now - start < duration) requestAnimationFrame(tick);
          else resolve(Math.round(((frames * 1000) / (now - start)) * 10) / 10);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

export function savePerf(info: TestInfo, data: unknown): void {
  const dir = join(SCREENSHOTS_ROOT, PHASE);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${info.project.name}-perf.json`), `${JSON.stringify(data, null, 2)}\n`);
}

