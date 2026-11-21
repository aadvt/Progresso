import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Diagnosis } from "@/components/diagnosis/Diagnosis";
import { StudentChrome } from "@/components/missions/StudentChrome";
import { getConstellation, getDiagnosis, getStudent } from "@/server/data";
import { hasReport } from "@/server/report-state";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your diagnosis" };

export default async function DiagnosisPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const student = getStudent(studentId);
  if (!student) notFound();
  if (!(await hasReport(studentId))) redirect(`/s/${studentId}/add-report`);
  const view = getDiagnosis(studentId);
  const constellation = getConstellation(studentId);
  if (!view || !constellation) notFound();

  return (
    <>
      <StudentChrome student={student} current="diagnosis" />
      <main id="main">
        <Diagnosis student={student} view={view} constellation={constellation} />
      </main>
    </>
  );
}
