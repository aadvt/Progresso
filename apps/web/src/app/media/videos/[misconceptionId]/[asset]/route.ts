/**
 * Serves a passing explainer video's files. The URL names a misconception and
 * one of three fixed assets; the file path comes from the manifest, never from
 * the URL. Byte ranges are supported so the player can seek (Safari requires it).
 */
import { createReadStream, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { getVideos } from "@/server/data";

const ASSETS = {
  "video.mp4": { key: "video", type: "video/mp4" },
  "poster.jpg": { key: "poster", type: "image/jpeg" },
  "captions.vtt": { key: "captions", type: "text/vtt; charset=utf-8" },
} as const;

export async function GET(request: Request, { params }: { params: Promise<{ misconceptionId: string; asset: string }> }) {
  const { misconceptionId, asset } = await params;
  const spec = ASSETS[asset as keyof typeof ASSETS];
  const lib = getVideos();
  const video = lib.passing.get(misconceptionId);
  if (!spec || !video?.files) return new Response("Not found", { status: 404 });
  const path = join(lib.dir, video.files[spec.key]);
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const headers: Record<string, string> = {
    "Content-Type": spec.type,
    "Accept-Ranges": "bytes",
    // Content is regenerated offline only; a day of caching is safe and saves phone data.
    "Cache-Control": "public, max-age=86400",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "Content-Length": String(size) } });
}
