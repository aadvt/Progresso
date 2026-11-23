/**
 * End-to-end check of the mission widget in a real MCP Apps host, against the
 * real demo database, with the web app open next to it:
 *
 *   widget (in the ext-apps basic-host) → submit_answer → SQLite → web app
 *
 * Needs three things running:
 *   pnpm mcp                                   MCP server on :3101 (no token)
 *   pnpm web:dev                               web app on :3100
 *   basic-host on :8080 with SERVERS='["http://localhost:3101/mcp"]'
 *     (git clone modelcontextprotocol/ext-apps; npm install; cd examples/basic-host;
 *      build index.html + sandbox.html with vite; npx tsx serve.ts)
 *
 *   pnpm mcp:host-check [--keep]
 *
 * Run 1 answers one question wrong (feedback, model context, "Ask Claude why"),
 * run 2 answers all three right (the root is proven, the web map plays the ripple).
 * The student's plan is reset at the start and (unless --keep) at the end.
 * Screenshots: docs/phase-10/screenshots/.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type FrameLocator, type Page } from "@playwright/test";
import { findRepoRoot } from "@progresso/core";
import { resetPlan } from "@progresso/db";
import * as service from "@progresso/service";

const STUDENT = process.env.STUDENT ?? "demo-riya";
const HOST = process.env.HOST_URL ?? "http://localhost:8080";
const WEB = process.env.PROGRESSO_WEB_URL ?? "http://localhost:3100";
const SHOTS = join(findRepoRoot(), "docs", "phase-10", "screenshots");
mkdirSync(SHOTS, { recursive: true });

const log = (...a: unknown[]) => console.log("•", ...a);
const fail = (msg: string): never => {
  throw new Error(`CHECK FAILED: ${msg}`);
};

function answerKey(questionId: string): { right: string; wrong: string } {
  const q = service.store().bank.byId.get(questionId) ?? fail(`unknown question ${questionId}`);
  const right = q.options!.find((o) => o.correct)!.id;
  const wrong = (q.options!.find((o) => !o.correct && o.misconception_id) ?? q.options!.find((o) => !o.correct))!.id;
  return { right, wrong };
}

async function version(): Promise<string> {
  const r = await fetch(`${WEB}/api/students/${STUDENT}/version`);
  return ((await r.json()) as { version: string }).version;
}

/** Calls get_tonight_mission from the host UI and returns the widget's frame. */
async function openWidget(host: Page): Promise<FrameLocator> {
  await host.goto(HOST);
  const tool = host.locator('select[class*="toolSelect"]');
  await tool.locator('option[value="get_tonight_mission"]').waitFor({ state: "attached", timeout: 30_000 });
  await tool.selectOption("get_tonight_mission");
  await host.locator('textarea[class*="toolInput"]').fill(JSON.stringify({ student: STUDENT }));
  await host.locator('button[type="submit"]').click();
  const widget = host.frameLocator("iframe").first().frameLocator("iframe").first();
  await widget.locator(".card h1").waitFor({ timeout: 30_000 });
  await widget.locator(".stem").waitFor();
  return widget;
}

async function questionIds(): Promise<string[]> {
  // The mission the widget shows is the one stored in the DB (same service): read its question ids.
  const { getMission, getPlan } = await import("@progresso/db");
  const ctx = service.studentContext(STUDENT)!;
  const today = service.studentToday(STUDENT);
  const m = getPlan(service.db(), ctx, today)!.days.find((d) => d.date === today)!.missions.find((x) => x.stored_id)!;
  return getMission(service.db(), ctx, m.stored_id!)!.questions.map((q) => q.question.id);
}

async function answer(widget: FrameLocator, option: string): Promise<void> {
  await widget.locator(`[data-opt="${option}"]`).click();
  await widget.locator("#check").click();
  await widget.locator("#fb").waitFor({ timeout: 15_000 });
}

async function panelText(host: Page): Promise<string> {
  // Expand every collapsible panel (Tool Input/Result, Messages, Model Context) and read the page.
  for (const h of await host.locator('[class*="collapsibleHeader"]').all()) await h.click().catch(() => {});
  return host.locator("body").innerText();
}

