import type { MarksValue, ReportEvidence } from "@progresso/core";
import { errorTypeLabel, formatDate, marks as fmtMarks } from "@/lib/format";
import styles from "./EvidenceCard.module.css";

/**
 * One mistake as the report describes it. The diagnosis text is verbatim;
 * the student's working is shown only when the report quotes it.
 */
export function EvidenceCard({
  evidence: e,
  marks,
  note,
  compact = false,
  as: Tag = "li",
}: {
  evidence: ReportEvidence;
  marks?: MarksValue;
  note?: string;
  compact?: boolean;
  as?: "li" | "div";
}) {
  const lost = marks ?? (e.marks_lost !== undefined ? { value: e.marks_lost, estimated: false } : undefined);
  const hasMore = Boolean(e.working || e.correct_approach);

  return (
    <Tag className={styles.card} data-compact={compact || undefined}>
      <div className={styles.head}>
        <span className={styles.ref}>{e.question_ref}</span>
        <span className={styles.exam}>
          {e.exam_name}
          <span className={styles.date}> · {formatDate(e.exam_date)}</span>
        </span>
        {lost && lost.value > 0 && (
          <span className={styles.lost} title={lost.estimated ? "Estimated: the report gave no marks for this question" : undefined}>
            −{lost.estimated ? "~" : ""}
            {fmtMarks(lost.value)} {lost.value === 1 ? "mark" : "marks"}
          </span>
        )}
        <span className={styles.type}>{errorTypeLabel(e.error_type)}</span>
      </div>

      {note && <p className={styles.note}>{note}</p>}
      {e.question_text && !compact && (
        <p className={styles.question}>
          <span className={styles.label}>Question</span> {e.question_text}
        </p>
      )}

      <blockquote className={styles.quote}>
        <span className={styles.label}>From the report</span>
        <p>{e.diagnosis}</p>
      </blockquote>

      {hasMore && !compact && (
        <details className={styles.more}>
          <summary>{e.working ? "Your working and the fix" : "The fix"}</summary>
          <div className={styles.moreBody}>
            {e.working && (
              <div>
                <span className={styles.label}>Your working, as quoted in the report</span>
                <pre className={styles.working}>{e.working.text}</pre>
              </div>
            )}
            {e.correct_approach && (
              <div>
                <span className={styles.label}>Correct method, from the report</span>
                <p className={styles.correct}>{e.correct_approach}</p>
              </div>
            )}
          </div>
        </details>
      )}
    </Tag>
  );
}
