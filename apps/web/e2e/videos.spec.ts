import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { withReport } from "./constellation-helpers";
import { expectAccessible, shot } from "./helpers";

/**
 * Phase 7: explainer videos, on SAMPLE DATA.
 * - A mission whose misconception has a passing video shows it as the explainer; it plays,
 *   seeks (byte ranges), and the step explainer stays one click away.
 * - If the video can't load, or there is no passing video, the step explainer is shown.
 * - Failed videos are never served.
 */
const PHASE = "phase-7";
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
test.describe.configure({ mode: "serial", timeout: 180_000 });

type Entry = { misconception_id: string; status: "passed" | "failed"; review?: { verdict: "approved" | "rejected" } };
const manifestPath = join(REPO, "data", "videos", "manifest.json");
const ENTRIES: Entry[] = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")) as { videos: Entry[] }).videos : [];
/** Served: passed the automatic checks and not rejected on review. */
const PASSING = new Set(ENTRIES.filter((e) => e.status === "passed" && e.review?.verdict !== "rejected").map((e) => e.misconception_id));
/** The e2e server's own database (playwright.config.ts). */
const DB_PATH = join(REPO, process.env.DATABASE_PATH ?? "data/progresso-e2e.db");
const STUDENTS = ["demo-riya", "demo-kabir", "demo-ananya", "demo-vihaan"];

/** Build a fresh plan, start today's mission and go to its explainer step. False for a student with no missions (habits only). */
async function toExplainer(page: Page, student: string): Promise<boolean> {
  await page.goto(`/s/${student}/today`);
  const reset = page.getByRole("button", { name: "Reset plan" });
  if (await reset.isVisible()) await reset.click();
  await page.getByRole("button", { name: "Build my plan" }).click();
  const start = page.getByRole("button", { name: /^(Start|Continue) mission$/ }).first();
  const none = page.getByRole("heading", { name: "Nothing due today", level: 1 });
  await expect(start.or(none)).toBeVisible();
  if (await none.isVisible()) return false;
  await start.click();
  await expect(page).toHaveURL(/\/mission\//);
  const next = page.getByRole("button", { name: "Continue" });
  if (await next.isVisible()) await next.click();
  await expect(page.getByText(/Step 2 · Explainer/)).toBeVisible();
  return true;
}

test("a passing video is the mission's explainer: it plays and seeks; step by step stays available", async ({ page, context }, info) => {
  test.skip(PASSING.size === 0, "no passing videos in data/videos/manifest.json");
  await withReport(context, info, STUDENTS);
  let found = false;
  for (const student of STUDENTS) {
    if (!(await toExplainer(page, student))) continue;
    if ((await page.locator("[data-video]").count()) > 0) {
      found = true;
      break;
    }
  }
  expect(found, "some demo student's first mission has a passing video").toBe(true);

  const box = page.locator("[data-video]");
  expect(PASSING.has((await box.getAttribute("data-video"))!)).toBe(true);
  const video = box.locator("video");
  await expect(video).toHaveAttribute("poster", /poster\.jpg$/);
  // Captions are drawn into the video; the same text is a captions track and a transcript.
  await expect(video.locator("track[kind=captions]")).toHaveCount(1);
  await box.getByText("Read the captions").click();
  expect(await box.locator("details li").count()).toBeGreaterThanOrEqual(4);

  // Plays (muted, as autoplay policy needs) and seeks to the middle: the server answers byte ranges.
  const state = await video.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    await v.play();
    await new Promise((r) => setTimeout(r, 1500));
    const playedTo = v.currentTime;
    v.currentTime = v.duration / 2;
    await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
    v.pause();
    return { playedTo, duration: v.duration, at: v.currentTime, width: v.videoWidth, error: v.error?.code ?? null };
  });
  expect(state.error).toBeNull();
  expect(state.playedTo).toBeGreaterThan(0.5);
  expect(state.duration).toBeGreaterThanOrEqual(55);
  expect(state.duration).toBeLessThanOrEqual(130);
  expect(state.at).toBeGreaterThan(state.duration / 2 - 2);
  expect(state.width).toBe(1280);
  const src = await video.locator("source").getAttribute("src");
  const ranged = await page.request.get(src!, { headers: { range: "bytes=0-99" } });
  expect(ranged.status()).toBe(206);
  expect(ranged.headers()["content-range"]).toMatch(/^bytes 0-99\/\d+$/);
  await shot(page, info, "01-mission-video", { phase: PHASE });
  await expectAccessible(page, "explainer video");

  // The step explainer is still there, one click away.
  const stepByStep = page.getByText("Prefer to go step by step?");
  if (await stepByStep.count()) {
    await stepByStep.click();
    await expect(page.locator("[data-explainer]").first()).toBeVisible();
  }
});

