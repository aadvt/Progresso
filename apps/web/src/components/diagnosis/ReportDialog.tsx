"use client";

import type { DiagnosisView } from "@progresso/core";
import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import type { StudentSummary } from "@/lib/types";
import { errorTypeLabel, formatDate, marks, plural } from "@/lib/format";
import styles from "./ReportDialog.module.css";

/**
 * "View original report": the report's own words, untouched, for trust.
 * Sample students have no report text, so we show the verbatim diagnosis lines
 * the sample was written with, and say so. We never generate report text.
 */
export function ReportDialog({
  open,
  onClose,
  view,
  student,
}: {
  open: boolean;
  onClose: () => void;
  view: DiagnosisView;
  student: StudentSummary;
}) {
  const count = view.report.reduce((s, sec) => s + sec.items.length, 0);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="The original report"
      subtitle={`${plural(count, "diagnosed mistake")} across ${plural(view.report.length, "exam paper")}, word for word.`}
    >
      {student.is_sample && (
        <div className={styles.sample} role="note">
          <Icon name="info" size={18} />
          <p>
            <strong>Sample data.</strong> {student.name} is a demo student, so there is no real report text. Below are the
            hand-written report lines this sample was built from, exactly as the diagnosis uses them.
          </p>
        </div>
      )}
      {view.report.map((sec) => (
        <section key={sec.exam.id} className={styles.exam} aria-labelledby={`rep-${sec.exam.id}`}>
          <header className={styles.examHead}>
            <h3 id={`rep-${sec.exam.id}`} className={styles.examName}>
              {sec.exam.name} · {sec.exam.subject}
            </h3>
            <p className={styles.examMeta}>
              {formatDate(sec.exam.date)}
              {sec.exam.max_marks ? ` · out of ${sec.exam.max_marks}` : ""}
            </p>
          </header>
          <ol className={styles.items} role="list">
            {sec.items.map((it) => (
              <li key={it.record_id} className={styles.item}>
                <div className={styles.itemHead}>
                  <span className={styles.ref}>{it.question_ref}</span>
                  <span className={styles.label}>{it.error_label ?? errorTypeLabel(it.error_type)}</span>
                  {it.marks_lost !== undefined && (
                    <span className={styles.marks}>
                      {marks(it.marks_lost)}
                      {it.marks_max !== undefined ? ` of ${marks(it.marks_max)}` : ""} lost
                    </span>
                  )}
                </div>
                <p className={styles.text}>{it.diagnosis}</p>
                {it.correct_approach && (
                  <p className={styles.correct}>
                    <span className={styles.correctLabel}>Correct approach:</span> {it.correct_approach}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </Dialog>
  );
}
