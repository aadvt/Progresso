/**
 * Streamable HTTP transport (stateless: a fresh server + transport per
 * request), for Claude on the web through a tunnel and for the ext-apps
 * basic-host. Auth happens here, at the HTTP boundary, before any MCP message
 * is handled (as the MCP auth spec requires for a real OAuth setup too).
 */
import type { Server } from "node:http";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import cors from "cors";
import type { Request, Response } from "express";
import type { Authenticator } from "./auth";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server";

export interface HttpOptions {
  port: number;
  /** Interface to listen on. Default 127.0.0.1: a tunnel (cloudflared, ngrok) connects locally. */
  listen: string;
  authenticator: Authenticator;
  /**
   * With an access token required, the token protects the server, so any Host
   * header is accepted (tunnel hostnames change on every restart). Without one,
   * only localhost and `allowedHosts` are (DNS-rebinding protection).
   */
  tokenRequired: boolean;
  allowedHosts: string[];
}

export function startHttp(opts: HttpOptions): Promise<Server> {
  const app = opts.tokenRequired
    ? createMcpExpressApp({ host: "0.0.0.0", jsonLimit: "256kb" })
    : createMcpExpressApp({ host: opts.listen, allowedHosts: ["localhost", "127.0.0.1", "[::1]", ...opts.allowedHosts], jsonLimit: "256kb" });
  // Browser hosts (the ext-apps basic-host) call from another origin.
  app.use(cors({ exposedHeaders: ["mcp-session-id", "www-authenticate"] }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, name: SERVER_NAME, version: SERVER_VERSION });
  });

  app.all("/mcp", async (req: Request, res: Response) => {
    const auth = opts.authenticator.authenticate({ headers: req.headers, query: req.query as Record<string, unknown> });
    if (!auth.ok) {
      if (auth.wwwAuthenticate) res.setHeader("WWW-Authenticate", auth.wwwAuthenticate);
      res.status(auth.status).json({ jsonrpc: "2.0", error: { code: -32001, message: auth.message }, id: null });
      return;
    }
    const server = createServer(auth.principal);
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[progresso-mcp] request failed:", error);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  });

  return new Promise((resolve, reject) => {
    const http = app.listen(opts.port, opts.listen, (err?: Error) => (err ? reject(err) : resolve(http)));
  });
}
