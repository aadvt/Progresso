import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import "katex/dist/katex.min.css";
import { ExplainerVideo } from "@/components/missions/ExplainerVideo";
import { MistakeRecapBoard } from "@/components/missions/MistakeRecap";
import { StepExplainer } from "@/components/missions/StepExplainer";
import { StudentChrome } from "@/components/missions/StudentChrome";
import { SampleDataBadge } from "@/components/ui/Badge";
import { Surface } from "@/components/ui/Surface";
import { getStudent } from "@/server/data";
import { getReplays } from "@/server/missions";
import { hasReport } from "@/server/report-state";
import styles from "@/components/missions/Replays.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Replay your mistakes" };

/** Every Mistake Recap and explainer prepared for the student, to rewatch any time. Nothing auto-plays here. */
export default async function ReplaysPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const student = getStudent(studentId);
  if (!student) notFound();
  if (!(await hasReport(studentId))) redirect(`/s/${studentId}/add-report`);
  const data = getReplays(studentId);
  if (!data) redirect(`/s/${studentId}/today`);
  return (
    <>
      <StudentChrome student={student} current="today" />
      <main id="main" className={`container ${styles.wrap}`}>
        <header className={styles.head}>
          <h1 className={styles.h1}>Replay your mistakes</h1>
          <p className={styles.lede}>
            Each one is from your own reports: where it went wrong, marked, then the fix. Press Replay to watch it again.
          </p>
          {student.is_sample && <SampleDataBadge notice={student.sample_notice} />}
        </header>

        <section aria-labelledby="recaps-title" className={styles.section}>
          <h2 id="recaps-title" className={styles.h2}>
            Your mistakes ({data.recaps.length})
          </h2>
          {data.recaps.length === 0 && <p className={styles.lede}>None prepared yet.</p>}
          <ul role="list" className={styles.list}>
            {data.recaps.map((e) => (
              <li key={e.record_id}>
                <Surface level={3} pad="lg">
                  <MistakeRecapBoard e={e} autoPlay={false} />
                </Surface>
              </li>
            ))}
          </ul>
        </section>

        {data.videos.length > 0 && (
          <section aria-labelledby="videos-title" className={styles.section}>
            <h2 id="videos-title" className={styles.h2}>
              Explainer videos ({data.videos.length})
            </h2>
            <ul role="list" className={styles.list}>
              {data.videos.map((v) => (
                <li key={v.misconception_id}>
                  <Surface level={3} pad="lg">
                    <ExplainerVideo videos={[v]} />
                  </Surface>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.explainers.length > 0 && (
          <section aria-labelledby="explainers-title" className={styles.section}>
            <h2 id="explainers-title" className={styles.h2}>
              Explainers for the slips in your report ({data.explainers.length})
            </h2>
            <ul role="list" className={styles.list}>
              {data.explainers.map((x) => (
                <li key={x.misconception_id}>
                  <Surface level={3} pad="lg">
                    <StepExplainer lessons={[x]} autoPlay={false} />
                  </Surface>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
