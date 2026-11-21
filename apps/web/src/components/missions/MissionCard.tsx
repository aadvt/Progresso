import { startMissionAction } from "@/app/mission-actions";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { MissionCard as Card } from "@/lib/mission-types";
import { formatDay } from "@/lib/format";
import styles from "./MissionCard.module.css";

export const KIND: Record<Card["kind"], { label: string; tone: BadgeTone; icon: IconName }> = {
  learn: { label: "Fix", tone: "blue", icon: "target" },
  apply: { label: "Apply", tone: "teal", icon: "layers" },
  review: { label: "Review", tone: "neutral", icon: "repeat" },
  rehearsal: { label: "Rehearsal", tone: "amber", icon: "flag" },
};

/** A mission: what it is, why now, its fixed structure, and a way in. */
export function MissionCard({ studentId, mission, size = "lg", showDate = false }: { studentId: string; mission: Card; size?: "lg" | "sm"; showDate?: boolean }) {
  const k = KIND[mission.kind];
  const done = mission.status === "done";
  const startable = mission.status === "today";
  const start = startMissionAction.bind(null, studentId, mission.key);
  return (
    <article className={`${styles.card} ${styles[size]} ${done ? styles.done : ""}`} aria-label={mission.title}>
      <div className={styles.top}>
        <Badge tone={k.tone}>
          <Icon name={k.icon} size={14} />
          {k.label}
        </Badge>
        <span className={styles.meta}>
          {showDate && <>{formatDay(mission.date)} · </>}
          <Icon name="clock" size={14} /> {mission.minutes} min
        </span>
        {done && (
          <Badge tone={mission.passed === false ? "amber" : "teal"}>
            <Icon name="check" size={14} />
            {mission.passed === false ? "Done · not yet proven" : "Done"}
          </Badge>
        )}
      </div>
      <h3 className={styles.title}>{mission.title}</h3>
      <p className={styles.subtitle}>
        {mission.subtitle}
        {mission.review_names.length > 1 && <>: {mission.review_names.join(", ")}</>}
      </p>
      {size === "lg" && (
        <>
          <p className={styles.reason}>{mission.reason}</p>
          <ol className={styles.steps} role="list" aria-label="Mission steps">
            {mission.steps.map((s, i) => (
              <li key={s.kind} className={styles.step}>
                <span className={styles.stepNum} aria-hidden="true">
                  {i + 1}
                </span>
                <span className={styles.stepLabel}>{s.label}</span>
                <span className={styles.stepMin}>{s.minutes} min</span>
              </li>
            ))}
          </ol>
          {mission.needs_help && (
            <p className={styles.help}>
              <Icon name="info" size={16} /> This one keeps slipping. Worth asking a teacher to go through it with you.
            </p>
          )}
          {startable && (
            <form action={start} className={styles.cta}>
              <Button type="submit" variant="primary" size="lg" trailingIcon="arrowRight">
                {mission.stored_id ? "Continue mission" : "Start mission"}
              </Button>
            </form>
          )}
        </>
      )}
    </article>
  );
}
