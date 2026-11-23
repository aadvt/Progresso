import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  captionsToVtt,
  loadAppConfig,
  loadConceptGraph,
  loadVideoLibrary,
  rankMisconceptions,
  StoryboardSchema,
  VideoEntrySchema,
  type Storyboard,
  type VideoEntry,
} from "../src";
import { loadDemoFixtures } from "../src/demo-fixtures";

const config = loadAppConfig();
const { graph } = loadConceptGraph(config.conceptGraphDir);
const demo = loadDemoFixtures(config.fixturesDir);

const scene = (seconds: number) => ({ caption: "c", visual: "v", math: ["x^2"], seconds });
const storyboard: Storyboard = { title: "t", idea: "i", scenes: [scene(15), scene(15), scene(15), scene(15), scene(15)] };

function entry(over: Partial<VideoEntry> = {}): VideoEntry {
  return {
    misconception_id: "math.chain_rule.m1",
    concept_id: "math.chain_rule",
    subject: "Mathematics",
    status: "passed",
    title: "t",
    storyboard,
    files: { video: "mathematics/a.mp4", poster: "mathematics/a.jpg", captions: "mathematics/a.vtt", code: "mathematics/a.py" },
    duration_s: 75,
    width: 1280,
    height: 720,
    captions: [{ start: 0, end: 5, text: "c" }],
    narration: "none",
    attempts: [{ n: 1, stage: "render", problems: ["boom"] }, { n: 2, stage: "passed", problems: [] }],
    fix_iterations: 1,
    frame_check: { model: "m", frames: 10, summary: "ok" },
    generator: { provider: "p", model: "m" },
    prompt_version: "v",
    generated_at: "x",
    ...over,
  };
}

describe("storyboard", () => {
  it("must add up to 60-120 seconds", () => {
    expect(StoryboardSchema.safeParse(storyboard).success).toBe(true);
    expect(StoryboardSchema.safeParse({ ...storyboard, scenes: storyboard.scenes.slice(0, 4).map(() => scene(10)) }).success).toBe(false);
    expect(StoryboardSchema.safeParse({ ...storyboard, scenes: Array.from({ length: 6 }, () => scene(25)) }).success).toBe(false);
  });
  it("keeps captions short enough for the caption band", () => {
    const long = { ...storyboard, scenes: [{ ...scene(15), caption: "x".repeat(121) }, ...storyboard.scenes.slice(1)] };
    expect(StoryboardSchema.safeParse(long).success).toBe(false);
  });
});

describe("video manifest entries", () => {
  it("a passing entry needs its files, captions and frame check, and a passing last attempt", () => {
    expect(VideoEntrySchema.safeParse(entry()).success).toBe(true);
    expect(VideoEntrySchema.safeParse(entry({ files: undefined })).success).toBe(false);
    expect(VideoEntrySchema.safeParse(entry({ frame_check: undefined })).success).toBe(false);
    expect(VideoEntrySchema.safeParse(entry({ attempts: [{ n: 1, stage: "frame_check", problems: ["overlap"] }] })).success).toBe(false);
  });
  it("a failed entry needs no files", () => {
    const failed = entry({ status: "failed", files: undefined, frame_check: undefined, captions: undefined, duration_s: undefined, attempts: [{ n: 1, stage: "render", problems: ["x"] }], fix_iterations: 0 });
    expect(VideoEntrySchema.safeParse(failed).success).toBe(true);
  });
  it("rejects file paths that could leave the videos dir", () => {
    expect(VideoEntrySchema.safeParse(entry({ files: { ...entry().files!, video: "../secret.mp4" } })).success).toBe(false);
    expect(VideoEntrySchema.safeParse(entry({ files: { ...entry().files!, video: "/etc/x.mp4" } })).success).toBe(false);
  });
});

