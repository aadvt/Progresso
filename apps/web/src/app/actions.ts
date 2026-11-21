"use server";

import { revalidatePath } from "next/cache";
import { demoMasterRoot as masterRoot, demoResetMastery as resetMastery, getStudent } from "@/server/data";
import { forgetReports, rememberReport } from "@/server/report-state";

/** Called by the add-report screen once the parse stream has finished. */
export async function markReportAdded(studentId: string): Promise<{ ok: boolean }> {
  if (!getStudent(studentId)) return { ok: false };
  await rememberReport(studentId);
  revalidatePath("/");
  return { ok: true };
}

/** Prototype only: clear every added report so the demo can be run again. */
export async function resetDemo(): Promise<void> {
  await forgetReports();
  revalidatePath("/");
}

function revalidateStudent(studentId: string): void {
  revalidatePath(`/s/${studentId}/constellation`);
  revalidatePath(`/s/${studentId}/diagnosis`);
}

/**
 * Demo trigger for the chain reaction: marks one of a SAMPLE DATA student's
 * roots as mastered in the database, exactly as a passed Phase 5 check will.
 * The page re-renders from the database and the map animates the change.
 */
export async function demoMasterRoot(studentId: string, conceptId: string): Promise<{ ok: boolean }> {
  const ok = masterRoot(studentId, conceptId);
  if (ok) revalidateStudent(studentId);
  return { ok };
}

/** Demo trigger: clear the SAMPLE DATA student's mastery so the demo can run again. */
export async function demoResetConstellation(studentId: string): Promise<{ ok: boolean }> {
  const ok = resetMastery(studentId);
  if (ok) revalidateStudent(studentId);
  return { ok };
}
