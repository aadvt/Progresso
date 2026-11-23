"use client";

/**
 * The mission player: Mistake Recap → explainer → prove-it questions →
 * result. One thing on screen at a time. Answers are graded on the server
 * (the browser never has the key); a right answer rewards, a wrong one names
 * the specific misconception kindly, with the feedback written for that
 * exact wrong option.
 */
import { parseNumber } from "@progresso/core/missions/client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { answerAction, finishMissionAction } from "@/app/mission-actions";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Surface } from "@/components/ui/Surface";
import type { FeedbackView, MissionData, QuestionView, ResultView } from "@/lib/mission-types";
import { marks, plural } from "@/lib/format";
import { MathText, plainMath } from "./MathText";
import { ExplainerVideo } from "./ExplainerVideo";
import { KIND } from "./MissionCard";
import { MistakeRecap } from "./MistakeRecap";
import { StepExplainer } from "./StepExplainer";
import lessonStyles from "./Lessons.module.css";
import styles from "./MissionPlayer.module.css";

type Step = "recap" | "explainer" | "prove_it" | "result";

const STATE_WORD: Record<string, string> = {
  none: "not started",
  gap: "gap",
  learning: "learning",
  proven: "proven",
  retained: "holding",
};

export function MissionPlayer({ data }: { data: MissionData }) {
  const steps: Step[] = useMemo(() => [...data.card.steps.map((s) => s.kind), "result"], [data.card.steps]);
  const firstUnanswered = data.questions.findIndex((q) => !q.answered);
  const [step, setStep] = useState<Step>(
    data.result ? "result" : data.questions.some((q) => q.answered) ? "prove_it" : (steps[0] ?? "prove_it"),
  );
  const [qIndex, setQIndex] = useState(firstUnanswered < 0 ? Math.max(0, data.questions.length - 1) : firstUnanswered);
  const [answers, setAnswers] = useState<Record<string, FeedbackView>>(() =>
    Object.fromEntries(data.questions.filter((q) => q.answered).map((q) => [q.id, q.answered!])),
  );
  const [result, setResult] = useState<ResultView | undefined>(data.result);
  const [error, setError] = useState("");
  // A video that can't be played falls back to the step explainer.
  const [videoFailed, setVideoFailed] = useState(false);
  const [pending, start] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the new step's heading, so keyboard and screen-reader users follow along.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step, qIndex]);

  const k = KIND[data.card.kind];
  const recapLessons = data.recap.filter((e) => e.lesson).length;
  const recapRest = data.recap.filter((e) => !e.lesson);
  const stepIndex = steps.indexOf(step);
  const allAnswered = data.questions.every((q) => answers[q.id]);

  const finish = () =>
    start(async () => {
      setError("");
      const r = await finishMissionAction(data.student_id, data.id);
      if ("error" in r) setError(r.error === "unanswered" ? "Answer every question first." : "Something went wrong. Try again.");
      else {
        setResult(r);
        setStep("result");
      }
    });

  return (
    <div className={`container ${styles.wrap}`}>
      <header className={styles.head}>
        <Link href={`/s/${data.student_id}/today`} className={styles.back}>
          <Icon name="arrowLeft" size={16} /> Today
        </Link>
        <div className={styles.headText}>
          <Badge tone={k.tone}>
            <Icon name={k.icon} size={14} />
            {k.label}
          </Badge>
          <p className={styles.missionTitle}>{data.card.title}</p>
        </div>
        <ol className={styles.stepper} role="list" aria-label="Mission steps">
          {steps.map((s, i) => (
            <li key={s} className={`${styles.stepDot} ${i < stepIndex ? styles.stepDone : ""} ${i === stepIndex ? styles.stepNow : ""}`} aria-current={i === stepIndex ? "step" : undefined}>
              <span className={styles.stepBall} aria-hidden="true">
                {i < stepIndex ? <Icon name="check" size={12} /> : i + 1}
              </span>
              <span className={styles.stepName}>{s === "result" ? "Result" : (data.card.steps.find((x) => x.kind === s)?.label ?? s)}</span>
            </li>
          ))}
        </ol>
      </header>

      {step === "recap" && (
        <Surface as="section" level={3} pad="lg" className={styles.panel} aria-labelledby="step-title" data-enter>
          <p className={styles.kicker}>Step 1 · Mistake Recap</p>
          {recapLessons > 0 ? (
            <>
              <h1 id="step-title" ref={headingRef} tabIndex={-1} className={styles.h1}>
                {recapLessons === 1 ? "Your mistake, replayed" : `Your mistakes, replayed (${recapLessons})`}
              </h1>
              <p className={styles.lede}>Where it went wrong on your paper, marked, then the fix. Under a minute.</p>
              <MistakeRecap items={data.recap} />
              {recapRest.length > 0 && (
                <details className={styles.more}>
                  <summary>
                    {plural(recapRest.length, "other mistake")} on this in your report
                  </summary>
                  <ul role="list" className={styles.evidence}>
                    {recapRest.map((e) => (
                      <EvidenceItem key={e.record_id} e={e} />
                    ))}
                  </ul>
                </details>
              )}
            </>
          ) : (
            <>
              <h1 id="step-title" ref={headingRef} tabIndex={-1} className={styles.h1}>
                {data.recap.length === 1 ? "The mistake we're fixing" : `The ${data.recap.length} mistakes we're fixing`}
              </h1>
              <p className={styles.lede}>In your report&apos;s own words. Read what went wrong; the next step is about why.</p>
              <ul role="list" className={styles.evidence}>
                {data.recap.slice(0, RECAP_SHOWN).map((e) => (
                  <EvidenceItem key={e.record_id} e={e} />
                ))}
              </ul>
              {data.recap.length > RECAP_SHOWN && (
                <details className={styles.more}>
                  <summary>Show the other {plural(data.recap.length - RECAP_SHOWN, "mistake")}</summary>
                  <ul role="list" className={styles.evidence}>
                    {data.recap.slice(RECAP_SHOWN).map((e) => (
                      <EvidenceItem key={e.record_id} e={e} />
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
          <div className={styles.actions}>
            <Button variant="primary" size="lg" trailingIcon="arrowRight" onClick={() => setStep("explainer")}>
              Continue
            </Button>
          </div>
        </Surface>
      )}

      {step === "explainer" && data.explainer && (
        <Surface as="section" level={3} pad="lg" className={styles.panel} aria-labelledby="step-title" data-enter>
          <p className={styles.kicker}>Step 2 · Explainer</p>
          <h1 id="step-title" ref={headingRef} tabIndex={-1} className={styles.h1}>
            {data.explainer.concept_name}
          </h1>
          <p className={styles.lede}>
            Class {data.explainer.class} · {data.explainer.chapter}
            {data.explainer.root_name && (
              <>
                {" "}
                · built on <strong>{data.explainer.root_name}</strong>, the root you&apos;re fixing
              </>
            )}
          </p>
          {data.explainer.videos.length > 0 && !videoFailed ? (
            <>
              <ExplainerVideo videos={data.explainer.videos} onUnavailable={() => setVideoFailed(true)} />
              {data.explainer.lessons.length > 0 && (
                <details className={lessonStyles.stepByStep}>
                  <summary>Prefer to go step by step?</summary>
                  <StepExplainer lessons={data.explainer.lessons} autoPlay={false} />
                </details>
              )}
            </>
          ) : data.explainer.lessons.length > 0 ? (
            <StepExplainer lessons={data.explainer.lessons} />
          ) : (
            <div className={styles.explainerSlot}>
              <Icon name="play" size={28} />
              <div>
                <p className={styles.slotTitle}>Step-by-step explainer</p>
                <p className={styles.slotText}>The animated walk-through for this topic hasn&apos;t been made yet. Use your textbook section for now.</p>
              </div>
            </div>
          )}
          <h2 className={styles.h2}>
            <Icon name="bulb" size={18} /> Watch out for
          </h2>
          <ul role="list" className={styles.watch}>
            {data.explainer.watch_for.map((w) => (
              <li key={w.id}>
                <span>{w.description}</span>
                {w.yours && <Badge tone="amber">In your report</Badge>}
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <Button variant="secondary" size="lg" icon="arrowLeft" onClick={() => setStep("recap")}>
              Back
            </Button>
            <Button variant="primary" size="lg" trailingIcon="arrowRight" onClick={() => setStep("prove_it")}>
              I&apos;m ready: prove it
            </Button>
          </div>
        </Surface>
      )}

      {step === "prove_it" && data.questions.length > 0 && (
        <QuestionStep
          key={data.questions[qIndex]!.id}
          data={data}
          index={qIndex}
          question={data.questions[qIndex]!}
          feedback={answers[data.questions[qIndex]!.id]}
          headingRef={headingRef}
          onAnswered={(f) => setAnswers((a) => ({ ...a, [data.questions[qIndex]!.id]: f }))}
          onNext={() => (qIndex + 1 < data.questions.length ? setQIndex(qIndex + 1) : finish())}
          finishing={pending}
          allAnswered={allAnswered}
          stepNumber={stepIndex + 1}
          answeredMap={answers}
        />
      )}

      {step === "prove_it" && data.questions.length === 0 && (
        <Surface as="section" level={3} pad="lg" className={styles.panel} aria-labelledby="step-title">
          <h1 id="step-title" ref={headingRef} tabIndex={-1} className={styles.h1}>
            No verified questions for this topic yet
          </h1>
          <p className={styles.lede}>
            We only show questions that passed an independent check, and none have for this topic so far. Mark it as studied and it counts as learning,
            but it isn&apos;t proven until you pass a check.
          </p>
          <div className={styles.actions}>
            <Button variant="primary" size="lg" trailingIcon="arrowRight" onClick={finish} disabled={pending}>
              {pending ? "Saving…" : "Mark as studied"}
            </Button>
            <ButtonLink href={`/s/${data.student_id}/today`} variant="secondary">
              Back to today
            </ButtonLink>
          </div>
        </Surface>
      )}

      {step === "result" && result && <ResultStep data={data} result={result} headingRef={headingRef} />}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Recap cards shown up front (mistakes on the topic itself come first); the rest fold away. */
const RECAP_SHOWN = 3;

function EvidenceItem({ e }: { e: MissionData["recap"][number] }) {
  return (
    <li className={styles.evidenceCard}>
      <p className={styles.evMeta}>
        <Icon name="doc" size={14} /> {e.exam_name} · {e.question_ref}
        {e.marks_lost !== undefined && <> · {plural(Number(marks(e.marks_lost)), "mark")} lost</>}
      </p>
      {e.question_text && (
        <p className={styles.evQuestion}>
          <MathText text={e.question_text} />
        </p>
      )}
      {e.working && (
        <p className={styles.evWorking}>
          <span className={styles.evLabel}>You wrote</span>
          <code>{e.working}</code>
        </p>
      )}
      <blockquote className={styles.evQuote}>
        <span className={styles.evLabel}>The report says</span>
        {e.diagnosis}
      </blockquote>
      {e.correct_approach && (
        <p className={styles.evFix}>
          <span className={styles.evLabel}>The right way</span>
          {e.correct_approach}
        </p>
      )}
    </li>
  );
}

function QuestionStep({
  data,
  index,
  question: q,
  feedback,
  headingRef,
  onAnswered,
  onNext,
  finishing,
  stepNumber,
  answeredMap,
}: {
  data: MissionData;
  index: number;
  question: QuestionView;
  feedback?: FeedbackView;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onAnswered(f: FeedbackView): void;
  onNext(): void;
  finishing: boolean;
  allAnswered: boolean;
  stepNumber: number;
  answeredMap: Record<string, FeedbackView>;
}) {
  const [choice, setChoice] = useState("");
  const [typed, setTyped] = useState("");
  const [invalid, setInvalid] = useState("");
  const [pending, start] = useTransition();
  const feedbackRef = useRef<HTMLDivElement>(null);
  const last = index === data.questions.length - 1;

  useEffect(() => {
    if (feedback) feedbackRef.current?.focus();
  }, [feedback]);

  const check = () => {
    const given = q.kind === "mcq" ? choice : typed.trim();
    if (!given) return;
    if (q.kind === "numeric" && parseNumber(given) === undefined) {
      setInvalid("Type a number, like 12, -3.5 or 3/4.");
      return;
    }
    setInvalid("");
    start(async () => {
      const r = await answerAction(data.student_id, data.id, q.id, given);
      if ("error" in r) setInvalid("Couldn't check that. Try again.");
      else onAnswered(r);
    });
  };

  const chosen = feedback?.chosen ?? choice;
  return (
    <Surface as="section" level={3} pad="lg" className={styles.panel} aria-labelledby="step-title" data-question-id={q.id} data-enter>
      <div className={styles.qTop}>
        <p className={styles.kicker}>
          Step {stepNumber} · Prove it · Question {index + 1} of {data.questions.length}
        </p>
        <ol className={styles.qDots} role="list" aria-hidden="true">
          {data.questions.map((x, i) => {
            const f = answeredMap[x.id];
            return <li key={x.id} className={`${styles.qDot} ${f ? (f.correct ? styles.qRight : styles.qWrong) : ""} ${i === index ? styles.qNow : ""}`} />;
          })}
        </ol>
      </div>
      <h1 id="step-title" ref={headingRef} tabIndex={-1} className={styles.stem}>
        <MathText text={q.stem} />
      </h1>
      {data.card.review_names.length > 1 && <p className={styles.qConcept}>{q.concept_name}</p>}

      {q.kind === "mcq" ? (
        <fieldset className={styles.options} disabled={!!feedback || pending}>
          <legend className="visually-hidden">Choose one answer</legend>
          {q.options!.map((o, i) => {
            const state = feedback
              ? o.id === feedback.correct_option_id
                ? styles.optRight
                : o.id === chosen
                  ? styles.optWrong
                  : styles.optFaded
              : "";
            return (
              <label key={o.id} className={`${styles.option} ${o.id === chosen ? styles.optChosen : ""} ${state}`}>
                <input
                  type="radio"
                  name={`q-${q.id}`}
                  value={o.id}
                  checked={o.id === chosen}
                  onChange={() => setChoice(o.id)}
                  aria-label={`${"ABCDEF"[i]}: ${plainMath(o.text)}`}
                />
                <span className={styles.optLetter} aria-hidden="true">
                  {"ABCDEF"[i]}
                </span>
                <span className={styles.optText}>
                  <MathText text={o.text} />
                </span>
                {feedback && o.id === feedback.correct_option_id && <Icon name="check" size={18} className={styles.optIcon} label="Right answer" />}
              </label>
            );
          })}
        </fieldset>
      ) : (
        <div className={styles.numeric}>
          <label htmlFor={`n-${q.id}`} className={styles.numLabel}>
            Your answer{q.unit ? ` (${q.unit})` : ""}
          </label>
          <div className={styles.numRow}>
            <input
              id={`n-${q.id}`}
              inputMode="decimal"
              autoComplete="off"
              value={feedback ? feedback.chosen : typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") check();
              }}
              disabled={!!feedback || pending}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={invalid ? `n-${q.id}-err` : undefined}
              className={`${styles.numInput} ${feedback ? (feedback.correct ? styles.optRight : styles.optWrong) : ""}`}
            />
            {q.unit && <span className={styles.unit}>{q.unit}</span>}
          </div>
        </div>
      )}
      {invalid && (
        <p id={`n-${q.id}-err`} className={styles.invalid} role="alert">
          {invalid}
        </p>
      )}

      {!feedback ? (
        <div className={styles.actions}>
          <Button variant="primary" size="lg" onClick={check} disabled={pending || (q.kind === "mcq" ? !choice : !typed.trim())}>
            {pending ? "Checking…" : "Check answer"}
          </Button>
        </div>
      ) : (
        <div ref={feedbackRef} tabIndex={-1} className={`${styles.feedback} ${feedback.correct ? styles.fbRight : styles.fbWrong}`} role="status">
          {feedback.correct ? (
            <div className={styles.fbHead}>
              <span className={styles.burst} aria-hidden="true">
                <Icon name="check" size={22} />
                {Array.from({ length: 8 }, (_, i) => (
                  <i key={i} style={{ "--i": i } as React.CSSProperties} />
                ))}
              </span>
              <p className={styles.fbTitle}>{["Spot on.", "Exactly right.", "Nailed it.", "That's it."][index % 4]}</p>
            </div>
          ) : (
            <div className={styles.fbHead}>
              <span className={styles.fbIcon} aria-hidden="true">
                <Icon name="bulb" size={20} />
              </span>
              <div>
                <p className={styles.fbTitle}>Not quite, and here&apos;s exactly why.</p>
                {feedback.misconception && <p className={styles.fbSlip}>The slip: {feedback.misconception.description}</p>}
              </div>
            </div>
          )}
          <p className={styles.fbText}>
            <MathText text={feedback.feedback} />
          </p>
          {!feedback.correct && feedback.correct_display && q.kind === "numeric" && (
            <p className={styles.fbText}>
              The answer is <MathText text={feedback.correct_display} />.
            </p>
          )}
          {feedback.misconception?.yours && (
            <p className={styles.fbYours}>
              <Icon name="doc" size={14} /> Same slip as in your {feedback.misconception.yours.exam_name}, {feedback.misconception.yours.question_ref}. Good to
              catch it here, not in the exam.
            </p>
          )}
          <details className={styles.solution}>
            <summary>Worked solution</summary>
            <p>
              <MathText text={feedback.solution} />
            </p>
          </details>
          <div className={styles.actions}>
            <Button variant="primary" size="lg" trailingIcon="arrowRight" onClick={onNext} disabled={finishing}>
              {last ? (finishing ? "Scoring…" : "See my result") : "Next question"}
            </Button>
          </div>
        </div>
      )}
    </Surface>
  );
}

function ResultStep({ data, result, headingRef }: { data: MissionData; result: ResultView; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  const gate = data.card.kind === "learn" || data.card.kind === "apply";
  const main = result.outcomes[0];
  const right = result.outcomes.reduce((s, o) => s + o.correct, 0);
  const total = result.outcomes.reduce((s, o) => s + o.total, 0);
  const before = result.readiness_before;
  const after = result.readiness_after;
  const delta = before ? after.mid - before.mid : 0;
  const title =
    total === 0
      ? `Studied: ${main?.concept_name}`
      : gate
        ? result.passed
          ? `Proven: ${main?.concept_name}`
          : `Not yet, and that's useful`
        : result.passed
          ? "Still holding. Nice."
          : "Some of it slipped. That's what reviews are for.";
  return (
    <Surface as="section" level={3} pad="lg" className={`${styles.panel} ${styles.result} ${result.passed ? styles.resultWin : ""}`} aria-labelledby="step-title" data-enter>
      {result.passed && (
        <div className={styles.confetti} aria-hidden="true">
          {Array.from({ length: 18 }, (_, i) => (
            <i key={i} style={{ "--i": i } as React.CSSProperties} />
          ))}
        </div>
      )}
      <p className={styles.kicker}>{total === 0 ? "Result · no check yet" : <>Result · {plural(right, "right answer")} of {total}</>}</p>
      <h1 id="step-title" ref={headingRef} tabIndex={-1} className={styles.h1}>
        {title}
      </h1>
      <ul role="list" className={styles.outcomes}>
        {result.outcomes.map((o) => (
          <li key={o.concept_id} className={styles.outcome}>
            <span className={`${styles.outIcon} ${o.passed ? styles.outPass : styles.outFail}`} aria-hidden="true">
              <Icon name={o.passed ? "check" : "repeat"} size={18} />
            </span>
            <div>
              <p className={styles.outName}>{o.concept_name}</p>
              <p className={styles.outReason}>{o.reason}</p>
            </div>
            <span className={styles.outState}>
              {STATE_WORD[o.before] ?? o.before} <Icon name="arrowRight" size={12} /> <strong>{STATE_WORD[o.after] ?? o.after}</strong>
            </span>
          </li>
        ))}
      </ul>
      {!result.passed && gate && <p className={styles.lede}>Your plan already has another go ready, aimed at the slip that showed up. Nothing is lost.</p>}
      <div className={styles.readiness}>
        <p>
          Readiness for the exam:{" "}
          <strong className="tabular">
            {Math.round(after.low)}–{Math.round(after.high)}%
          </strong>{" "}
          <span className={styles.est}>(estimate)</span>
        </p>
        {delta >= 0.1 && <p className={styles.delta}>+{delta.toFixed(1)} points from this mission</p>}
      </div>
      {result.ripple_root && (
        <div className={styles.ripple}>
          <p>
            <strong>{main?.concept_name}</strong> was a root gap. Everything built on it just lit up on your map.
          </p>
          <ButtonLink href={`/s/${data.student_id}/constellation?ripple=${encodeURIComponent(result.ripple_root)}`} variant="primary" size="lg" icon="spark">
            See the chain reaction
          </ButtonLink>
        </div>
      )}
      <div className={styles.actions}>
        <ButtonLink href={`/s/${data.student_id}/today`} variant={result.ripple_root ? "secondary" : "primary"} size="lg" trailingIcon="arrowRight">
          Back to today
        </ButtonLink>
      </div>
      {result.next && (
        <p className={styles.nextUp}>
          Next: <strong>{result.next.title}</strong>
        </p>
      )}
    </Surface>
  );
}