describe("loadVideoLibrary", () => {
  function dirWith(videos: VideoEntry[], files: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), "videos-"));
    mkdirSync(join(dir, "mathematics"));
    for (const f of files) writeFileSync(join(dir, f), "x");
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ schema_version: "1.0", videos }));
    return dir;
  }
  const allFiles = Object.values(entry().files!);

  it("serves only passing videos whose files exist", () => {
    const failed = entry({ misconception_id: "math.algebraic_identities.m1", concept_id: "math.algebraic_identities", status: "failed", files: undefined, frame_check: undefined, attempts: [{ n: 1, stage: "render", problems: ["x"] }] });
    const lib = loadVideoLibrary(dirWith([entry(), failed], allFiles), graph);
    expect([...lib.passing.keys()]).toEqual(["math.chain_rule.m1"]);
    expect(lib.all).toHaveLength(2);
  });
  it("skips a passing entry with a missing file, and one not in the graph", () => {
    expect(loadVideoLibrary(dirWith([entry()], allFiles.slice(1)), graph).passing.size).toBe(0);
    const lib = loadVideoLibrary(dirWith([entry({ misconception_id: "math.not_a_thing.m1" })], allFiles), graph);
    expect(lib.passing.size).toBe(0);
    expect(lib.warnings.join(" ")).toMatch(/not in the current graph/);
  });
  it("copes with no manifest and with a broken one", () => {
    expect(loadVideoLibrary(mkdtempSync(join(tmpdir(), "videos-")), graph).passing.size).toBe(0);
    const dir = mkdtempSync(join(tmpdir(), "videos-"));
    writeFileSync(join(dir, "manifest.json"), "{}");
    const lib = loadVideoLibrary(dir, graph);
    expect(lib.passing.size).toBe(0);
    expect(lib.warnings).toHaveLength(1);
  });
});

describe("rankMisconceptions", () => {
  it("ranks by students, then records, and only counts misconceptions in the graph", () => {
    const ranked = rankMisconceptions(graph, demo.map((s) => ({ id: s.student.id, records: s.records })));
    expect(ranked.length).toBeGreaterThan(5);
    for (let i = 1; i < ranked.length; i++) {
      const a = ranked[i - 1]!;
      const b = ranked[i]!;
      expect(a.students > b.students || (a.students === b.students && a.records >= b.records)).toBe(true);
    }
    expect(ranked.every((r) => graph.misconceptions.has(r.misconception_id))).toBe(true);
  });
  it("counts a misconception shared by two students above one repeated by one student", () => {
    const [s] = demo;
    const rec = s!.records.find((r) => r.misconception)!;
    const other = demo[1]!.records.find((r) => r.misconception && r.misconception.misconception_id !== rec.misconception!.misconception_id)!;
    const ranked = rankMisconceptions(graph, [
      { id: "a", records: [rec] },
      { id: "b", records: [rec] },
      { id: "c", records: [other, other, other] },
    ]);
    expect(ranked[0]!.misconception_id).toBe(rec.misconception!.misconception_id);
    expect(ranked[0]!.students).toBe(2);
  });
});

describe("captionsToVtt", () => {
  it("writes WebVTT cues with millisecond timestamps", () => {
    const vtt = captionsToVtt([
      { start: 0, end: 4.5, text: "First" },
      { start: 64.25, end: 64.25, text: "Second" },
    ]);
    expect(vtt).toBe("WEBVTT\n\n1\n00:00:00.000 --> 00:00:04.500\nFirst\n\n2\n00:01:04.250 --> 00:01:04.750\nSecond\n");
  });
});

describe("human review", () => {
  it("a rejected video is never served; an approved one is", () => {
    const dir = mkdtempSync(join(tmpdir(), "videos-"));
    mkdirSync(join(dir, "mathematics"));
    for (const f of Object.values(entry().files!)) writeFileSync(join(dir, f), "x");
    const write = (v: VideoEntry) => writeFileSync(join(dir, "manifest.json"), JSON.stringify({ schema_version: "1.0", videos: [v] }));
    write(entry({ review: { verdict: "rejected", notes: "a correct line is crossed out", at: "x" } }));
    expect(loadVideoLibrary(dir, graph).passing.size).toBe(0);
    write(entry({ review: { verdict: "approved", notes: "frames checked", at: "x" } }));
    expect(loadVideoLibrary(dir, graph).passing.size).toBe(1);
  });
});
