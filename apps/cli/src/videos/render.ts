/**
 * Local tools for the video pipeline: lint generated code, render it with
 * Manim, probe and re-encode with ffmpeg, extract frames. Nothing here calls
 * an LLM.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, delimiter, join } from "node:path";

export interface ToolPaths {
  manim: string;
  ffmpeg: string;
  ffprobe: string;
  python: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Resolve the tools. MiKTeX's default per-user bin dir is added to PATH when
 * it isn't there yet (a fresh install only reaches new shells).
 */
export function resolveTools(repoRoot: string): ToolPaths {
  const path = process.env.PATH ?? process.env.Path ?? "";
  const extra: string[] = [];
  const texBin = process.env.TEX_BIN_DIR ?? (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "MiKTeX", "miktex", "bin", "x64") : undefined);
  if (texBin && existsSync(texBin) && !path.toLowerCase().includes(texBin.toLowerCase())) extra.push(texBin);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: [...extra, path].join(delimiter),
    PYTHONPATH: [join(repoRoot, "tools", "manim"), process.env.PYTHONPATH].filter(Boolean).join(delimiter),
    PYTHONIOENCODING: "utf-8",
  };
  delete env.Path;
  return {
    manim: process.env.MANIM_BIN ?? "manim",
    ffmpeg: process.env.FFMPEG_BIN ?? "ffmpeg",
    ffprobe: process.env.FFPROBE_BIN ?? "ffprobe",
    python: process.env.PYTHON_BIN ?? "python",
    env,
  };
}

/** Fail fast with a clear message when a tool is missing. */
export function checkTools(t: ToolPaths): string[] {
  const probes: [string, string, string[]][] = [
    ["manim", t.manim, ["--version"]],
    ["ffmpeg", t.ffmpeg, ["-version"]],
    ["ffprobe", t.ffprobe, ["-version"]],
    ["latex", "latex", ["--version"]],
    ["dvisvgm", "dvisvgm", ["--version"]],
    ["python", t.python, ["--version"]],
  ];
  const out: string[] = [];
  for (const [name, bin, args] of probes) {
    const r = spawnSync(bin, args, { env: t.env, encoding: "utf8", timeout: 60_000 });
    if (r.status !== 0) out.push(`${name} (${bin}) not working: ${(r.error?.message ?? r.stderr ?? "").slice(0, 200)}`);
  }
  return out;
}

export function lintCode(t: ToolPaths, repoRoot: string, code: string): string[] {
  const r = spawnSync(t.python, ["-I", join(repoRoot, "tools", "manim", "lint.py")], { input: code, encoding: "utf8", env: t.env });
  if (r.status !== 0) throw new Error(`lint helper failed: ${r.stderr}`);
  return (JSON.parse(r.stdout) as { ok: boolean; errors: string[] }).errors;
}

export interface AuditIssue {
  kind: string;
  at: number;
  texts: string[];
  detail: string;
  count: number;
}
export interface Audit {
  duration: number;
  captions: { start: number; end: number; text: string }[];
  /** Still moments (waits), where frames are sampled. */
  holds?: { start: number; end: number }[];
  issues: AuditIssue[];
}

export interface RenderResult {
  ok: boolean;
  video?: string;
  audit?: Audit;
  /** Tail of the log on failure. */
  error?: string;
  seconds: number;
}

/** Render ExplainerScene from `file` at 720p30 into `workDir`. Hard timeout; output is captured, never shown live. */
export function renderScene(t: ToolPaths, file: string, workDir: string, timeoutMs = 20 * 60_000): Promise<RenderResult> {
  const auditPath = join(workDir, "audit.json");
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      t.manim,
      ["render", "-qm", "--progress_bar", "none", "--media_dir", join(workDir, "media"), "-o", "scene", file, "ExplainerScene"],
      { cwd: workDir, env: { ...t.env, PROGRESSO_AUDIT: auditPath } },
    );
    let log = "";
    const keep = (b: Buffer) => {
      log = (log + b.toString("utf8")).slice(-40_000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => {
      child.kill();
      log += `\nRender timed out after ${Math.round(timeoutMs / 1000)} s (too many animations or a very long loop).`;
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      const seconds = (Date.now() - started) / 1000;
      // Manim writes to media/videos/<module name>/720p30/<-o name>.mp4.
      const video = join(workDir, "media", "videos", basename(file).replace(/\.py$/, ""), "720p30", "scene.mp4");
      if (code === 0 && existsSync(video)) {
        const audit = existsSync(auditPath) ? (JSON.parse(readFileSync(auditPath, "utf8")) as Audit) : undefined;
        resolve({ ok: true, video, audit, seconds });
      } else {
        resolve({ ok: false, error: condenseLog(log), seconds });
      }
    });
  });
}

/** Keep the part of a Manim log that explains the failure: the traceback, minus box-drawing noise. */
export function condenseLog(log: string): string {
  // Strip ANSI codes and rich's box characters, collapse whitespace runs.
  const clean = log
    .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "")
    .replace(/[│╭╮╰╯─┃━]/g, " ")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  // Frames in the generated file (with their code excerpt), then the final error lines.
  const ours: string[] = [];
  clean.forEach((l, i) => {
    if (/explainer\.py/.test(l)) ours.push("...", ...clean.slice(i, i + 9));
  });
  const lastFrame = clean.findLastIndex((l) => /\.py:\d+ in /.test(l));
  const tail = clean.slice(lastFrame >= 0 ? lastFrame + 1 : -12).filter((l) => !/^\d+\s|^>\s*\d+/.test(l)).slice(-10);
  // LaTeX errors: keep the "! ..." lines, they say what was wrong.
  const tex = clean.filter((l) => l.startsWith("! ") || /LaTeX compilation error|context of error/i.test(l));
  const out = [...tex.slice(0, 6), ...(ours.length ? ["Traceback (frames in your code):", ...ours.slice(-40)] : clean.slice(-30)), "Error:", ...tail];
  return out.join("\n").slice(-6000);
}

export function probeDuration(t: ToolPaths, video: string): { duration: number; width: number; height: number } {
  const r = spawnSync(t.ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", video], { env: t.env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  const j = JSON.parse(r.stdout) as { streams: { width: number; height: number }[]; format: { duration: string } };
  return { duration: Number(j.format.duration), width: j.streams[0]!.width, height: j.streams[0]!.height };
}

/** One JPEG frame at `time` seconds. */
export function extractFrame(t: ToolPaths, video: string, time: number, out: string, width?: number): void {
  const r = spawnSync(
    t.ffmpeg,
    ["-y", "-v", "error", "-ss", time.toFixed(2), "-i", video, "-frames:v", "1", ...(width ? ["-vf", `scale=${width}:-2`] : []), "-q:v", "3", out],
    { env: t.env, encoding: "utf8" },
  );
  if (r.status !== 0 || !existsSync(out)) throw new Error(`ffmpeg frame extraction failed at ${time}s: ${r.stderr}`);
}

/** Web-ready H.264: yuv420p, faststart (plays before fully downloaded), small. Optional audio track muxed in. */
export function encodeForWeb(t: ToolPaths, input: string, out: string, audio?: string): void {
  const r = spawnSync(
    t.ffmpeg,
    [
      "-y", "-v", "error", "-i", input,
      ...(audio ? ["-i", audio, "-c:a", "aac", "-b:a", "96k", "-shortest"] : ["-an"]),
      "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      out,
    ],
    { env: t.env, encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`ffmpeg encode failed: ${r.stderr}`);
}
