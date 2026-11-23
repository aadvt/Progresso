import { rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A throwaway database: the tools write progress, and the real one belongs to the demo.
const DB_PATH = join(tmpdir(), `progresso-mcp-test-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = DB_PATH;
process.env.PROGRESSO_WEB_URL = "http://web.test";

const { buildWidgets } = await import("../scripts/build-ui");
const service = await import("@progresso/service");
const { getConceptMastery, resetPlan } = await import("@progresso/db");
const { createServer, MISSION_UI, PROGRESS_UI } = await import("../src/server");
const { DemoAuthenticator, resolveStudent } = await import("../src/auth");
const { startHttp } = await import("../src/http");
const { splitMath, mathHtml } = await import("../src/math");

import type { AnswerData, MissionWidgetData, ProgressData } from "../src/shared/types";
import type { Principal } from "../src/auth";
import type { ExplainData } from "../src/explain";

const STUDENT = "demo-riya";
const OTHER = "demo-kabir";

async function connect(principal: Principal): Promise<Client> {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(principal).connect(b);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(a);
  return client;
}

type Result = Awaited<ReturnType<Client["callTool"]>>;
const text = (r: Result) => (r.content as { type: string; text: string }[]).find((c) => c.type === "text")!.text;
const structured = <T>(r: Result) => r.structuredContent as unknown as T;

/** The right / a wrong option for a bank question, from the server-side answer key. */
function key(questionId: string): { right: string; wrong?: string } {
  const q = service.store().bank.byId.get(questionId)!;
  if (q.kind === "numeric") return { right: String(q.answer!.value), wrong: String(Number(q.answer!.value) + 1000) };
  const right = q.options!.find((o) => o.correct)!.id;
  const wrong = q.options!.find((o) => !o.correct && o.misconception_id)?.id ?? q.options!.find((o) => !o.correct)?.id;
  return { right, ...(wrong ? { wrong } : {}) };
}

let client: Client;

beforeAll(async () => {
  await buildWidgets(false);
  resetPlan(service.db(), STUDENT);
  client = await connect({ via: "open" });
});

afterAll(async () => {
  await client?.close();
  try {
    rmSync(DB_PATH, { force: true });
    rmSync(`${DB_PATH}-wal`, { force: true });
    rmSync(`${DB_PATH}-shm`, { force: true });
  } catch {
    // Windows may still hold the file; it's in the temp dir.
  }
});

describe("tools and UI resources", () => {
  it("lists the tools, with UI resources on the mission and progress tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["explain_my_mistake", "finish_mission", "get_progress", "get_tonight_mission", "list_students", "submit_answer"]);
    const ui = (name: string) => (tools.find((t) => t.name === name)!._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri;
    expect(ui("get_tonight_mission")).toBe(MISSION_UI);
    expect(ui("get_progress")).toBe(PROGRESS_UI);
    // Unbound connection: the student is a required argument.
    expect(tools.find((t) => t.name === "get_tonight_mission")!.inputSchema.required).toContain("student");
  });

  it("serves each widget as one self-contained HTML resource", async () => {
    for (const uri of [MISSION_UI, PROGRESS_UI]) {
      const { contents } = await client.readResource({ uri });
      const c = contents[0] as { mimeType: string; text: string };
      expect(c.mimeType).toBe("text/html;profile=mcp-app");
      expect(c.text).toMatch(/^<!doctype html>/);
      expect(c.text).toContain("<style>");
      // Nothing loaded from elsewhere: no external scripts, stylesheets or fonts.
      expect(c.text).not.toMatch(/<script[^>]+src=|<link[^>]+href=|@import|url\(https?:/);
      expect(Buffer.byteLength(c.text)).toBeLessThan(600 * 1024);
    }
  });

  it("asks for a student on an unbound connection, with a helpful error", async () => {
    const r = await client.callTool({ name: "get_progress", arguments: { student: "nobody" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("demo-riya");
  });

  it("lists students without display names", async () => {
    const r = await client.callTool({ name: "list_students", arguments: {} });
    expect(text(r)).toContain(STUDENT);
    for (const s of service.store().demo) expect(JSON.stringify(r)).not.toContain(s.student.display_name.replace(/\s*\(sample\)$/i, ""));
  });
});

describe("tonight's mission, answered in the widget, shows up in the web app", () => {
  let mission: MissionWidgetData;

  it("sets up a plan and starts tonight's mission, without leaking the answer key", async () => {
    const r = await client.callTool({ name: "get_tonight_mission", arguments: { student: STUDENT } });
    expect(r.isError).toBeFalsy();
    mission = structured<MissionWidgetData>(r);
    expect(mission.state).toBe("ready");
    expect(mission.plan_created).toBe(true);
    expect(mission.sample).toBe(true);
    expect(mission.root?.name).toBeTruthy();
    expect(mission.recap?.diagnosis).toBeTruthy();
    expect(mission.questions.length).toBeGreaterThanOrEqual(1);
    expect(mission.links.mission).toBe(`http://web.test/s/${STUDENT}/mission/${encodeURIComponent(mission.mission!.id)}`);
    // The recap quotes the report verbatim.
    const rec = service.studentContext(STUDENT)!.records.find((x) => x.id === mission.recap!.record_id)!;
    expect(mission.recap!.diagnosis).toBe(rec.diagnosis.text);
    // No answer key before answering, in the data or the text.
    const all = JSON.stringify(r);
    expect(all).not.toMatch(/"correct"|misconception_id|"solution"/);
    for (const q of mission.questions) expect(all).not.toContain(service.store().bank.byId.get(q.id)!.solution);
    // The text alone is enough to run the mission (hosts without UI).
    expect(text(r)).toContain(mission.mission!.id);
    for (const q of mission.questions) expect(text(r)).toContain(q.id);
    // Maths is rendered to MathML for the widget.
    expect(mission.questions.some((q) => q.stem.html.includes("<math"))).toBe(true);
  });

  it("is idempotent: asking again returns the same started mission", async () => {
    const again = structured<MissionWidgetData>(await client.callTool({ name: "get_tonight_mission", arguments: { student: STUDENT } }));
    expect(again.mission!.id).toBe(mission.mission!.id);
    expect(again.plan_created).toBeUndefined();
  });

  it("records each answer, and the last one finishes the mission and writes mastery the constellation reads", async () => {
    const before = service.constellation(STUDENT)!;
    let last: AnswerData | undefined;
    for (const q of mission.questions) {
      const r = await client.callTool({ name: "submit_answer", arguments: { student: STUDENT, mission_id: mission.mission!.id, question_id: q.id, answer: key(q.id).right } });
      expect(r.isError).toBeFalsy();
      last = structured<AnswerData>(r);
      expect(last.feedback.correct).toBe(true);
      expect(last.feedback.solution.text).toBeTruthy();
    }
    expect(last!.result).toBeDefined();
    expect(last!.result!.passed).toBe(true);
    // Same database as the web app: mastery written, and the constellation (what the web map renders) changed.
    const conceptId = service.studentContext(STUDENT)!.analysis.roots.find((x) => x.concept.name === mission.root!.name)!.concept.id;
    expect(getConceptMastery(service.db(), STUDENT).find((m) => m.concept_id === conceptId)?.state).toMatch(/proven|retained/);
    const after = service.constellation(STUDENT)!;
    expect(after.state_key).not.toBe(before.state_key);
    if (mission.mission!.kind === "learn") {
      expect(last!.result!.ripple_root).toBe(mission.root!.name);
      expect(after.roots.find((x) => x.id === conceptId)!.mastered).toBe(true);
    }
  });

  it("rejects a second answer to a finished mission", async () => {
    const q = mission.questions[0]!;
    const r = await client.callTool({ name: "submit_answer", arguments: { student: STUDENT, mission_id: mission.mission!.id, question_id: q.id, answer: key(q.id).right } });
    expect(r.isError).toBe(true);
  });

  it("shows progress: roots fixed, readiness as a range, a mini constellation", async () => {
    const p = structured<ProgressData>(await client.callTool({ name: "get_progress", arguments: { student: STUDENT } }));
    expect(p.has_plan).toBe(true);
    expect(p.roots_fixed).toBeGreaterThanOrEqual(1);
    const { low, mid, high } = p.readiness.now;
    expect(low).toBeLessThanOrEqual(mid);
    expect(mid).toBeLessThanOrEqual(high);
    expect(p.sky.nodes.length).toBe(service.constellation(STUDENT)!.nodes.length);
    expect(Object.keys(p.sky.roots).length).toBe(p.roots.length);
  });
});

