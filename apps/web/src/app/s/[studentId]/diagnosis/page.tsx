import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Diagnosis } from "@/components/diagnosis/Diagnosis";
import { StudentChip } from "@/components/StudentChip";
import { SampleDataBadge } from "@/components/ui/Badge";
import { TopBar } from "@/components/ui/TopBar";
import { getConstellation, getDiagnosis, getStudent, listStudents } from "@/server/data";
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
  const seed = listStudents().findIndex((s) => s.id === studentId);

  return (
    <>
      <TopBar>
        {student.is_sample && <SampleDataBadge notice={student.sample_notice} />}
        <StudentChip student={student} seed={seed} />
      </TopBar>
      <main id="main">
        <Diagnosis student={student} view={view} constellation={constellation} />
      </main>
    </>
  );
}
