/**
 * Loading the explainer-video manifest (server-side). Only passing videos
 * whose files exist and whose misconception is in the current graph are
 * served; everything else falls back to the step explainer.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConceptGraph } from "../graph/graph";
import { isServable, VideoManifestSchema, type VideoEntry, type VideoManifest } from "./schema";

export interface VideoLibrary {
  dir: string;
  /** Passing, playable videos by misconception id. */
  passing: Map<string, VideoEntry>;
  /** Every manifest entry (passed and failed), for reports. */
  all: VideoEntry[];
  warnings: string[];
}

export const VIDEO_MANIFEST = "manifest.json";

export function readVideoManifest(dir: string): VideoManifest {
  const path = join(dir, VIDEO_MANIFEST);
  if (!existsSync(path)) return { schema_version: "1.0", videos: [] };
  return VideoManifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function loadVideoLibrary(dir: string, graph?: ConceptGraph): VideoLibrary {
  const warnings: string[] = [];
  let manifest: VideoManifest;
  try {
    manifest = readVideoManifest(dir);
  } catch (e) {
    return { dir, passing: new Map(), all: [], warnings: [`${join(dir, VIDEO_MANIFEST)}: ${(e as Error).message.slice(0, 500)}`] };
  }
  const passing = new Map<string, VideoEntry>();
  for (const v of manifest.videos) {
    if (!isServable(v) || !v.files) continue;
    if (graph && !graph.misconceptions.has(v.misconception_id)) {
      warnings.push(`${v.misconception_id}: not in the current graph; video skipped`);
      continue;
    }
    const missing = Object.values(v.files).filter((f) => !existsSync(join(dir, f)));
    if (missing.length) {
      warnings.push(`${v.misconception_id}: missing ${missing.join(", ")}; video skipped`);
      continue;
    }
    passing.set(v.misconception_id, v);
  }
  return { dir, passing, all: manifest.videos, warnings };
}

/** WebVTT for the caption cues (the same text that is burned into the video). */
export function captionsToVtt(cues: { start: number; end: number; text: string }[]): string {
  const ts = (s: number) => {
    const ms = Math.round(s * 1000);
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const sec = Math.floor((ms % 60_000) / 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
  };
  return ["WEBVTT", "", ...cues.flatMap((c, i) => [String(i + 1), `${ts(c.start)} --> ${ts(Math.max(c.end, c.start + 0.5))}`, c.text, ""])].join("\n");
}
