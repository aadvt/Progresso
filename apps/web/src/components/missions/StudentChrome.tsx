import { StudentChip } from "@/components/StudentChip";
import { SampleDataBadge } from "@/components/ui/Badge";
import { TopBar } from "@/components/ui/TopBar";
import type { StudentSummary } from "@/lib/types";
import { listStudents } from "@/server/data";
import { StudentNav } from "./StudentNav";

/** Top bar + section nav shared by the student's pages. */
export function StudentChrome({ student, current }: { student: StudentSummary; current: "today" | "plan" | "diagnosis" | "constellation" }) {
  const seed = listStudents().findIndex((s) => s.id === student.id);
  return (
    <>
      <TopBar>
        {student.is_sample && <SampleDataBadge notice={student.sample_notice} />}
        <StudentChip student={student} seed={seed} />
      </TopBar>
      <StudentNav studentId={student.id} current={current} />
    </>
  );
}
