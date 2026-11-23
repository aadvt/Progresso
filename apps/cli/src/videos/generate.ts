/**
 * Generate explainer videos offline: one short Manim animation per
 * misconception, reused by every student who shares it. Never runs live.
 *
 *   pnpm videos:generate                    top 5 most frequent maths/physics misconceptions
 *   pnpm videos:generate --top 8            more of them
 *   pnpm videos:generate --only a,b         these misconceptions (ids or substrings)
 *   pnpm videos:generate --subjects Mathematics,Chemistry
 *   pnpm videos:generate --missing          skip misconceptions with a served video (rejected ones are made again)
 *   pnpm videos:generate --list             print the ranked targets only
 *   pnpm videos:generate --max-attempts 4   renders per misconception (default 4)
 *   pnpm videos:generate --narration none   narration provider (captions are always on screen)
 *   pnpm videos:generate --fresh            ask for a new storyboard and first draft instead of the cached ones
 *
 * Per misconception:
 *  1. storyboard (task write_storyboard): 60-120 s, one idea, starting from the
 *     typical wrong step; built on the verified step explainer when there is one;
 *  2. code (task codegen_manim), on the shared base scene tools/manim/progresso_manim.py;
 *  3. quality loop, at most --max-attempts renders, each failure fed back to the code
 *     generator: static safety lint → render (errors) → duration → layout audit
 *     (measured overlaps / off-screen / unreadable text, from the base scene) →
 *     frames extracted with ffmpeg and checked by Gemini (task check_frames:
 *     overlap, off-screen, wrong maths, unreadable layout, mismatch);
 *  4. pass: web-encoded MP4, poster, WebVTT captions and the code go to
 *     data/videos/<subject>/, the entry to manifest.json. Fail: a "failed"
 *     manifest entry, never shown; the step explainer covers it.
 * Rate limits are respected by the LLM layer (config/llm.json); renders run one at a time.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  captionsToVtt,
  findRepoRoot,
  isServable,
  loadAppConfig,
  loadConceptGraph,
  loadLessons,
  rankMisconceptions,
  readVideoManifest,
  StoryboardSchema,
  VIDEO_MANIFEST,
  VideoEntrySchema,
  VideoManifestSchema,
  type CaptionCue,
  type StepExplainer,
  type Storyboard,
  type VideoAttempt,
  type VideoAttemptStage,
  type VideoEntry,
} from "@progresso/core";
import { loadDemoFixtures } from "@progresso/core/demo-fixtures";
import { createLlmClient, type ImageInput, type LlmClient } from "@progresso/llm";
import { narrationProvider } from "./narration";
import {
  CODEGEN_SYSTEM,
  codegenPrompt,
  extractCode,
  FRAME_CHECK_SYSTEM,
  frameCheckPrompt,
  FrameCheckSchema,
  fixPrompt,
  STORYBOARD_SYSTEM,
  storyboardPrompt,
  StoryboardGenSchema,
  toStoryboard,
  VIDEO_PROMPT_VERSION,
} from "./prompts";
import { checkTools, encodeForWeb, extractFrame, lintCode, probeDuration, renderScene, resolveTools, type Audit, type ToolPaths } from "./render";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const repoRoot = findRepoRoot();
const config = loadAppConfig(repoRoot);
const { graph } = loadConceptGraph(config.conceptGraphDir);
const demo = loadDemoFixtures(config.fixturesDir);
const workRoot = join(repoRoot, "data", "cache", "videos");

/** Accept a rendered duration a little outside the storyboard range (animations rarely land on the second). */
const DURATION = { min: 55, max: 130 };
const BLOCKING_AUDIT = new Set(["overlap", "off_screen", "in_caption_band", "too_small", "caption_too_long"]);

// ---------------------------------------------------------------- targets

function targets(): { id: string; why: string }[] {
  const subjects = (value("subjects") ?? "Mathematics,Physics").split(",").map((s) => s.trim().toLowerCase());
  const only = value("only")?.split(",").filter(Boolean);
  if (only) {
    const all = [...graph.misconceptions.keys()];
    return [...new Set(only.flatMap((o) => (graph.misconceptions.has(o) ? [o] : all.filter((id) => id.includes(o)))))].map((id) => ({ id, why: "requested" }));
  }
  const ranked = rankMisconceptions(
    graph,
    demo.map((s) => ({ id: s.student.id, records: s.records })),
  ).filter((r) => subjects.includes(r.subject.toLowerCase()));
  return ranked.map((r) => ({ id: r.misconception_id, why: `${r.students} student(s), ${r.records} record(s)` }));
}