async function main(): Promise<void> {
  resetPlan(service.db(), STUDENT);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  await ctx.addCookies([{ name: "progresso-reports", value: STUDENT, url: WEB }]);

  // The web app's constellation, open the whole time (LiveSync polls the progress version).
  const web = await ctx.newPage();
  await web.goto(`${WEB}/s/${STUDENT}/constellation`);
  await web.waitForFunction(() => (globalThis as unknown as { __constellation?: { ready: boolean } }).__constellation?.ready === true, null, { timeout: 60_000 });
  const ripples = () => web.evaluate(() => (globalThis as unknown as { __constellation: { ripples: number } }).__constellation.ripples);
  await web.screenshot({ path: join(SHOTS, "web-01-constellation-before.png") });
  log("web constellation open, ripples =", await ripples());

  // ---- run 1: one wrong answer
  const host = await ctx.newPage();
  let widget = await openWidget(host);
  await host.waitForTimeout(600);
  await host.screenshot({ path: join(SHOTS, "host-01-mission-widget.png"), fullPage: true });
  log("widget rendered in basic-host:", await widget.locator(".card h1").innerText());

  const ids = await questionIds();
  if (ids.length !== 3) fail(`expected 3 questions, got ${ids.length}`);
  const v0 = await version();
  await answer(widget, answerKey(ids[0]!).wrong);
  const fb = await widget.locator("#fb").innerText();
  if (!/Not quite/.test(fb)) fail("wrong answer not marked wrong");
  await widget.locator("#fb").scrollIntoViewIfNeeded();
  await host.screenshot({ path: join(SHOTS, "host-02-wrong-answer-feedback.png"), fullPage: true });
  log("wrong answer feedback:", fb.split("\n").slice(0, 3).join(" | "));

  // Recorded in the database the web app reads.
  const { lastAttempt } = await import("@progresso/db");
  const a = lastAttempt(service.db(), STUDENT, ids[0]!);
  if (!a || a.correct) fail("answer not recorded in the DB");
  log("DB: question_attempts row", JSON.stringify(a));
  const v1 = await version();
  if (v1 === v0) fail("progress version did not change");
  log("web /version changed:", v0, "→", v1);

  // The model was told (updateModelContext), and "Ask Claude why" sends a message to the conversation.
  await widget.getByRole("button", { name: "Ask Claude why →" }).click();
  await host.waitForTimeout(800);
  const panels = await panelText(host);
  if (!panels.includes("progresso-mission")) fail("no model-context update seen by the host");
  if (!panels.includes("Why was my answer")) fail("no message sent to the host");
  await host.screenshot({ path: join(SHOTS, "host-03-model-context-and-message.png"), fullPage: true });
  log("host saw updateModelContext + sendMessage");

  widget = host.frameLocator("iframe").first().frameLocator("iframe").first();
  await widget.locator("#next").click();
  await answer(widget, answerKey(ids[1]!).right);
  await widget.locator("#next").click();
  await answer(widget, answerKey(ids[2]!).right);
  await widget.locator("#result").waitFor();
  await widget.locator("#result").scrollIntoViewIfNeeded();
  await host.screenshot({ path: join(SHOTS, "host-04-result-not-yet.png"), fullPage: true });
  log("result:", (await widget.locator("#result .big").innerText()).trim());

  // The open web page picks it up (LiveSync → router.refresh → the map animates the change).
  await web.waitForTimeout(5000);
  await web.screenshot({ path: join(SHOTS, "web-02-constellation-learning.png") });
  const mastery = service.constellation(STUDENT)!.roots.map((r) => `${r.name}: mastered=${r.mastered}`);
  log("DB-backed constellation:", mastery.join(", "));

  // ---- run 2: all right → the root is proven → ripple on the open web page
  resetPlan(service.db(), STUDENT);
  await web.waitForTimeout(4000); // let the page sync to the reset
  const before = await ripples();
  widget = await openWidget(host);
  const ids2 = await questionIds();
  for (let i = 0; i < ids2.length; i++) {
    await answer(widget, answerKey(ids2[i]!).right);
    if (i < ids2.length - 1) await widget.locator("#next").click();
  }
  await widget.locator("#result").waitFor();
  await widget.locator("#result").scrollIntoViewIfNeeded();
  await host.screenshot({ path: join(SHOTS, "host-05-result-passed.png"), fullPage: true });
  log("result:", (await widget.locator("#result .big").innerText()).trim(), "|", await widget.locator(".ripple").innerText().catch(() => "(no ripple note)"));

  await web.waitForFunction((n) => (globalThis as unknown as { __constellation: { ripples: number } }).__constellation.ripples > n, before, { timeout: 20_000 }).catch(() => fail("no ripple on the open web page"));
  await web.waitForTimeout(1500);
  await web.screenshot({ path: join(SHOTS, "web-03-constellation-ripple.png") });
  log("web constellation played the ripple: ripples", before, "→", await ripples());

  // The progress widget.
  await host.goto(HOST);
  const tool = host.locator('select[class*="toolSelect"]');
  await tool.locator('option[value="get_progress"]').waitFor({ state: "attached" });
  await tool.selectOption("get_progress");
  await host.locator('textarea[class*="toolInput"]').fill(JSON.stringify({ student: STUDENT }));
  await host.locator('button[type="submit"]').click();
  const pw = host.frameLocator("iframe").first().frameLocator("iframe").first();
  await pw.locator(".sky svg").waitFor({ timeout: 30_000 });
  await host.waitForTimeout(500);
  await host.screenshot({ path: join(SHOTS, "host-06-progress-widget.png"), fullPage: true });
  log("progress widget:", await pw.locator("h1").innerText());

  // Dark theme (basic-host's theme toggle → host-context-changed).
  await host.locator('button[class*="themeToggle"]').click().catch(() => {});
  await host.waitForTimeout(500);
  await host.screenshot({ path: join(SHOTS, "host-07-progress-dark.png"), fullPage: true });

  await browser.close();
  if (!process.argv.includes("--keep")) {
    resetPlan(service.db(), STUDENT);
    log(`reset ${STUDENT}'s plan so the live demo starts clean`);
  }
  log("ALL CHECKS PASSED. Screenshots in", SHOTS);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
