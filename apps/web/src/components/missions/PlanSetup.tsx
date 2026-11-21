import { createPlan } from "@/app/mission-actions";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Surface } from "@/components/ui/Surface";
import { plural } from "@/lib/format";
import styles from "./PlanSetup.module.css";

const OPTIONS = [
  { minutes: 25, label: "25 min a day", hint: "One mission. The steady option." },
  { minutes: 50, label: "50 min a day", hint: "Two missions. Finishes the new topics in half the time." },
  { minutes: 75, label: "75 min a day", hint: "Three missions. For the final stretch." },
];

/** First visit: when is the exam, and how much time a day. The plan is built from the diagnosis. */
export function PlanSetup({
  studentId,
  defaults,
  roots,
  missions,
}: {
  studentId: string;
  defaults: { exam_name: string; exam_date: string; today: string };
  roots: string[];
  missions: number;
}) {
  const action = createPlan.bind(null, studentId);
  return (
    <div className={`container ${styles.wrap}`}>
      <Surface as="section" level={3} pad="lg" className={styles.card} aria-labelledby="setup-title" data-enter>
        <p className={styles.eyebrow}>
          <Icon name="rocket" size={16} /> Your comeback plan
        </p>
        <h1 id="setup-title" className={styles.title}>
          Two questions, then your plan
        </h1>
        <p className={styles.lede}>
          {roots.length > 0 ? (
            <>
              Built from your diagnosis: fix <strong>{roots.join(" and ")}</strong> first, then use {roots.length === 1 ? "it" : "them"} where
              your mistakes were, in about {plural(missions, "mission")} of 25 minutes, with reviews spaced so it all holds until the exam.
            </>
          ) : (
            <>Built from your diagnosis, in missions of 25 minutes, with reviews spaced so it all holds until the exam.</>
          )}
        </p>
        <form action={action} className={styles.form}>
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>1. Your next exam</legend>
            <div className={styles.row}>
              <label className={styles.field}>
                <span>Exam</span>
                <input name="exam_name" defaultValue={defaults.exam_name} required maxLength={80} />
              </label>
              <label className={styles.field}>
                <span>Date</span>
                <input name="exam_date" type="date" defaultValue={defaults.exam_date} min={defaults.today} required />
              </label>
            </div>
          </fieldset>
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>2. Time you can give each day</legend>
            <div className={styles.options}>
              {OPTIONS.map((o) => (
                <label key={o.minutes} className={styles.option}>
                  <input type="radio" name="daily_minutes" value={o.minutes} defaultChecked={o.minutes === 25} />
                  <span className={styles.optionLabel}>{o.label}</span>
                  <span className={styles.optionHint}>{o.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="submit" variant="primary" size="lg" trailingIcon="arrowRight">
            Build my plan
          </Button>
        </form>
      </Surface>
    </div>
  );
}
