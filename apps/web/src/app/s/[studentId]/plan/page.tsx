import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PlanTimeline } from "@/components/missions/PlanTimeline";
import { StudentChrome } from "@/components/missions/StudentChrome";
import { getStudent } from "@/server/data";
import { getPlanView } from "@/server/missions";
import { hasReport } from "@/server/report-state";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your plan" };

export default async function PlanPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const student = getStudent(studentId);
  if (!student) notFound();
  if (!(await hasReport(studentId))) redirect(`/s/${studentId}/add-report`);
  const data = getPlanView(studentId);
  if (!data) redirect(`/s/${studentId}/today`);
  return (
    <>
      <StudentChrome student={student} current="plan" />
      <main id="main">
        <PlanTimeline data={data} />
      </main>
    </>
  );
}