describe("a wrong answer, explained from the report", () => {
  let mission: MissionWidgetData;
  let wrongQ: string;

  beforeAll(async () => {
    resetPlan(service.db(), STUDENT);
    mission = structured<MissionWidgetData>(await client.callTool({ name: "get_tonight_mission", arguments: { student: STUDENT } }));
    wrongQ = mission.questions.find((q) => key(q.id).wrong)!.id;
  });

  it("returns the misconception the wrong answer shows, tied to the report", async () => {
    const r = await client.callTool({ name: "submit_answer", arguments: { student: STUDENT, mission_id: mission.mission!.id, question_id: wrongQ, answer: key(wrongQ).wrong! } });
    const a = structured<AnswerData>(r);
    expect(a.feedback.correct).toBe(false);
    expect(a.result).toBeUndefined();
    expect(text(r)).toContain("explain_my_mistake");
    if (a.feedback.misconception) expect(text(r)).toContain(a.feedback.misconception.description);
  });

  it("explains it from the question id: the answer, the report's own words, the verified fix", async () => {
    const r = await client.callTool({ name: "explain_my_mistake", arguments: { student: STUDENT, question_id: wrongQ } });
    const e = structured<ExplainData>(r);
    expect(e.matched_by).toBe("question");
    expect(e.check_answer?.correct).toBe(false);
    expect(e.mistakes.length).toBeGreaterThan(0);
    const records = service.studentContext(STUDENT)!.records;
    for (const m of e.mistakes) expect(m.report_diagnosis).toBe(records.find((x) => x.id === m.record_id)!.diagnosis.text);
    expect(text(r)).toContain("verbatim");
  });

  it("finds mistakes by topic or question, and lists them when nothing matches", async () => {
    const ctx = service.studentContext(STUDENT)!;
    const root = ctx.analysis.roots[0]!;
    const byTopic = structured<ExplainData>(await client.callTool({ name: "explain_my_mistake", arguments: { student: STUDENT, about: root.concept.name } }));
    expect(byTopic.matched_by).toBe("search");
    expect(byTopic.mistakes.length).toBeGreaterThan(0);

    const rec = ctx.records[0]!;
    const byRef = structured<ExplainData>(await client.callTool({ name: "explain_my_mistake", arguments: { student: STUDENT, about: `${rec.exam.name} ${rec.question.ref}` } }));
    expect(byRef.mistakes[0]!.record_id).toBe(rec.id);
    // Working is only ever the student's own when the report quotes it.
    for (const m of byRef.mistakes) expect(m.student_working).toBe(ctx.records.find((x) => x.id === m.record_id)!.student_working?.text);

    const none = structured<ExplainData>(await client.callTool({ name: "explain_my_mistake", arguments: { student: STUDENT, about: "zzzz qqqq" } }));
    expect(none.matched_by).toBe("none");
    expect(none.available!.length).toBe(ctx.records.length);
  });
});

