import Link from "next/link";
import { resetDemo } from "@/app/actions";
import { Badge, SampleDataBadge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Surface } from "@/components/ui/Surface";
import { TopBar } from "@/components/ui/TopBar";
import { HeroArt } from "@/components/HeroArt";
import { StudentAvatar } from "@/components/StudentAvatar";
import { listStudents } from "@/server/data";
import { studentsWithReport } from "@/server/report-state";
import { formatDate, plural } from "@/lib/format";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function Home() {
  const students = listStudents();
  const added = await studentsWithReport();

  return (
    <>
      <TopBar>
        <Badge tone="neutral">Prototype</Badge>
      </TopBar>
      <main id="main" className={`container ${styles.main}`}>
        <div className={styles.heroWrap}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <p className={styles.eyebrow} data-enter>
            <span className={styles.pulse} aria-hidden="true" />
            For CBSE Class 11–12
          </p>
          <h1 id="hero-title" className={styles.title} data-enter style={{ "--enter-delay": "80ms" } as React.CSSProperties}>
            From exam report
            <br />
            <span className={styles.titleAccent}>to exam ready.</span>
          </h1>
          <p className={styles.lede} data-enter style={{ "--enter-delay": "160ms" } as React.CSSProperties}>
            Progresso reads your Inferentics report, finds the few root gaps behind most of your mistakes, and turns them into
            a short plan for your next exam.
          </p>
          <ol className={styles.steps} role="list" data-enter style={{ "--enter-delay": "240ms" } as React.CSSProperties}>
            <li>
              <span className={styles.stepNum}>1</span>Add your report
            </li>
            <li aria-hidden="true" className={styles.stepThread} />
            <li>
              <span className={styles.stepNum}>2</span>See the root gaps
            </li>
            <li aria-hidden="true" className={styles.stepThread} />
            <li>
              <span className={styles.stepNum}>3</span>Fix them, a mission a day
            </li>
          </ol>
        </section>
        <div className={styles.heroArt} data-enter style={{ "--enter-delay": "200ms" } as React.CSSProperties}>
          <HeroArt />
        </div>
        </div>

        <section className={styles.picker} aria-labelledby="picker-title">
          <div className={styles.pickerHead}>
            <div>
              <h2 id="picker-title" className={styles.pickerTitle}>
                Choose a student
              </h2>
              <p className={styles.pickerHint}>No sign-in in this prototype. Pick one of the demo students to try the flow.</p>
            </div>
            <SampleDataBadge notice={students[0]?.sample_notice} />
          </div>

          <ul className={styles.grid} role="list">
            {students.map((s, i) => {
              const hasReport = added.has(s.id);
              const href = hasReport ? `/s/${s.id}/diagnosis` : `/s/${s.id}/add-report`;
              return (
                <li key={s.id} data-enter style={{ "--enter-delay": `${300 + i * 70}ms` } as React.CSSProperties}>
                  <Surface as={Link} href={href} interactive className={styles.card} aria-describedby={`${s.id}-status`}>
                    <div className={styles.cardTop}>
                      <StudentAvatar name={s.name} seed={i} />
                      <div className={styles.who}>
                        <span className={styles.name}>{s.name}</span>
                        <span className={styles.meta}>Class {s.class}</span>
                        <span className={styles.subjects}>{s.subjects.join(" & ")}</span>
                      </div>
                      <Icon name="arrowRight" className={styles.go} />
                    </div>
                    <dl className={styles.facts}>
                      <div>
                        <dt>Next exam</dt>
                        <dd>
                          {s.next_exam ? (
                            <>
                              {s.next_exam.name}
                              <span className={styles.sub}>
                                {s.next_exam.days_left >= 0 ? `in ${plural(s.next_exam.days_left, "day")}` : formatDate(s.next_exam.date)}
                              </span>
                            </>
                          ) : (
                            "Not set"
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Reports</dt>
                        <dd className="tabular">{plural(s.exam_count, "exam")}</dd>
                      </div>
                    </dl>
                    <div id={`${s.id}-status`} className={styles.status} data-ready={hasReport || undefined}>
                      <span className={styles.statusDot} aria-hidden="true" />
                      {hasReport ? "Diagnosis ready" : "Report not added yet"}
                    </div>
                  </Surface>
                </li>
              );
            })}
          </ul>

          <div className={styles.footer}>
            <p className={styles.footNote}>
              <Icon name="info" size={16} />
              Every student here is sample data: hand-written demo records, not real students or real Inferentics reports.
            </p>
            {added.size > 0 && (
              <form action={resetDemo}>
                <button type="submit" className={styles.reset}>
                  Reset demo
                </button>
              </form>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
