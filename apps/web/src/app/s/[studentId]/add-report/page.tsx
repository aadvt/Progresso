import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AddReport } from "@/components/report/AddReport";
import { StudentChip } from "@/components/StudentChip";
import { SampleDataBadge } from "@/components/ui/Badge";
import { TopBar } from "@/components/ui/TopBar";
import { getStudent, listStudents } from "@/server/data";
import { hasReport } from "@/server/report-state";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Add exam report" };

export default async function AddReportPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const student = getStudent(studentId);
  if (!student) notFound();
  const seed = listStudents().findIndex((s) => s.id === studentId);

  return (
    <>
      <TopBar>
        {student.is_sample && <SampleDataBadge notice={student.sample_notice} />}
        <StudentChip student={student} seed={seed} />
      </TopBar>
      <main id="main">
        <AddReport student={student} alreadyAdded={await hasReport(studentId)} />
      </main>
    </>
  );
}