describe("auth", () => {
  const known = (id: string) => service.demoStudent(id) !== undefined;

  it("binds a connection to one student: no student argument, and no acting for anyone else", async () => {
    const bound = await connect({ via: "open", studentId: STUDENT });
    const { tools } = await bound.listTools();
    expect(tools.every((t) => !("student" in ((t.inputSchema.properties as object) ?? {})))).toBe(true);
    const ok = await bound.callTool({ name: "get_progress", arguments: {} });
    expect(structured<ProgressData>(ok).student_id).toBe(STUDENT);
    expect(() => resolveStudent({ via: "open", studentId: STUDENT }, OTHER, known, service.studentIds)).toThrow(/only/);
    await bound.close();
  });

  it("checks the access token and the student at the HTTP boundary", () => {
    const auth = new DemoAuthenticator({ accessToken: "s3cret", knownStudent: known });
    expect(auth.authenticate({ headers: {}, query: {} })).toMatchObject({ ok: false, status: 401 });
    expect(auth.authenticate({ headers: { authorization: "Bearer nope" }, query: {} })).toMatchObject({ ok: false, status: 401 });
    expect(auth.authenticate({ headers: { authorization: "Bearer s3cret" }, query: {} })).toMatchObject({ ok: true, principal: { via: "access_token" } });
    expect(auth.authenticate({ headers: {}, query: { token: "s3cret", student: STUDENT } })).toMatchObject({ ok: true, principal: { studentId: STUDENT } });
    expect(auth.authenticate({ headers: {}, query: { token: "s3cret", student: "ghost" } })).toMatchObject({ ok: false, status: 403 });
  });
});

describe("Streamable HTTP transport", () => {
  it("serves tools over HTTP, with the token and student binding in the URL", async () => {
    const server = await startHttp({
      port: 0,
      listen: "127.0.0.1",
      tokenRequired: true,
      allowedHosts: [],
      authenticator: new DemoAuthenticator({ accessToken: "t0ken", knownStudent: (id) => service.demoStudent(id) !== undefined }),
    });
    const port = (server.address() as AddressInfo).port;
    try {
      const denied = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
      expect(denied.status).toBe(401);

      const http = new Client({ name: "http-test", version: "1" });
      await http.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp?token=t0ken&student=${STUDENT}`)));
      const r = await http.callTool({ name: "get_progress", arguments: {} });
      expect(structured<ProgressData>(r).student_id).toBe(STUDENT);
      await http.close();
    } finally {
      await new Promise((res) => server.close(res));
    }
  });
});

describe("maths for the widget", () => {
  it("splits $…$ and renders MathML, escaping plain text", () => {
    expect(splitMath("a $x^2$ b")).toEqual([
      { text: "a ", math: false },
      { text: "x^2", math: true },
      { text: " b", math: false },
    ]);
    const html = mathHtml("<b> $\\frac{1}{2}$");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("<math");
    expect(html).not.toContain("katex-html");
    // Native MathML gets the thin space before operator names that KaTeX's CSS would add ("6x tan", not "6xtan").
    expect(mathHtml("$6x \\tan(3x^2)$")).toMatch(/<mspace width="0.1667em"><\/mspace><mi>tan<\/mi>/);
  });
});
