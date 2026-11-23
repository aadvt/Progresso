/**
 * Progresso MCP server entry point.
 *
 *   pnpm mcp            Streamable HTTP on http://127.0.0.1:3101/mcp
 *   pnpm mcp:stdio      stdio, for local desktop clients
 *
 * Environment (also read from the repo's .env):
 *   PORT / MCP_PORT        HTTP port (default 3101)
 *   MCP_LISTEN             interface (default 127.0.0.1)
 *   PROGRESSO_MCP_TOKEN    optional shared access token (?token=… or Authorization: Bearer …)
 *   MCP_ALLOWED_HOSTS      extra Host headers to accept when no token is set (comma-separated)
 *   PROGRESSO_STUDENT      stdio only: bind the connection to one demo student
 *   PROGRESSO_WEB_URL      where the web app runs, for links (default http://localhost:3100)
 */
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { loadDotEnv } from "@progresso/core";
import { db, demoStudent, store } from "@progresso/service";
import { DemoAuthenticator, type Principal } from "./auth";
import { startHttp } from "./http";
import { buildWidgets } from "../scripts/build-ui";
import { createServer, widgetHtml } from "./server";

async function main(): Promise<void> {
  loadDotEnv();
  // Bundle the widgets (about a second), load files and open the database up front:
  // fail fast, answer the first call quickly. Logs go to stderr; stdout is the stdio transport.
  await buildWidgets(false);
  store();
  db();
  widgetHtml("mission.html");
  widgetHtml("progress.html");

  if (process.argv.includes("--stdio")) {
    const student = process.env.PROGRESSO_STUDENT;
    if (student && !demoStudent(student)) throw new Error(`PROGRESSO_STUDENT: unknown student "${student}"`);
    const principal: Principal = { ...(student ? { studentId: student } : {}), via: "stdio" };
    await createServer(principal).connect(new StdioServerTransport());
    console.error(`[progresso-mcp] stdio ready${student ? ` (student ${student})` : ""}`);
    return;
  }

  const port = Number(process.env.MCP_PORT ?? process.env.PORT ?? 3101);
  const listen = process.env.MCP_LISTEN ?? "127.0.0.1";
  const token = process.env.PROGRESSO_MCP_TOKEN || undefined;
  const allowedHosts = (process.env.MCP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  await startHttp({
    port,
    listen,
    tokenRequired: !!token,
    allowedHosts,
    authenticator: new DemoAuthenticator({ ...(token ? { accessToken: token } : {}), knownStudent: (id) => demoStudent(id) !== undefined }),
  });
  console.error(`[progresso-mcp] listening on http://${listen}:${port}/mcp${token ? " (access token required)" : " (no access token: localhost only)"}`);
}

main().catch((e) => {
  console.error("[progresso-mcp]", e instanceof Error ? e.message : e);
  process.exit(1);
});
