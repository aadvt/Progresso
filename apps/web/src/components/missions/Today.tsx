import Link from "next/link";
import { demoNextDayAction, demoResetPlanAction } from "@/app/mission-actions";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Surface } from "@/components/ui/Surface";
import type { TodayData } from "@/lib/mission-types";
import { formatDay, plural } from "@/lib/format";
import { MissionCard } from "./MissionCard";
import { ReadinessMeter } from "./ReadinessMeter";
import styles from "./Today.module.css";

const delay = (ms: number) => ({ "--enter-delay": `${ms}ms` }) as React.CSSProperties;

export function Today({ data, studentName }: { data: TodayData; studentName: string }) {
  const open = data.missions.filter((m) => m.status === "today");
  const done = data.missions.filter((m) => m.status === "done");
  const t = data.totals;
  const progress = t.learning_total > 0 ? t.learning_done / t.learning_total : 0;
  const examPassed = data.exam.days_left < 0;
  const isBuffer = data.missions.some((m) => m.kind === "rehearsal");

  let heading: string;
  if (examPassed) heading = `${data.exam.name} has passed`;
  else if (data.exam.days_left === 0) heading = `${data.exam.name} is today. Good luck!`;
  else if (open.length > 0) heading = open.length === 1 ? "Today's mission" : `Today's ${open.length} missions`;
  else if (done.length > 0) heading = "Done for today";
  else heading = "Nothing due today";

  return (
    <div className={`container ${styles.layout}`}>
      <Surface as="section" level={3} pad="lg" className={styles.hero} aria-labelledby="today-title" data-enter>
        <p className={styles.eyebrow}>
          <span>
            <Icon name="sun" size={16} /> {formatDay(data.today)}
          </span>
          {!examPassed && (
            <span>
              <Icon name="flag" size={16} /> {data.exam.name} in <strong className="tabular">{plural(data.exam.days_left, "day")}</strong>
            </span>
          )}
        </p>
        <h1 id="today-title" className={styles.title}>
          {heading}
        </h1>
        {isBuffer && open.length > 0 && <p className={styles.lede}>A buffer day before the exam: no new topics, just making sure everything you fixed holds.</p>}
        {data.habits_only && (
          <p className={styles.lede}>
            Your reports show no knowledge gap to fix, {studentName}: your marks leak through checking habits. The diagnosis lists them
            with a tip for each, and that&apos;s your plan.
          </p>
        )}
        {open.length + done.length > 0 && (
          <ul role="list" className={styles.missions}>
            {[...open, ...done].map((m) => (
              <li key={m.key}>
                <MissionCard studentId={data.student_id} mission={m} size={m.status === "done" ? "sm" : "lg"} />
              </li>
            ))}
          </ul>
        )}
        {open.length === 0 && data.upcoming[0] && (
          <p className={styles.next}>
            Next up: <strong>{data.upcoming[0].title}</strong>, {formatDay(data.upcoming[0].date)}.
          </p>
        )}
        {data.warnings.map((w) => (
          <p key={w} className={styles.warning}>
            <Icon name="alert" size={16} /> {w}
          </p>
        ))}
      </Surface>

      <div className={styles.side}>
        <Surface level={2} pad="md" data-enter style={delay(100)}>
          <ReadinessMeter readiness={data.readiness} examName={data.exam.name} />
        </Surface>
        <Surface as="section" level={1} pad="md" aria-labelledby="progress-title" data-enter style={delay(160)}>
          <h2 id="progress-title" className={styles.sideTitle}>
            Your plan so far
          </h2>
          <div
            className={styles.bar}
            role="progressbar"
            aria-label="Learning missions done"
            aria-valuemin={0}
            aria-valuemax={t.learning_total}
            aria-valuenow={t.learning_done}
          >
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <dl className={styles.stats}>
            <div>
              <dt>Missions done</dt>
              <dd className="tabular">
                {t.learning_done} / {t.learning_total}
              </dd>
            </div>
            <div>
              <dt>Topics proven</dt>
              <dd className="tabular">
                {t.concepts_proven} / {t.concepts_targeted}
              </dd>
            </div>
            <div>
              <dt>Reviews ahead</dt>
              <dd className="tabular">{t.reviews_planned}</dd>
            </div>
            <div>
              <dt>New topics done by</dt>
              <dd className="tabular">{t.projected_finish ? formatDay(t.projected_finish) : "—"}</dd>
            </div>
          </dl>
          <ButtonLink href={`/s/${data.student_id}/plan`} variant="secondary" icon="calendar" block>
            See the whole plan
          </ButtonLink>
        </Surface>
      </div>

      <div className={styles.main}>
        {data.alive.length > 0 && (
          <Surface as="section" level={1} pad="md" aria-labelledby="alive-title" className={styles.alive} data-enter style={delay(200)}>
            <h2 id="alive-title" className={styles.sectionTitle}>
              Still to shake off
            </h2>
            <p className={styles.muted}>Your last checks showed these slips are still around. Your next questions aim at them.</p>
            <ul role="list" className={styles.aliveList}>
              {data.alive.map((a) => (
                <li key={a.id}>
                  <span className={styles.aliveDot} aria-hidden="true" />
                  <span>
                    {a.description} <span className={styles.muted}>· {a.concept}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Surface>
        )}

        {data.upcoming.length > 0 && (
          <section aria-labelledby="upcoming-title" data-enter style={delay(240)}>
            <h2 id="upcoming-title" className={styles.sectionTitle}>
              Coming up
            </h2>
            <ul role="list" className={styles.upcoming}>
              {data.upcoming.map((m) => (
                <li key={`${m.date}-${m.key}`}>
                  <Surface level={1} pad="sm">
                    <MissionCard studentId={data.student_id} mission={m} size="sm" showDate />
                  </Surface>
                </li>
              ))}
            </ul>
            <Link href={`/s/${data.student_id}/plan`} className={styles.textLink}>
              Full timeline to {data.exam.name} <Icon name="arrowRight" size={16} />
            </Link>
          </section>
        )}

        {data.demo && (
          <Surface as="section" level={1} pad="md" className={styles.demo} aria-labelledby="demo-title">
            <h2 id="demo-title" className={styles.sectionTitle}>
              <span className={styles.demoTag}>Demo</span> Try the plan over time
            </h2>
            <p className={styles.muted}>
              Sample student only. Jump to tomorrow to see the plan re-flow: an unfinished mission is marked skipped and everything moves
              up. {data.demo_offset > 0 && `(The clock is ${plural(data.demo_offset, "day")} ahead.)`}
            </p>
            <div className={styles.demoButtons}>
              <form action={demoNextDayAction.bind(null, data.student_id)}>
                <Button type="submit" variant="secondary" icon="arrowRight">
                  Skip to tomorrow
                </Button>
              </form>
              <form action={demoResetPlanAction.bind(null, data.student_id)}>
                <Button type="submit" variant="ghost" icon="repeat">
                  Reset plan
                </Button>
              </form>
            </div>
          </Surface>
        )}
      </div>
    </div>
  );
}
