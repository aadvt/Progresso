/**
 * The Progresso MCP server: tools + MCP Apps UI resources.
 *
 * One `McpServer` per connection (stdio) or per request (stateless Streamable
 * HTTP), created for an authenticated `Principal`. Tools read and write the
 * same database as the web app through @progresso/service and @progresso/db.
 *
 * Every tool returns Markdown text (what the model reads, and all a host
 * without UI support shows) plus `structuredContent` for the widgets.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { db, demoStudent, isSample, studentIds } from "@progresso/service";
import { getPlanSettings } from "@progresso/db";
import { resolveStudent, StudentError, type Principal } from "./auth";
import { explainMistake } from "./explain";
import { answerText, explainText, missionText, progressText, resultText } from "./text";
import { finish, links, progress, submit, tonight, ToolError } from "./views";

export const SERVER_NAME = "progresso";
export const SERVER_VERSION = "0.1.0";
export const MISSION_UI = "ui://progresso/mission.html";
export const PROGRESS_UI = "ui://progresso/progress.html";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

/** The bundled widget HTML (pnpm --filter @progresso/mcp build:ui). Read per request so a rebuild needs no restart. */
export function widgetHtml(file: "mission.html" | "progress.html"): string {
  try {
    return readFileSync(join(DIST, file), "utf8");
  } catch {
    throw new Error(`Widget ${file} is not built. Run: pnpm --filter @progresso/mcp build:ui`);
  }
}

const known = (id: string) => demoStudent(id) !== undefined;

const INSTRUCTIONS = `Progresso turns a student's exam diagnosis report into a short daily comeback plan: find the root gap behind most mistakes, fix it in ~25-minute missions, prove it's fixed, keep it fixed until the exam.
- "What should I study tonight?" → get_tonight_mission (shows an interactive mission: the root gap, a Mistake Recap, explainer links and prove-it questions).
- Answers given in the widget are recorded automatically and reported to you; in text-only hosts, ask the questions and call submit_answer.
- After a wrong answer, explain_my_mistake (with the question_id) ties it back to the student's actual report.
- "How am I doing?" → get_progress.
Ground every explanation in what the tools return. Never present working as the student's own unless the tool says the report quotes it. Don't reveal prove-it answers before the student has answered. All data here is SAMPLE DATA (demo students).`;

function ok(text: string, structured?: object): CallToolResult {
  return { content: [{ type: "text", text }], ...(structured ? { structuredContent: structured as Record<string, unknown> } : {}) };
}

function fail(e: unknown): CallToolResult {
  if (e instanceof ToolError || e instanceof StudentError) return { content: [{ type: "text", text: e.message }], isError: true };
  console.error("[progresso-mcp] tool error:", e);
  return { content: [{ type: "text", text: "Something went wrong on the Progresso server. Try again." }], isError: true };
}

const guard =
  <A>(fn: (args: A) => CallToolResult) =>
  async (args: A): Promise<CallToolResult> => {
    try {
      return fn(args);
    } catch (e) {
      return fail(e);
    }
  };

