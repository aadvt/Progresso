"use client";

import { useState } from "react";
import type { ConstellationModel, DiagnosisView } from "@progresso/core";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Surface } from "@/components/ui/Surface";
import type { StudentSummary } from "@/lib/types";
import { formatDate, formatMonthRange, hours, marks, plural } from "@/lib/format";
import { Breakdown } from "./Breakdown";
import { ConstellationSlot } from "./ConstellationSlot";
import { Headline } from "./Headline";
import { HabitsSection, StandaloneSection } from "./Sections";
import { PlanDialog } from "./PlanDialog";
import { ReportDialog } from "./ReportDialog";
import { RootCard } from "./RootCard";
import styles from "./Diagnosis.module.css";

const delay = (ms: number) => ({ "--enter-delay": `${ms}ms` }) as React.CSSProperties;

export function Diagnosis({ student, view, constellation }: { student: StudentSummary; view: DiagnosisView; constellation: ConstellationModel }) {
  const [reportOpen, setReportOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const first = view.exams[0]?.date ?? "";
  const last = view.exams[view.exams.length - 1]?.date ?? "";
  const examNames = new Set(view.exams.map((e) => e.name)).size;
  const totalMissions = view.roots.reduce((s, r) => s + r.missions, 0);
  const totalHours = view.roots.reduce((s, r) => s + r.study_hours, 0);

  return (
    <div className={`container ${styles.layout}`}>
      <Surface as="section" level={3} pad="lg" className={styles.hero} aria-labelledby="headline" data-enter>
        <div className={styles.heroTop}>
          <p className={styles.eyebrow}>
            <span className={styles.eyebrowDot} aria-hidden="true" />
            {student.name}&apos;s diagnosis · {plural(examNames, "exam")} · {first && formatMonthRange(first, last)}
          </p>
          {student.next_exam && student.next_exam.days_left >= 0 && (
            <p className={styles.countdown}>
              <Icon name="calendar" size={16} />
              {student.next_exam.name} in <strong className="tabular">{plural(student.next_exam.days_left, "day")}</strong>
            </p>
          )}
        </div>

        <Headline headline={view.headline} id="headline" />

        {view.roots.length > 0 && (
          <p className={styles.rootsLine}>
            <span className={styles.rootsLabel}>{view.roots.length === 1 ? "The root" : "The roots"}</span>
            {view.roots.map((r) => (
              <a key={r.concept.id} href={`#root-${r.rank}`} className={styles.rootPill}>
                <span className={styles.rootRank} aria-hidden="true">
                  {r.rank}
                </span>
                {r.concept.name}
                <span className={styles.rootClass}>Class {r.concept.class}</span>
              </a>
            ))}
          </p>
        )}
        {view.headline.mode === "habits" && (
          <p className={styles.rootsLine}>No single knowledge gap: these are checking habits, and they are quick to fix.</p>
        )}

        <div className={styles.ctaRow}>
          <Button variant="primary" size="lg" trailingIcon="arrowRight" onClick={() => setPlanOpen(true)}>
            Start my comeback plan
          </Button>
          <Button variant="secondary" size="lg" icon="doc" onClick={() => setReportOpen(true)}>
            View original report
          </Button>
        </div>
      </Surface>

      <div className={styles.side}>
        <div className={styles.constellation} data-enter style={delay(120)}>
          <ConstellationSlot model={constellation} fullHref={`/s/${student.id}/constellation`} />
        </div>
        <div className={styles.sideRest}>
          <Breakdown view={view} />
          <Surface as="section" level={1} pad="md" aria-labelledby="exams-title">
            <h2 id="exams-title" className={styles.sideTitle}>
              Exams in this diagnosis
            </h2>
            <ol className={styles.exams} role="list">
              {view.exams.map((e) => (
                <li key={e.id}>
                  <span className={styles.examName}>{e.name}</span>
                  <span className={styles.examMeta}>
                    {e.subject} · {formatDate(e.date)}
                  </span>
                </li>
              ))}
            </ol>
            <button type="button" className={styles.textButton} onClick={() => setReportOpen(true)}>
              Read the report&apos;s own words
              <Icon name="arrowRight" size={16} />
            </button>
          </Surface>
        </div>
      </div>

      <div className={styles.main}>
        {view.roots.length > 0 && (
          <section aria-labelledby="roots-title" className={styles.section}>
            <header className={styles.sectionHead} data-enter style={delay(160)}>
              <h2 id="roots-title" className={styles.sectionTitle}>
                {view.roots.length === 1 ? "The root gap" : `The ${view.roots.length} root gaps`}
              </h2>
              <p className={styles.sectionLede}>
                One gap underneath causes mistakes in every topic built on it. Fix the root, and those mistakes stop.
                {view.roots.length > 1 && " Ordered by marks won back per hour of study."}
              </p>
            </header>
            <ol className={styles.rootList} role="list">
              {view.roots.map((r, i) => (
                <li key={r.concept.id} id={`root-${r.rank}`} data-enter style={delay(220 + i * 90)}>
                  <RootCard root={r} defaultOpen={i === 0} />
                </li>
              ))}
            </ol>
          </section>
        )}

        {view.standalone.length > 0 && <StandaloneSection items={view.standalone} />}
        {view.habits.length > 0 && <HabitsSection habits={view.habits} />}

        <Surface as="section" level={2} pad="lg" className={styles.finalCta} aria-labelledby="final-cta">
          <div>
            <h2 id="final-cta" className={styles.finalTitle}>
              Ready to win back ~{marks(view.headline.marks)} marks?
            </h2>
            <p className={styles.finalText}>
              {totalMissions > 0
                ? `About ${hours(totalHours)} of work: ${plural(totalMissions, "mission")} of 25 minutes`
                : "A few short missions on checking habits"}
              {student.next_exam && student.next_exam.days_left > 0
                ? `, done before ${student.next_exam.name} in ${plural(student.next_exam.days_left, "day")}.`
                : "."}
            </p>
          </div>
          <Button variant="primary" size="lg" trailingIcon="arrowRight" onClick={() => setPlanOpen(true)}>
            Start my comeback plan
          </Button>
        </Surface>
      </div>

      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} view={view} student={student} />
      <PlanDialog open={planOpen} onClose={() => setPlanOpen(false)} view={view} student={student} />
    </div>
  );
}
