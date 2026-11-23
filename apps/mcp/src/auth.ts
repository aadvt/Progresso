/**
 * Prototype auth: who is calling, and which student they may act for.
 *
 * Scope rule 2: no OAuth, no logins. A connection can be bound to one demo
 * student (`?student=<id>`, the `X-Progresso-Student` header, or
 * PROGRESSO_STUDENT for stdio); unbound connections pass `student` to each
 * tool. An optional shared access token (PROGRESSO_MCP_TOKEN) keeps strangers
 * off a public tunnel.
 *
 * Everything goes through `Authenticator`, so real auth is one new class:
 * an `OAuthAuthenticator` that verifies the bearer JWT (issuer, audience = this
 * server's URL, expiry) and maps its subject to a student id, plus the
 * protected-resource metadata routes. See docs/phase-10-report.md ("Adding OAuth").
 */
import { timingSafeEqual } from "node:crypto";

export interface Principal {
  /** The one student this connection acts for; undefined = any demo student, named per call. */
  studentId?: string;
  via: "open" | "access_token" | "stdio";
}

export interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
}

export type AuthResult = { ok: true; principal: Principal } | { ok: false; status: 401 | 403; message: string; wwwAuthenticate?: string };

export interface Authenticator {
  authenticate(req: AuthRequest): AuthResult;
}

const header = (req: AuthRequest, name: string): string | undefined => {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};
const param = (req: AuthRequest, name: string): string | undefined => {
  const v = req.query[name];
  return typeof v === "string" && v.length > 0 ? v : undefined;
};

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Demo auth: optional shared token + optional student binding. Not for real student data. */
export class DemoAuthenticator implements Authenticator {
  constructor(private readonly opts: { accessToken?: string; knownStudent: (id: string) => boolean }) {}

  authenticate(req: AuthRequest): AuthResult {
    let via: Principal["via"] = "open";
    if (this.opts.accessToken) {
      const bearer = header(req, "authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
      const given = bearer ?? param(req, "token");
      if (!given || !same(given, this.opts.accessToken)) {
        return { ok: false, status: 401, message: "Missing or wrong access token (pass ?token=… or an Authorization: Bearer header).", wwwAuthenticate: 'Bearer realm="progresso"' };
      }
      via = "access_token";
    }
    const studentId = param(req, "student") ?? header(req, "x-progresso-student");
    if (studentId && !this.opts.knownStudent(studentId)) return { ok: false, status: 403, message: `Unknown student "${studentId}".` };
    return { ok: true, principal: { ...(studentId ? { studentId } : {}), via } };
  }
}

/**
 * Which student a tool call acts for. A bound connection only ever acts for its
 * student; an unbound one needs the `student` argument.
 */
export function resolveStudent(principal: Principal, requested: string | undefined, known: (id: string) => boolean, ids: () => string[]): string {
  if (principal.studentId) {
    if (requested && requested !== principal.studentId) throw new StudentError(`This connection is for student "${principal.studentId}" only.`);
    return principal.studentId;
  }
  if (!requested) throw new StudentError(`Say which student: pass "student" (one of ${ids().join(", ")}). Call list_students to see them.`);
  if (!known(requested)) throw new StudentError(`Unknown student "${requested}". Known students: ${ids().join(", ")}.`);
  return requested;
}

export class StudentError extends Error {
  override name = "StudentError";
}
