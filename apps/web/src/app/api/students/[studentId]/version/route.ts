/**
 * GET /api/students/:id/version → { version }
 *
 * A short fingerprint of the student's progress (mastery, answers, missions,
 * plan). Open pages poll it and refresh only when it changes, so an answer
 * given in Claude (the MCP server writes the same database) shows up here.
 */
import { getProgressVersion } from "@/server/data";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ studentId: string }> }): Promise<Response> {
  const { studentId } = await ctx.params;
  const version = getProgressVersion(studentId);
  if (!version) return Response.json({ error: "Unknown student" }, { status: 404 });
  return Response.json({ version }, { headers: { "cache-control": "no-store" } });
}