// ---------------------------------------------------------------- one video

interface Outcome {
  entry: VideoEntry;
  log: string[];
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

async function storyboardFor(llm: LlmClient, id: string, explainer: StepExplainer | undefined): Promise<{ storyboard: Storyboard; provider: string; model: string }> {
  const res = await llm.generateObject("write_storyboard", {
    system: STORYBOARD_SYSTEM,
    prompt: storyboardPrompt(graph, id, explainer),
    // Checked against the storyboard rules (60-120 s, caption length); invalid replies go back for repair.
    schema: StoryboardGenSchema.superRefine((g, ctx) => {
      const r = StoryboardSchema.safeParse(toStoryboard(g));
      if (!r.success) for (const i of r.error.issues) ctx.addIssue({ code: "custom", path: i.path, message: i.message });
    }),
    ...(flag("fresh") ? { cache: "refresh" as const } : {}),
  });
  return { storyboard: StoryboardSchema.parse(toStoryboard(res.data)), provider: res.provider, model: res.model };
}

/**
 * Frame times, per caption cue: the middle of its still moments (waits), so
 * no frame is caught mid-animation. The last still moment of every scene (its
 * finished state) is always included, plus the longest earlier one in long scenes.
 */
export function frameTimes(audit: Audit, duration: number): { time: number; caption: string }[] {
  const out: { time: number; caption: string }[] = [];
  for (const c of audit.captions) {
    const end = Math.min(c.end, duration);
    if (end - c.start <= 0.6) continue;
    const holds = (audit.holds ?? []).filter((h) => h.start >= c.start - 0.01 && h.end <= end + 0.01);
    const mid = (h: { start: number; end: number }) => (h.start + h.end) / 2;
    if (holds.length === 0) {
      out.push({ time: Math.max(c.start + 0.6, end - 0.35), caption: c.text });
      continue;
    }
    const last = holds.at(-1)!;
    const earlier = holds.slice(0, -1).sort((a, b) => b.end - b.start - (a.end - a.start))[0];
    if (earlier && end - c.start > 9) out.push({ time: mid(earlier), caption: c.text });
    out.push({ time: mid(last), caption: c.text });
  }
  return out.sort((a, b) => a.time - b.time).slice(0, 18);
}

async function makeVideo(llm: LlmClient, tools: ToolPaths, id: string, maxAttempts: number): Promise<Outcome> {
  const m = graph.misconceptions.get(id)!;
  const c = graph.get(m.concept_id);
  const log: string[] = [];
  const say = (line: string) => {
    log.push(line);
    console.log(line);
  };
  const lib = loadLessons(config, graph);
  const explainer = lib.explainers.get(id);
  const sb = await storyboardFor(llm, id, explainer);
  const storyboard = sb.storyboard;
  say(`storyboard "${storyboard.title}": ${storyboard.scenes.length} scenes, ${storyboard.scenes.reduce((a, s) => a + s.seconds, 0)} s`);

  const work = join(workRoot, id);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, "storyboard.json"), JSON.stringify(storyboard, null, 2));

  const attempts: VideoAttempt[] = [];
  let code: string | undefined;
  let last: { stage: VideoAttemptStage; problems: string[] } | undefined;
  let codegenModel = { provider: sb.provider, model: sb.model };
  const base: Omit<VideoEntry, "status" | "attempts" | "fix_iterations"> = {
    misconception_id: id,
    concept_id: c.id,
    subject: c.subject,
    title: storyboard.title,
    storyboard,
    narration: narrationProvider(value("narration") ?? "none").name,
    generator: codegenModel,
    ...(explainer ? { source_explainer_hash: sha(JSON.stringify(explainer)) } : {}),
    prompt_version: VIDEO_PROMPT_VERSION,
    generated_at: new Date().toISOString(),
  };

  for (let n = 1; n <= maxAttempts; n++) {
    const dir = join(work, `attempt-${n}`);
    mkdirSync(dir, { recursive: true });
    const prompt = code && last ? fixPrompt(storyboard, code, last.stage, last.problems) : codegenPrompt(storyboard);
    const gen = await llm.generateText("codegen_manim", { system: CODEGEN_SYSTEM, prompt, ...(n === 1 && flag("fresh") ? { cache: "refresh" as const } : {}) });
    codegenModel = { provider: gen.provider, model: gen.model };
    const next = extractCode(gen.data);
    const record = (stage: VideoAttemptStage, problems: string[], extra: Partial<VideoAttempt> = {}) => {
      attempts.push({ n, stage, problems, ...extra });
      last = { stage, problems };
      say(`  attempt ${n}: ${stage}${problems.length ? ` (${problems.length} problem(s)): ${problems.slice(0, 3).join(" | ").slice(0, 400)}` : ""}`);
    };
    if (!next) {
      record("lint", ["the reply had no ```python block containing class ExplainerScene"]);
      continue;
    }
    code = next;
    const file = join(dir, "explainer.py");
    writeFileSync(file, code);

    const lint = lintCode(tools, repoRoot, code);
    if (lint.length) {
      record("lint", lint);
      continue;
    }

    const r = await renderScene(tools, file, dir);
    if (!r.ok || !r.video) {
      record("render", [`Manim failed to render. Log:\n${r.error ?? "(no output)"}`], { render_seconds: Math.round(r.seconds) });
      continue;
    }
    const probe = probeDuration(tools, r.video);
    const timing = { render_seconds: Math.round(r.seconds), duration_s: Math.round(probe.duration * 10) / 10 };
    if (probe.duration < DURATION.min || probe.duration > DURATION.max) {
      record("duration", [`the video is ${probe.duration.toFixed(1)} s long; it must be 60-120 s. Adjust run_time/wait per scene to match the storyboard seconds.`], timing);
      continue;
    }
    const audit = r.audit;
    if (!audit || audit.captions.length < 3) {
      record("layout_audit", ["the scene did not call self.caption(...) for each storyboard scene"], timing);
      continue;
    }
    const auditProblems = audit.issues
      .filter((i) => BLOCKING_AUDIT.has(i.kind))
      .map((i) => `${i.kind} at t=${i.at}s: ${i.texts.map((t) => JSON.stringify(t)).join(" and ")}: ${i.detail}`);
    if (auditProblems.length) {
      record("layout_audit", auditProblems, timing);
      continue;
    }

    // Vision check of the rendered frames.
    const times = frameTimes(audit, probe.duration);
    const images: ImageInput[] = [];
    const framesDir = join(dir, "frames");
    mkdirSync(framesDir, { recursive: true });
    for (const [i, f] of times.entries()) {
      const out = join(framesDir, `f${String(i + 1).padStart(2, "0")}.jpg`);
      extractFrame(tools, r.video, f.time, out, 960);
      images.push({ mimeType: "image/jpeg", data: readFileSync(out).toString("base64"), label: `Frame ${i + 1} (t=${f.time.toFixed(1)} s)` });
    }
    const check = await llm.generateObject("check_frames", {
      system: FRAME_CHECK_SYSTEM,
      prompt: frameCheckPrompt(graph, id, storyboard, times.map((f, i) => ({ index: i + 1, time: f.time, caption: f.caption }))),
      images,
      schema: FrameCheckSchema,
    });
    writeFileSync(join(dir, "frame-check.json"), JSON.stringify(check.data, null, 2));
    const blockers = check.data.frames.flatMap((f) =>
      f.problems.filter((p) => p.severity === "blocker").map((p) => `frame ${f.frame} (t=${times[f.frame - 1]?.time.toFixed(1) ?? "?"} s, caption ${JSON.stringify(times[f.frame - 1]?.caption ?? "")}): ${p.kind}: ${p.description}`),
    );
    if (!check.data.maths_correct) blockers.push(`maths: ${check.data.maths_notes}`);
    if (blockers.length) {
      record("frame_check", blockers, timing);
      continue;
    }

    // Passed: publish the files.
    record("passed", [], timing);
    const subjectDir = c.subject.toLowerCase();
    const rel = (ext: string) => `${subjectDir}/${id}.${ext}`;
    const outDir = join(config.videosDir, subjectDir);
    mkdirSync(outDir, { recursive: true });
    const cues: CaptionCue[] = audit.captions.map((x) => ({ start: x.start, end: Math.min(x.end, probe.duration), text: x.text }));
    const narration = narrationProvider(value("narration") ?? "none");
    const audio = await narration.narrate({ storyboard, cues, durationS: probe.duration, outDir: dir });
    encodeForWeb(tools, r.video, join(config.videosDir, rel("mp4")), audio);
    const posterAt = times[Math.floor(times.length / 2)]?.time ?? probe.duration / 2;
    extractFrame(tools, r.video, posterAt, join(config.videosDir, rel("jpg")), 1280);
    writeFileSync(join(config.videosDir, rel("vtt")), captionsToVtt(cues));
    copyFileSync(file, join(config.videosDir, rel("py")));
    const entry = VideoEntrySchema.parse({
      ...base,
      generator: codegenModel,
      status: "passed",
      files: { video: rel("mp4"), poster: rel("jpg"), captions: rel("vtt"), code: rel("py") },
      duration_s: timing.duration_s,
      width: probe.width,
      height: probe.height,
      captions: cues.map((x) => ({ start: Math.round(x.start * 100) / 100, end: Math.round(x.end * 100) / 100, text: x.text })),
      attempts,
      fix_iterations: attempts.length - 1,
      frame_check: { model: check.model, frames: images.length, summary: check.data.summary },
    });
    return { entry, log };
  }
  return { entry: VideoEntrySchema.parse({ ...base, generator: codegenModel, status: "failed", attempts, fix_iterations: Math.max(0, attempts.length - 1) }), log };
}

