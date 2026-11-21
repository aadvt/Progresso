"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FeedbackView, ResultView } from "@/lib/mission-types";
import { getStudent } from "@/server/data";
import { answer, demoNextDay, demoResetPlan, finish, savePlan, startMissionFor } from "@/server/missions";

function revalidateStudent(studentId: string): void {
  for (const p of ["today", "plan", "diagnosis", "constellation"]) revalidatePath(`/s/${studentId}/${p}`);
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** "Build my plan": save the exam and the daily time, then show Today. */
export async function createPlan(studentId: string, form: FormData): Promise<void> {
  if (!getStudent(studentId)) return;
  const exam_date = String(form.get("exam_date") ?? "");
  const exam_name = String(form.get("exam_name") ?? "").trim().slice(0, 80) || "Next exam";
  const daily_minutes = Number(form.get("daily_minutes"));
  if (!ISO.test(exam_date) || ![25, 50, 75].includes(daily_minutes)) return;
  savePlan(studentId, { exam_name, exam_date, daily_minutes });
  revalidateStudent(studentId);
  redirect(`/s/${studentId}/today`);
}

export async function startMissionAction(studentId: string, key: string): Promise<void> {
  const id = startMissionFor(studentId, key);
  if (!id) redirect(`/s/${studentId}/today`);
  redirect(`/s/${studentId}/mission/${encodeURIComponent(id)}`);
}

export async function answerAction(studentId: string, missionId: string, questionId: string, given: string): Promise<FeedbackView | { error: string }> {
  return answer(studentId, missionId, questionId, given.slice(0, 64));
}

export async function finishMissionAction(studentId: string, missionId: string): Promise<ResultView | { error: string }> {
  const r = finish(studentId, missionId);
  if (!("error" in r)) revalidateStudent(studentId);
  return r;
}

/** SAMPLE DATA demo: jump to tomorrow, to show the plan re-flowing. */
export async function demoNextDayAction(studentId: string): Promise<void> {
  if (demoNextDay(studentId)) revalidateStudent(studentId);
}

/** SAMPLE DATA demo: forget the plan, its missions and mastery. */
export async function demoResetPlanAction(studentId: string): Promise<void> {
  if (demoResetPlan(studentId)) revalidateStudent(studentId);
  redirect(`/s/${studentId}/today`);
}
