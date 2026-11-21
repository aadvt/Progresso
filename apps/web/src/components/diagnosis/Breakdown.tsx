import type { DiagnosisView } from "@progresso/core";
import { Surface } from "@/components/ui/Surface";
import { marks } from "@/lib/format";
import styles from "./Breakdown.module.css";

/** Where the errors come from: root gaps vs one-offs vs habits, as one bar. */
export function Breakdown({ view }: { view: DiagnosisView }) {
  const { roots, standalone, habits, total } = view.breakdown;
  const parts = [
    { key: "roots", label: "From root gaps", value: roots, cls: styles.roots },
    { key: "standalone", label: "One-off mistakes", value: standalone, cls: styles.standalone },
    { key: "habits", label: "Slips and habits", value: habits, cls: styles.habits },
  ].filter((p) => p.value > 0);

  return (
    <Surface as="section" level={1} pad="md" aria-labelledby="breakdown-title">
      <h2 id="breakdown-title" className={styles.title}>
        Where your {total} mistakes come from
      </h2>
      <div className={styles.bar} aria-hidden="true">
        {parts.map((p) => (
          <span key={p.key} className={p.cls} style={{ flexGrow: p.value }} />
        ))}
      </div>
      <ul className={styles.legend} role="list">
        {parts.map((p) => (
          <li key={p.key}>
            <span className={`${styles.swatch} ${p.cls}`} aria-hidden="true" />
            <span className={styles.label}>{p.label}</span>
            <span className={`${styles.value} tabular`}>{p.value}</span>
          </li>
        ))}
      </ul>
      <p className={styles.marks}>
        {marks(view.marks.lost_total)} marks lost in all
        {view.marks.explained_by_roots > 0 && <>, {marks(view.marks.explained_by_roots)} of them from root gaps</>}.
        {view.marks.include_estimates && " Some are estimates where the report gave no marks."}
      </p>
    </Surface>
  );
}
