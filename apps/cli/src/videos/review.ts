/**
 * Record a person's frame review of an explainer video.
 *
 *   pnpm videos:review <misconception_id> --approve "what was checked"
 *   pnpm videos:review <misconception_id> --reject "what is wrong"
 *   pnpm videos:review --list
 *
 * A rejected video is never served (the step explainer covers it) and
 * `videos:generate --missing` makes it again.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot, isServable, loadAppConfig, readVideoManifest, VIDEO_MANIFEST, VideoManifestSchema } from "@progresso/core";

const args = process.argv.slice(2);
const config = loadAppConfig(findRepoRoot());
const manifest = readVideoManifest(config.videosDir);

if (args.includes("--list") || args.length === 0) {
  for (const v of manifest.videos)
    console.log(`${v.misconception_id.padEnd(40)} ${v.status.padEnd(7)} ${(v.review?.verdict ?? "unreviewed").padEnd(10)} ${isServable(v) ? "served" : "not served"}${v.review ? `  ${v.review.notes}` : ""}`);
} else {
  const [id] = args;
  const i = args.findIndex((a) => a === "--approve" || a === "--reject");
  const notes = i >= 0 ? args[i + 1] : undefined;
  const entry = manifest.videos.find((v) => v.misconception_id === id);
  if (!entry) throw new Error(`No video for ${id} in the manifest`);
  if (i < 0 || !notes) throw new Error('Pass --approve "notes" or --reject "notes"');
  if (entry.status !== "passed") throw new Error(`${id} did not pass the automatic checks; nothing to review`);
  entry.review = { verdict: args[i] === "--approve" ? "approved" : "rejected", notes, at: new Date().toISOString() };
  writeFileSync(join(config.videosDir, VIDEO_MANIFEST), JSON.stringify(VideoManifestSchema.parse(manifest), null, 2) + "\n");
  console.log(`${id}: ${entry.review.verdict} (${isServable(entry) ? "served" : "not served"})`);
}
