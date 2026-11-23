"use client";

/**
 * Step explainer: an in-browser animated walk-through for one misconception.
 * It starts from the typical wrong step, shows why it breaks, builds the idea
 * and ends with the example done right. One formula is written on the board
 * per step, with a line of narration; plays by itself, or step by step.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { ExplainerLesson } from "@/lib/mission-types";
import { MathText, Tex } from "./MathText";
import { useReducedMotion } from "./useReducedMotion";
import styles from "./Lessons.module.css";

const KIND_LABEL: Record<ExplainerLesson["steps"][number]["kind"], string> = {
  wrong: "The tempting step",
  why: "Why it breaks",
  idea: "The idea",
  rule: "The rule",
  example: "Done right",
  check: "Exam habit",
};

/**
 * A board formula that shrinks to fit the board's width (down to 55%), so a
 * long line stays whole on a phone; beyond that the board scrolls sideways.
 * Measured imperatively (no re-render loop) and again on resize.
 */
function FitTex({ tex, className }: { tex: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const d = el.querySelector<HTMLElement>(".katex-display");
      if (!d) return;
      el.style.fontSize = "";
      const need = d.scrollWidth;
      const have = d.clientWidth;
      if (need > have + 1) el.style.fontSize = `${parseFloat(getComputedStyle(el).fontSize) * Math.max(0.55, have / need)}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el.parentElement ?? el);
    return () => ro.disconnect();
  }, [tex]);
  return (
    <span ref={ref} className={className} style={{ display: "block" }}>
      <Tex tex={tex} />
    </span>
  );
}

/** Time on a step: enough to read its narration. */
const dwell = (say: string) => Math.min(9000, 2600 + say.length * 45);

function Player({ lesson, autoPlay }: { lesson: ExplainerLesson; autoPlay: boolean }) {
  const reduced = useReducedMotion();
  const n = lesson.steps.length;
  const [i, setI] = useState(0);
  // Auto-play unless the user prefers reduced motion (then it's step by step).
  const [paused, setPaused] = useState(!autoPlay);
  const playing = !reduced && !paused && i < n - 1;
  const step = lesson.steps[i]!;

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setI((x) => Math.min(n - 1, x + 1)), dwell(step.say));
    return () => clearTimeout(t);
  }, [playing, i, n, step.say]);

  const earlier = lesson.steps
    .slice(0, i)
    .map((s, k) => ({ s, k }))
    .filter(({ s }) => s.math)
    .slice(-2);
  const last = i === n - 1;

  return (
    <div className={styles.explainer} data-explainer={lesson.misconception_id} data-step={i}>
      {/* Focusable: a long formula can scroll sideways on a phone. */}
      <div className={styles.board} role="region" aria-label="Board" tabIndex={0}>
        <ol role="list" className={styles.boardEarlier} aria-hidden="true">
          {earlier.map(({ s, k }) => (
            <li key={k} className={s.kind === "wrong" ? styles.boardStruck : undefined}>
              <FitTex tex={s.math!} />
            </li>
          ))}
        </ol>
        <div key={i} className={`${styles.boardNow} ${step.kind === "wrong" ? styles.boardWrong : ""}`}>
          <span className={`${styles.kind} ${styles[`kind_${step.kind}`] ?? ""}`}>
            {step.kind === "wrong" && <Icon name="close" size={13} />}
            {KIND_LABEL[step.kind]}
          </span>
          {step.math && <FitTex tex={step.math} className={styles.write} />}
        </div>
      </div>
      <p className={styles.say} aria-live="polite" key={`say-${i}`}>
        <MathText text={step.say} />
      </p>
      {last && (
        <p className={`${styles.keyIdea} ${styles.in}`}>
          <Icon name="bulb" size={18} />
          <span>
            <strong>Remember.</strong> <MathText text={lesson.takeaway} />
          </span>
        </p>
      )}
      <div className={styles.playbar}>
        <Button variant="secondary" size="sm" icon="arrowLeft" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>
          Back
        </Button>
        {last ? (
          <Button
            variant="secondary"
            size="sm"
            icon="repeat"
            onClick={() => {
              setI(0);
              setPaused(false);
            }}
          >
            Replay
          </Button>
        ) : reduced ? null : (
          <Button variant="secondary" size="sm" icon={playing ? "pause" : "play"} onClick={() => setPaused(playing)}>
            {playing ? "Pause" : "Play"}
          </Button>
        )}
        <Button variant="secondary" size="sm" trailingIcon="arrowRight" onClick={() => setI(Math.min(n - 1, i + 1))} disabled={last}>
          Next
        </Button>
        <span className={styles.progress}>
          Step {i + 1} of {n}
        </span>
      </div>
      <ol role="list" className={styles.dots} aria-hidden="true">
        {lesson.steps.map((_, k) => (
          <li key={k} className={k < i ? styles.dotDone : k === i ? styles.dotNow : undefined} />
        ))}
      </ol>
      {lesson.checked && <p className={styles.checked}>Explainer {lesson.checked}</p>}
    </div>
  );
}

export function StepExplainer({ lessons, autoPlay = true }: { lessons: ExplainerLesson[]; autoPlay?: boolean }) {
  const [pick, setPick] = useState(0);
  const lesson = lessons[Math.min(pick, lessons.length - 1)];
  if (!lesson) return null;
  return (
    <div className={styles.recapWrap}>
      {lessons.length > 1 && (
        <div className={styles.switcher} role="group" aria-label="Choose an explainer">
          {lessons.map((l, i) => (
            <button key={l.misconception_id} type="button" className={styles.chip} aria-pressed={i === pick} onClick={() => setPick(i)}>
              {l.title}
              {l.yours && <span className={styles.chipYours}> · in your report</span>}
            </button>
          ))}
        </div>
      )}
      <div className={styles.explainerHead}>
        <h2 className={styles.explainerTitle}>{lesson.title}</h2>
        {lesson.yours && <Badge tone="amber">In your report</Badge>}
      </div>
      <Player key={lesson.misconception_id} lesson={lesson} autoPlay={autoPlay} />
    </div>
  );
}