test("if the video can't load, the step explainer is shown instead", async ({ page, context }, info) => {
  test.skip(PASSING.size === 0, "no passing videos");
  await withReport(context, info, STUDENTS);
  await page.route("**/media/videos/**/video.mp4", (route) => route.abort());
  for (const student of STUDENTS) {
    if (!(await toExplainer(page, student))) continue;
    // With the file unreachable, no video stays on screen.
    await expect(page.locator("[data-video]")).toHaveCount(0, { timeout: 15_000 });
  }
  await expect(page.locator("[data-explainer], [class*=explainerSlot]").first()).toBeVisible();
  await shot(page, info, "02-video-unavailable-fallback", { phase: PHASE });
});

test("misconceptions without a passing video get the step explainer; failed videos are never served", async ({ page, context, request }, info) => {
  await withReport(context, info, STUDENTS);
  let fallbacks = 0;
  for (const student of STUDENTS) {
    if (!(await toExplainer(page, student))) continue;
    const v = page.locator("[data-video]");
    if (await v.count()) {
      expect(PASSING.has((await v.getAttribute("data-video"))!)).toBe(true);
    } else {
      // The Phase 6 step explainer (or its placeholder when none exists yet).
      await expect(page.locator("[data-explainer], [class*=explainerSlot]").first()).toBeVisible();
      if (await page.locator("[data-explainer]").count()) {
        fallbacks++;
        if (fallbacks === 1) await shot(page, info, "03-no-video-step-explainer", { phase: PHASE });
      }
    }
  }
  // Later in a plan: Kabir's first six missions build on a root with a video. Mark that root and the
  // topics it feeds as proven (what finishing those missions writes), and the plan re-flows to his
  // chemistry root, whose misconception has a step explainer but no video.
  if (fallbacks === 0) {
    const student = "demo-kabir";
    await page.goto(`/s/${student}/today`);
    const reset = page.getByRole("button", { name: "Reset plan" });
    if (await reset.isVisible()) await reset.click();
    await page.getByRole("button", { name: "Build my plan" }).click();
    await expect(page.getByRole("heading", { name: "Today's mission", level: 1 })).toBeVisible();
    const db = new DatabaseSync(DB_PATH);
    const due = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const now = new Date().toISOString();
    const put = db.prepare(
      "INSERT INTO concept_mastery (student_id, concept_id, state, due_at, proven_at, updated_at) VALUES (?, ?, 'proven', ?, ?, ?) ON CONFLICT(student_id, concept_id) DO UPDATE SET state='proven', due_at=excluded.due_at, proven_at=excluded.proven_at",
    );
    for (const c of ["math.trig_multiple_angles", "math.continuity", "math.derivative_inverse_trig", "math.integration_trig_identities", "math.trig_sum_product"]) put.run(student, c, due, now, now);
    db.close();
    await page.reload();
    await page.getByRole("button", { name: /^(Start|Continue) mission$/ }).first().click();
    await expect(page).toHaveURL(/\/mission\//);
    const next = page.getByRole("button", { name: "Continue" });
    if (await next.isVisible()) await next.click();
    await expect(page.getByText(/Step 2 · Explainer/)).toBeVisible();
    await expect(page.locator("[data-explainer]").first()).toBeVisible();
    expect(await page.locator("[data-video]").count()).toBe(0);
    fallbacks++;
    await shot(page, info, "03-no-video-step-explainer", { phase: PHASE });
  }
  expect(fallbacks, "at least one mission shows the step explainer as the fallback").toBeGreaterThan(0);

  for (const e of ENTRIES.filter((x) => !PASSING.has(x.misconception_id))) {
    expect((await request.get(`/media/videos/${e.misconception_id}/video.mp4`)).status(), e.misconception_id).toBe(404);
  }
  expect((await request.get("/media/videos/math.chain_rule.m1/..%2F..%2Fmanifest.json")).status()).toBe(404);
  expect((await request.get("/media/videos/not.a.thing/video.mp4")).status()).toBe(404);

  // Replays: only passing videos, each with its poster served.
  await page.goto("/s/demo-riya/replays");
  for (const id of await page.locator("[data-video]").evaluateAll((els) => els.map((e) => e.getAttribute("data-video")!))) {
    expect(PASSING.has(id), id).toBe(true);
    expect((await request.get(`/media/videos/${id}/poster.jpg`)).status()).toBe(200);
  }
  await expectAccessible(page, "replays with videos");
});
