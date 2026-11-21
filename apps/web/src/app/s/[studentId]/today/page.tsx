import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PlanSetup } from "@/components/missions/PlanSetup";
import { StudentChrome } from "@/components/missions/StudentChrome";
import { Today } from "@/components/missions/Today";
import { getDiagnosis, getStudent } from "@/server/data";
import { getToday, hasPlan, planDefaults } from "@/server/missions";
import { hasReport } from "@/server/report-state";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Today" };

export default async function TodayPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const student = getStudent(studentId);
  if (!student) notFound();
  if (!(await hasReport(studentId))) redirect(`/s/${studentId}/add-report`);

  if (!hasPlan(studentId)) {
    const view = getDiagnosis(studentId);
    const defaults = planDefaults(studentId);
    if (!view || !defaults) notFound();
    return (
      <>
        <StudentChrome student={student} current="today" />
        <main id="main">
          <PlanSetup
            studentId={studentId}
            defaults={defaults}
            roots={view.roots.map((r) => r.concept.name)}
            missions={view.roots.reduce((s, r) => s + r.missions, 0)}
          />
        </main>
      </>
    );
  }
  const data = getToday(studentId);
  if (!data) notFound();
  return (
    <>
      <StudentChrome student={student} current="today" />
      <main id="main">
        <Today data={data} studentName={student.name} />
      </main>
    </>
  );
}
