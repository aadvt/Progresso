import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import "katex/dist/katex.min.css";
import { MissionPlayer } from "@/components/missions/MissionPlayer";
import { StudentChrome } from "@/components/missions/StudentChrome";
import { getStudent } from "@/server/data";
import { getMissionData } from "@/server/missions";
import { hasReport } from "@/server/report-state";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mission" };

export default async function MissionPage({ params }: { params: Promise<{ studentId: string; missionId: string }> }) {
  const { studentId, missionId } = await params;
  const student = getStudent(studentId);
  if (!student) notFound();
  if (!(await hasReport(studentId))) redirect(`/s/${studentId}/add-report`);
  const data = getMissionData(studentId, decodeURIComponent(missionId));
  if (!data) redirect(`/s/${studentId}/today`);
  return (
    <>
      <StudentChrome student={student} current="today" />
      <main id="main">
        <MissionPlayer data={data} />
      </main>
    </>
  );
}
