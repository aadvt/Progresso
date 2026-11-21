"use server";

import { revalidatePath } from "next/cache";
import { getStudent } from "@/server/data";
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
