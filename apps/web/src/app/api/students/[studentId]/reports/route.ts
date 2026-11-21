/**
 * POST /api/students/:id/reports  { text?, file_name? }
 *
 * Runs the report parser and then the root-cause engine, streaming progress as
 * NDJSON (one ReportStreamEvent per line) so the UI shows real stages, not a
 * timer. The demo parser ignores the text and returns SAMPLE DATA, and says so.
 */
import { analyseStudent, ReportParseError } from "@progresso/core";
import { getGraph, getReportParser, getStudent } from "@/server/data";
import type { ReportStreamEvent } from "@/lib/types";
import { plural } from "@/lib/format";

export const dynamic = "force-dynamic";

const MAX_TEXT = 200_000;

export async function POST(req: Request, ctx: { params: Promise<{ studentId: string }> }): Promise<Response> {
  const { studentId } = await ctx.params;
  if (!getStudent(studentId)) return Response.json({ error: "Unknown student" }, { status: 404 });

  let body: { text?: unknown; file_name?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text : undefined;
  const fileName = typeof body.file_name === "string" ? body.file_name.slice(0, 200) : undefined;
  if (text && text.length > MAX_TEXT) return Response.json({ error: "That report is too long." }, { status: 413 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ReportStreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      try {
        const parser = getReportParser();
        const parsed = await parser.parse(
          { student_id: studentId, ...(text ? { text } : {}), ...(fileName ? { file_name: fileName } : {}) },
          { graph: getGraph(), onProgress: (p) => send({ type: "progress", stage: p.stage, message: p.message }), signal: req.signal },
        );
        const analysis = analyseStudent({ graph: getGraph(), records: parsed.records });
        const n = analysis.roots.length;
        send({
          type: "progress",
          stage: "tracing",
          message: n > 0 ? `Traced your mistakes to ${plural(n, "root gap")}` : "No shared root gap: looking at habits instead",
        });
        send({ type: "done", notices: parsed.notices, summary: analysis.headline });
      } catch (e) {
        if (req.signal.aborted) return controller.close();
        send({ type: "error", message: e instanceof ReportParseError ? e.userMessage : "Something went wrong reading this report." });
        if (!(e instanceof ReportParseError)) console.error(e);
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
