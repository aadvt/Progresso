import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Surface } from "@/components/ui/Surface";
import type { PlanData, PlanDayView } from "@/lib/mission-types";
import { formatDate, formatDay, plural } from "@/lib/format";
import { KIND } from "./MissionCard";
import styles from "./PlanTimeline.module.css";

function weekOf(date: string, start: string): number {
  return Math.floor((Date.parse(date) - Date.parse(start)) / (7 * 86_400_000));
}

/** The full timeline to exam day: what's done, today, and every planned mission after. */
export function PlanTimeline({ data }: { data: PlanData }) {
  const first = data.days[0]?.date ?? data.today;
  const weeks = new Map<number, PlanDayView[]>();
  for (const d of data.days) {
    // Days with nothing planned and nothing done (quiet review gaps) are folded away.
    if (d.kind !== "exam" && d.missions.length === 0 && !d.missed && d.date !== data.today) continue;
    const w = weekOf(d.date, first);
    weeks.set(w, [...(weeks.get(w) ?? []), d]);
  }
  const t = data.totals;
  return (
    <div className={`container ${styles.layout}`}>
      <Surface as="header" level={3} pad="lg" className={styles.hero} data-enter>
        <p className={styles.eyebrow}>
          <Icon name="calendar" size={16} /> Your comeback plan · {data.daily_minutes} min a day
        </p>
        <h1 className={styles.title}>
          {plural(data.exam.days_left, "day")} to {data.exam.name}
        </h1>
        <dl className={styles.summary}>
          <div>
            <dt>Learning missions</dt>
            <dd className="tabular">
              {t.learning_done} done · {t.learning_total - t.learning_done - t.unscheduled} to go
            </dd>
          </div>
          <div>
            <dt>Topics proven</dt>
            <dd className="tabular">
              {t.concepts_proven} of {t.concepts_targeted}
            </dd>
          </div>
          <div>
            <dt>Spaced reviews</dt>
            <dd className="tabular">{t.reviews_planned}</dd>
          </div>
          <div>
            <dt>Buffer before the exam</dt>
            <dd className="tabular">{plural(t.buffer_days, "day")}</dd>
          </div>
        </dl>
        <p className={styles.how}>
          Roots first, highest marks per hour, deepest first; then the topics where your mistakes showed up. Reviews come back on the
          day your memory needs them. Fall behind or prove something early and the plan re-flows by itself.
        </p>
        {data.warnings.map((w) => (
          <p key={w} className={styles.warning}>
            <Icon name="alert" size={16} /> {w}
          </p>
        ))}
      </Surface>

      <ol className={styles.weeks} role="list">
        {[...weeks.entries()].map(([w, days]) => (
          <li key={w} className={styles.week}>
            <h2 className={styles.weekTitle}>
              Week {w + 1} <span>{formatDate(days[0]!.date)}</span>
            </h2>
            <ol role="list" className={styles.days}>
              {days.map((d) => (
                <li
                  key={d.date}
                  className={`${styles.day} ${styles[d.kind]} ${d.date === data.today ? styles.today : ""}`}
                  aria-current={d.date === data.today ? "date" : undefined}
                >
                  <div className={styles.date}>
                    <span className={styles.dateText}>{formatDay(d.date)}</span>
                    {d.date === data.today && <Badge tone="blue">Today</Badge>}
                    {d.kind === "buffer" && <Badge tone="amber">Buffer</Badge>}
                  </div>
                  <div className={styles.dayBody}>
                    {d.kind === "exam" ? (
                      <p className={styles.examLabel}>
                        <Icon name="flag" size={18} /> {data.exam.name}
                      </p>
                    ) : d.missed ? (
                      <p className={styles.missed}>{d.missions.length > 0 ? "Started, not finished: moved to a later day" : "Missed: the plan moved everything up"}</p>
                    ) : (
                      <ul role="list" className={styles.missions}>
                        {d.missions.map((m) => {
                          const k = KIND[m.kind];
                          return (
                            <li key={m.key} className={`${styles.mission} ${styles[m.kind]} ${m.status === "done" ? styles.done : ""} ${m.status === "skipped" ? styles.skipped : ""}`}>
                              <Icon name={m.status === "done" ? "check" : k.icon} size={16} />
                              <span className={styles.missionTitle}>{m.title}</span>
                              <span className={styles.missionMeta}>
                                {m.status === "done" ? (m.passed === false ? "done · not yet" : "done") : m.status === "skipped" ? "skipped" : `${m.minutes} min`}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>

      {(data.unscheduled.length > 0 || data.not_covered.length > 0) && (
        <Surface as="section" level={1} pad="md" aria-labelledby="left-out" className={styles.left}>
          <h2 id="left-out" className={styles.weekTitle}>
            Not in the plan
          </h2>
          <ul role="list" className={styles.leftList}>
            {data.unscheduled.map((u, i) => (
              <li key={`u${i}`}>
                {u.title} <span>· doesn&apos;t fit before the exam</span>
              </li>
            ))}
            {data.not_covered.map((n) => (
              <li key={n.question_ref}>
                {n.question_ref} <span>· {n.reason}</span>
              </li>
            ))}
          </ul>
        </Surface>
      )}
    </div>
  );
}