// ---------------------------------------------------------------- manifest

function saveEntry(entry: VideoEntry): void {
  const manifest = readVideoManifest(config.videosDir);
  const old = manifest.videos.find((v) => v.misconception_id === entry.misconception_id);
  if (old && isServable(old) && entry.status === "failed") {
    console.log(`  keeping the earlier passing video for ${entry.misconception_id}; this run's attempts are in data/cache/videos/`);
    return;
  }
  // A replaced entry's files go too, unless the new entry reuses the same paths.
  for (const f of Object.values(old?.files ?? {})) if (!entry.files || !Object.values(entry.files).includes(f)) rmSync(join(config.videosDir, f), { force: true });
  manifest.videos = [...manifest.videos.filter((v) => v.misconception_id !== entry.misconception_id), entry].sort((a, b) => a.misconception_id.localeCompare(b.misconception_id));
  const path = join(config.videosDir, VIDEO_MANIFEST);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(VideoManifestSchema.parse(manifest), null, 2) + "\n");
}

async function main() {
  const top = Number(value("top") ?? 5);
  const maxAttempts = Math.max(1, Number(value("max-attempts") ?? 4));
  const manifest = readVideoManifest(config.videosDir);
  const status = (id: string) => {
    const v = manifest.videos.find((x) => x.misconception_id === id);
    return !v ? "-" : v.review?.verdict === "rejected" ? "rejected" : v.status;
  };
  let list = targets();
  if (flag("missing")) list = list.filter((t) => status(t.id) !== "passed");
  if (!value("only")) list = list.slice(0, top);
  if (flag("list")) {
    for (const t of list) console.log(`${t.id.padEnd(44)} ${t.why.padEnd(28)} ${status(t.id)}`);
    console.log(`${list.length} target(s)`);
    return;
  }
  const tools = resolveTools(repoRoot);
  const missing = checkTools(tools);
  if (missing.length) throw new Error(`Video tools missing:\n${missing.join("\n")}`);
  const llm = createLlmClient({ repoRoot });
  const summary: string[] = [];
  for (const t of list) {
    console.log(`\n${t.id} (${t.why})`);
    try {
      const { entry } = await makeVideo(llm, tools, t.id, maxAttempts);
      saveEntry(entry);
      const line = `${t.id}: ${entry.status.toUpperCase()} after ${entry.attempts.length} render attempt(s), ${entry.fix_iterations} fix iteration(s)${entry.duration_s ? `, ${entry.duration_s} s` : ""}`;
      console.log(line);
      summary.push(line);
    } catch (e) {
      const line = `${t.id}: ERROR ${(e as Error).message.slice(0, 400)}`;
      console.log(line);
      summary.push(line);
    }
  }
  console.log(`\nSummary\n${summary.join("\n")}`);
  if (existsSync(config.videosDir)) {
    const after = readVideoManifest(config.videosDir);
    console.log(`Manifest: ${after.videos.filter((v) => v.status === "passed").length} passing, ${after.videos.filter((v) => v.status === "failed").length} failed.`);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
