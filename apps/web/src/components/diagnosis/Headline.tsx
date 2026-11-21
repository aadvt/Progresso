import { Fragment } from "react";
import type { DiagnosisHeadline } from "@progresso/core";
import { marks } from "@/lib/format";
import styles from "./Headline.module.css";

interface Term {
  verb: string;
  value: string;
  of?: string;
  unit: string;
}

function terms(h: DiagnosisHeadline): { terms: [Term, Term, Term]; sentence: string } | undefined {
  const m = `~${marks(h.marks)}`;
  const errs = h.total === 1 ? "error" : "errors";
  switch (h.mode) {
    case "roots":
      return {
        terms: [
          { verb: "Fix", value: String(h.fix_count), unit: h.fix_count === 1 ? "thing" : "things" },
          { verb: "Explains", value: String(h.explained), of: `of ${h.total}`, unit: errs },
          { verb: "Worth", value: m, unit: "marks" },
        ],
        sentence: `Fix ${h.fix_count} ${h.fix_count === 1 ? "thing" : "things"}: it explains ${h.explained} of your ${h.total} ${errs}, worth about ${marks(h.marks)} marks.`,
      };
    case "habits":
      return {
        terms: [
          { verb: "Fix", value: String(h.fix_count), unit: h.fix_count === 1 ? "habit" : "habits" },
          { verb: "Behind", value: String(h.explained), of: `of ${h.total}`, unit: errs },
          { verb: "Worth", value: m, unit: "marks" },
        ],
        sentence: `Fix ${h.fix_count} checking ${h.fix_count === 1 ? "habit" : "habits"}: behind ${h.explained} of your ${h.total} ${errs}, worth about ${marks(h.marks)} marks.`,
      };
    case "standalone":
      return {
        terms: [
          { verb: "Fix", value: String(h.fix_count), unit: "one-offs" },
          { verb: "Covers", value: String(h.explained), of: `of ${h.total}`, unit: errs },
          { verb: "Worth", value: m, unit: "marks" },
        ],
        sentence: `Fix ${h.fix_count} separate mistakes, worth about ${marks(h.marks)} marks.`,
      };
    case "empty":
      return undefined;
  }
}

function Arrow() {
  return (
    <span className={styles.arrow} aria-hidden="true">
      <span className={styles.line} />
      <svg className={styles.head} viewBox="0 0 10 14" width="10" height="14">
        <path d="M2 2 L8 7 L2 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={styles.pulse} />
    </span>
  );
}

/** "Fix N things → explains X of Y errors → ~Z marks": the one line a student should remember. */
export function Headline({ headline, id }: { headline: DiagnosisHeadline; id: string }) {
  const t = terms(headline);
  if (!t) {
    return (
      <h1 id={id} className={styles.empty}>
        No mistakes recorded in this report.
      </h1>
    );
  }
  return (
    <h1 id={id} className={styles.headline}>
      <span className="visually-hidden">{t.sentence}</span>
      <span className={styles.equation} aria-hidden="true">
        {t.terms.map((term, i) => (
          <Fragment key={term.verb}>
            {i > 0 && <Arrow />}
            <span className={styles.term} data-accent={i === 2 || undefined} style={{ "--i": i } as React.CSSProperties}>
              <span className={styles.verb}>{term.verb}</span>
              <span className={styles.figure}>
                {term.value.startsWith("~") && <span className={styles.tilde}>~</span>}
                <span className={`${styles.value} tabular`}>{term.value.replace(/^~/, "")}</span>
                {term.of && <span className={`${styles.of} tabular`}>{term.of}</span>}
                <span className={styles.unit}>{term.unit}</span>
              </span>
            </span>
          </Fragment>
        ))}
      </span>
    </h1>
  );
}
