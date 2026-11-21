import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

export const SCREENSHOTS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "screenshots");
export const SCREENSHOT_DIR = join(SCREENSHOTS_ROOT, "phase-3");

/** Save a screenshot as docs/screenshots/<phase>/<project>-<name>.png (phase-3 unless given). */
export async function shot(
  page: Page,
  info: TestInfo,
  name: string,
  options: { fullPage?: boolean; phase?: string; animations?: "disabled" | "allow" } = {},
): Promise<void> {
  const dir = options.phase ? join(SCREENSHOTS_ROOT, options.phase) : SCREENSHOT_DIR;
  mkdirSync(dir, { recursive: true });
  // Full-page shots are JPEG to keep the repo small; viewport shots stay lossless PNG.
  const fullPage = options.fullPage ?? false;
  await page.screenshot({
    path: join(dir, `${info.project.name}-${name}.${fullPage ? "jpg" : "png"}`),
    ...(fullPage ? { type: "jpeg" as const, quality: 85 } : {}),
    fullPage,
    animations: options.animations ?? "disabled",
  });
}

/** WCAG 2.1 AA check with axe. Fails the test on any violation. */
export async function expectAccessible(page: Page, context: string): Promise<void> {
  // Let entrance animations finish: mid-fade opacity would skew the contrast check.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(" ")).join("\n    ")}`);
  expect(summary, `axe violations on ${context}`).toEqual([]);
}
