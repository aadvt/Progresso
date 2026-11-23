"use client";

/**
 * Mistake Recap: the student's mistake on an answer sheet, marked in red at
 * the exact step the report describes, then the correct steps appearing one
 * by one, then the key idea. About 10–20 seconds; skippable and replayable.
 *
 * Honesty: handwriting is used ONLY for working the report quotes. Without a
 * quote the sheet shows a typical wrong step, in print, labelled as not the
 * student's own.
 */
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { RecapEvidence, RecapLesson } from "@/lib/mission-types";
import { marks, plural } from "@/lib/format";
import { MathText } from "./MathText";
import { useReducedMotion } from "./useReducedMotion";
import styles from "./Lessons.module.css";

/** How long to wait before showing item k of the sequence (ms). */
function delays(l: RecapLesson): number[] {
  const w = l.wrong.lines.length;
  const f = l.fix.length;
  return [
    ...Array.from({ length: w }, (_, i) => (i === 0 ? 500 : 750)), // working lines
    900, // the red mark + note
    ...Array.from({ length: f }, (_, i) => (i === 0 ? 3400 : 1700)), // the fix, line by line (first waits for the note to be read)
    1900, // key idea
  ];
}

export function MistakeRecapBoard({ e, autoPlay = true }: { e: RecapEvidence & { lesson: RecapLesson }; autoPlay?: boolean }) {
  const l = e.lesson;
  const reduced = useReducedMotion();
  const steps = delays(l);
  const total = steps.length;
  // autoPlay off (the replays page): start fully drawn, Replay plays it.
  const [step, setShown] = useState(autoPlay ? 0 : total);
  // Reduced motion: everything at once, no timers.
  const shown = reduced ? total : step;
  const done = shown >= total;
  const wait = steps[shown];

  useEffect(() => {
    if (reduced || wait === undefined) return;
    const t = setTimeout(() => setShown((s) => s + 1), wait);
    return () => clearTimeout(t);
  }, [shown, wait, reduced]);

  const w = l.wrong.lines.length;
  const marked = shown > w;
  const fixShown = Math.max(0, shown - w - 1);
  const keyShown = shown >= total;
  const own = l.mode === "student_working";
  const lost = e.marks_lost;

  return (
    <div className={styles.recap} data-recap-mode={l.mode} data-record-id={e.record_id} data-done={done ? "true" : undefined}>
      <p className={styles.ctx}>
        <Icon name="doc" size={14} /> <strong>{e.exam_name}</strong> · {e.question_ref}
        {lost !== undefined && (
          <>
            {" "}
            · {e.marks_max !== undefined ? `${marks(lost)} of ${marks(e.marks_max)} marks lost` : `${plural(Number(marks(lost)), "mark")} lost`}
          </>
        )}
      </p>
      {e.question_text && (
        <p className={styles.question}>
          <MathText text={e.question_text} />
        </p>
      )}

      <div className={styles.sheet} role="region" aria-label={own ? "Your working" : "A typical wrong step"} tabIndex={0}>
        {own ? (
          <p className={styles.sheetLabel}>Your working, as quoted in your report</p>
        ) : (
          <div className={styles.typicalLabel}>
            <Badge tone="amber">Not your working</Badge>
            <p>
              Your report names this mistake but doesn&apos;t quote what you wrote. <strong>This is the kind of step that goes wrong here.</strong>
            </p>
          </div>
        )}
        <ol role="list" className={styles.lines}>
          {l.wrong.lines.map((line, i) => (
            <li
              key={i}
              className={`${styles.line} ${i < shown ? styles.in : styles.pending} ${line.wrong && marked ? styles.lineWrong : ""}`}
              aria-hidden={i < shown ? undefined : true}
            >
              <span className={own ? styles.hand : styles.print}>
                {line.segments.map((s, j) =>
                  s.marked ? (
                    <span key={j} className={`${styles.marked} ${marked ? styles.markOn : ""}`}>
                      {s.text}
                      <svg className={styles.ring} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
                        <path d="M10 24 C6 8 70 2 92 12 C102 18 94 34 52 37 C18 39 2 30 6 18 C9 11 22 7 34 6" pathLength={1} />
                      </svg>
                    </span>
                  ) : own ? (
                    <span key={j}>{s.text}</span>
                  ) : (
                    <MathText key={j} text={s.text} display />
                  ),
                )}
              </span>
              {line.wrong && marked && (
                <span className={styles.cross}>
                  <Icon name="close" size={16} />
                  <span className="visually-hidden">This step has the error.</span>
                </span>
              )}
            </li>
          ))}
        </ol>
        <p className={`${styles.penNote} ${marked ? styles.in : styles.pending}`} aria-hidden={marked ? undefined : true}>
          <MathText text={l.wrong.note} />
        </p>
      </div>

      <div
        className={`${styles.fix} ${fixShown > 0 ? styles.in : styles.pending}`}
        aria-hidden={fixShown > 0 ? undefined : true}
        role="region"
        aria-label="The fix"
        tabIndex={fixShown > 0 ? 0 : -1}
      >
        <p className={styles.fixLabel}>
          <Icon name="check" size={16} /> The fix, step by step
        </p>
        <ol role="list" className={styles.fixLines}>
          {l.fix.map((f, i) => (
            <li key={i} className={i < fixShown ? styles.in : styles.pending} aria-hidden={i < fixShown ? undefined : true}>
              <MathText text={f.text} display className={styles.fixMath} />
              {f.note && <MathText text={f.note} className={styles.fixNote} />}
            </li>
          ))}
        </ol>
      </div>

      <p className={`${styles.keyIdea} ${keyShown ? styles.in : styles.pending}`} aria-hidden={keyShown ? undefined : true}>
        <Icon name="bulb" size={18} />
        <span>
          <strong>Key idea.</strong> <MathText text={l.key_idea} />
        </span>
      </p>

      <div className={styles.controls}>
        {done ? (
          <Button
            variant="ghost"
            size="sm"
            icon="repeat"
            onClick={() => setShown(0)}
            disabled={reduced}
          >
            Replay
          </Button>
        ) : (
          <Button variant="ghost" size="sm" icon="arrowRight" onClick={() => setShown(total)}>
            Skip animation
          </Button>
        )}
        {l.checked && <span className={styles.checked}>Correction {l.checked}</span>}
      </div>

      <blockquote className={styles.reportSays}>
        <span className={styles.evLabel}>Your report says</span>
        {e.diagnosis}
      </blockquote>
    </div>
  );
}

/** The recap step: one animated board, with a switcher when several of the mission's mistakes have one. */
export function MistakeRecap({ items }: { items: RecapEvidence[] }) {
  const withLesson = items.filter((e): e is RecapEvidence & { lesson: RecapLesson } => !!e.lesson);
  const [pick, setPick] = useState(0);
  const current = withLesson[Math.min(pick, withLesson.length - 1)];
  if (!current) return null;
  return (
    <div className={styles.recapWrap}>
      {withLesson.length > 1 && (
        <div className={styles.switcher} role="group" aria-label="Choose a mistake to replay">
          {withLesson.map((e, i) => (
            <button key={e.record_id} type="button" className={styles.chip} aria-pressed={i === pick} onClick={() => setPick(i)}>
              {e.exam_name} · {e.question_ref}
            </button>
          ))}
        </div>
      )}
      <MistakeRecapBoard key={current.record_id} e={current} />
    </div>
  );
}
