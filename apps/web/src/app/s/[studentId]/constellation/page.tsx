import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ConstellationView } from "@/components/constellation/ConstellationView";
import { LogoMark } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";
import { SampleDataBadge } from "@/components/ui/Badge";
import { getConstellation, getStudent } from "@/server/data";
import { hasReport } from "@/server/report-state";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your knowledge constellation" };

/** Full-screen constellation. State is read from the database on every request. */
export default async function ConstellationPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const student = getStudent(studentId);
  if (!student) notFound();
  if (!(await hasReport(studentId))) redirect(`/s/${studentId}/add-report`);
  const model = getConstellation(studentId);
  if (!model) notFound();

  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <Link href={`/s/${studentId}/diagnosis`} className={styles.back} aria-label="Back to the diagnosis">
          <Icon name="arrowLeft" size={18} />
          <span className={styles.backText}>Diagnosis</span>
        </Link>
        <h1 className={styles.title}>
          <LogoMark size={22} />
          <span>
            {student.name}&apos;s <span className={styles.titleRest}>knowledge </span>constellation
          </span>
        </h1>
        <div className={styles.right}>{student.is_sample && <SampleDataBadge notice={student.sample_notice} />}</div>
      </header>
      <main id="main" className={styles.main}>
        <ConstellationView model={model} variant="full" demoEnabled={student.is_sample} />
      </main>
    </div>
  );
}
