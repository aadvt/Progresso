/**
 * Which students have had a report added in this browser. Prototype only: no
 * logins (scope rule 2), so this lives in a cookie. Phase P moves it to the
 * database together with the parsed records.
 */
import { cookies } from "next/headers";

const COOKIE = "progresso-reports";
const MAX_AGE = 60 * 60 * 24 * 30;

function parse(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").filter((x) => /^[A-Za-z0-9._:-]+$/.test(x)));
}

export async function studentsWithReport(): Promise<Set<string>> {
  return parse((await cookies()).get(COOKIE)?.value);
}

export async function hasReport(studentId: string): Promise<boolean> {
  return (await studentsWithReport()).has(studentId);
}

export async function rememberReport(studentId: string): Promise<void> {
  const jar = await cookies();
  const ids = parse(jar.get(COOKIE)?.value);
  ids.add(studentId);
  jar.set(COOKIE, [...ids].join(","), { path: "/", maxAge: MAX_AGE, sameSite: "lax", httpOnly: true });
}

export async function forgetReports(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