export function createServer(principal: Principal): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  const bound = principal.studentId;
  // A connection bound to one student doesn't ask the model for a student at all; an unbound one requires it.
  // (Typed optional for both shapes; resolveStudent enforces the rule.)
  const studentField = (bound ? {} : { student: z.string().describe(`Student id (${studentIds().join(", ")}). See list_students.`) }) as unknown as { student: z.ZodOptional<z.ZodString> };
  const who = (args: { student?: string }) => resolveStudent(principal, args.student, known, studentIds);

  server.registerTool(
    "list_students",
    {
      title: "List demo students",
      description: "Lists the students this server can act for (pseudonymous ids, class, subjects, next exam). All are SAMPLE DATA demo students.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(() => {
      const ids = bound ? [bound] : studentIds();
      const rows = ids.map((id) => {
        const s = demoStudent(id)!;
        const plan = getPlanSettings(db(), id);
        return {
          id,
          sample: isSample(id),
          class: s.student.class,
          subjects: s.student.subjects,
          ...(s.student.next_exam ? { next_exam: s.student.next_exam } : {}),
          has_plan: !!plan,
        };
      });
      const text = rows.map((r) => `- \`${r.id}\`: Class ${r.class}, ${r.subjects.join(" + ")}${r.next_exam ? `; next exam ${r.next_exam.name} on ${r.next_exam.date}` : ""}${r.has_plan ? "; has a plan" : ""}${r.sample ? " (SAMPLE DATA)" : ""}`);
      return ok(`${bound ? "This connection is for:" : "Students:"}\n${text.join("\n")}`, { students: rows });
    }),
  );

  registerAppTool(
    server,
    "get_tonight_mission",
    {
      title: "Tonight's mission",
      description:
        "Answers \"what should I study tonight?\": tonight's ~25-minute mission from the student's comeback plan, with the root gap it fixes, a Mistake Recap from their report, explainer links and 3 prove-it questions (shown as an interactive widget). Starts the mission so its questions are fixed; sets up a default plan (next exam, 25 min/day) if there is none.",
      inputSchema: z.object({
        ...studentField,
        mission_id: z.string().optional().describe("Re-open a specific mission (from an earlier result) instead of tonight's next one."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: MISSION_UI } },
    },
    guard((args: { student?: string; mission_id?: string }) => {
      const d = tonight(who(args), args.mission_id);
      return ok(missionText(d), d);
    }),
  );

  server.registerTool(
    "submit_answer",
    {
      title: "Submit a prove-it answer",
      description:
        "Records the student's answer to one prove-it question: grades it, saves it, and when it is the last one finishes the mission (mastery gate + spaced-repetition update; the web app's constellation updates). Returns feedback, the misconception a wrong answer reveals, and the worked solution. Only call with the student's own answer.",
      inputSchema: z.object({
        ...studentField,
        mission_id: z.string().describe("From get_tonight_mission."),
        question_id: z.string().describe("From get_tonight_mission."),
        answer: z.string().min(1).describe("The option letter (A, B, C, D) or, for numeric questions, the number."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard((args: { student?: string; mission_id: string; question_id: string; answer: string }) => {
      const a = submit(who(args), args.mission_id, args.question_id, args.answer);
      return ok(answerText(a), a);
    }),
  );

  server.registerTool(
    "finish_mission",
    {
      title: "Finish a mission",
      description:
        "Finishes a mission. Normally automatic after the last prove-it answer; call it for a mission with no prove-it questions yet (recorded as studied, not proven).",
      inputSchema: z.object({ ...studentField, mission_id: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard((args: { student?: string; mission_id: string }) => {
      const id = who(args);
      const r = finish(id, args.mission_id);
      return ok(resultText(r), { view: "result", student_id: id, mission_id: args.mission_id, result: r, links: links(id, args.mission_id) });
    }),
  );

  registerAppTool(
    server,
    "get_progress",
    {
      title: "Progress",
      description:
        "How the student is doing: which root gaps are fixed (proven), the readiness estimate for the next exam (always a range), and a mini knowledge constellation.",
      inputSchema: z.object({ ...studentField }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: PROGRESS_UI } },
    },
    guard((args: { student?: string }) => {
      const p = progress(who(args));
      return ok(progressText(p), p);
    }),
  );

  server.registerTool(
    "explain_my_mistake",
    {
      title: "Explain my mistake",
      description:
        "Facts for a plain-language explanation of one of the student's mistakes, grounded in their actual report: the report's diagnosis and quoted working (verbatim), the root gap it traces back to, the verified fix and explainer. Pass `about` (a question like \"Q7\", an exam, or a topic like \"chain rule\") or `question_id` (a prove-it question they just answered).",
      inputSchema: z.object({
        ...studentField,
        about: z.string().optional().describe('A question ("Pre-Board 1 Q9"), exam or topic ("chain rule").'),
        question_id: z.string().optional().describe("A prove-it question id from a mission."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard((args: { student?: string; about?: string; question_id?: string }) => {
      if (!args.about && !args.question_id) throw new ToolError('Pass "about" (a question, exam or topic) or "question_id".');
      const e = explainMistake(who(args), args.about ?? "", args.question_id);
      return ok(explainText(e), e);
    }),
  );

  for (const [uri, file, title] of [
    [MISSION_UI, "mission.html", "Tonight's mission"],
    [PROGRESS_UI, "progress.html", "Progress"],
  ] as const) {
    registerAppResource(server, title, uri, { mimeType: RESOURCE_MIME_TYPE, description: `Progresso widget: ${title}` }, async () => ({
      contents: [
        {
          uri,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml(file),
          // Fully self-contained (inline JS/CSS, maths as MathML): no external domains to declare.
          _meta: { ui: { prefersBorder: false } },
        },
      ],
    }));
  }

  return server;
}
