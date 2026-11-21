import type { HabitView, StandaloneView } from "@progresso/core";
import { Icon } from "@/components/ui/Icon";
import { Surface } from "@/components/ui/Surface";
import { marks, plural } from "@/lib/format";
import { EvidenceCard } from "./EvidenceCard";
import styles from "./Sections.module.css";

/** Errors no shared root explains: each is its own small fix. */
export function StandaloneSection({ items }: { items: StandaloneView[] }) {
  const total = items.reduce((s, i) => s + i.marks.value, 0);
  return (
    <section aria-labelledby="standalone-title" className={styles.section}>
      <header className={styles.head}>
        <span className={`${styles.icon} ${styles.slate}`} aria-hidden="true">
          <Icon name="target" size={20} />
        </span>
        <div>
          <h2 id="standalone-title" className={styles.title}>
            One-off mistakes
          </h2>
          <p className={styles.lede}>
            {plural(items.length, "mistake")} with nothing else pointing the same way, {marks(total)} {total === 1 ? "mark" : "marks"}{" "}
            in all. Each is a quick, separate fix.
          </p>
        </div>
      </header>
      <ul className={styles.grid} role="list">
        {items.map((s) => (
          <Surface as="li" key={s.evidence.record_id} level={1} pad="none" className={styles.item}>
            <p className={styles.topic}>
              {s.concept ? s.concept.name : "Topic not in our syllabus map yet"}
              {s.concept && <span className={styles.topicMeta}>Class {s.concept.class}</span>}
            </p>
            <EvidenceCard as="div" evidence={s.evidence} marks={s.marks} compact />
          </Surface>
        ))}
      </ul>
    </section>
  );
}

/** Careless slips, notation and other checking habits: not knowledge gaps. */
export function HabitsSection({ habits }: { habits: HabitView[] }) {
  const count = habits.reduce((s, h) => s + h.items.length, 0);
  return (
    <section aria-labelledby="habits-title" className={styles.section}>
      <header className={styles.head}>
        <span className={`${styles.icon} ${styles.amber}`} aria-hidden="true">
          <Icon name="repeat" size={20} />
        </span>
        <div>
          <h2 id="habits-title" className={styles.title}>
            Slips and habits
          </h2>
          <p className={styles.lede}>
            {plural(count, "mistake")} where you knew the idea but lost marks in the checking. A habit fixes these, not more study.
          </p>
        </div>
      </header>
      <ul className={styles.habits} role="list">
        {habits.map((h) => (
          <Surface as="li" key={`${h.kind}-${h.label}`} level={1} pad="md" className={styles.habit}>
            <div className={styles.habitHead}>
              <h3 className={styles.habitTitle}>{h.label}</h3>
              <span className={styles.habitCount}>
                {h.items.length}× · {h.marks_estimated ? "~" : ""}
                {marks(h.marks_lost)} {h.marks_lost === 1 ? "mark" : "marks"}
              </span>
            </div>
            {h.tip && (
              <p className={styles.tip}>
                <span className={styles.tipLabel}>Try this</span>
                {h.tip}
              </p>
            )}
            <details className={styles.habitMore}>
              <summary>See the {plural(h.items.length, "mistake")}</summary>
              <ul className={styles.habitItems} role="list">
                {h.items.map((i) => (
                  <EvidenceCard key={i.evidence.record_id} evidence={i.evidence} marks={i.marks} compact />
                ))}
              </ul>
            </details>
          </Surface>
        ))}
      </ul>
    </section>
  );
}
