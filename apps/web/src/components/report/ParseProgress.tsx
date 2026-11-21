import { Icon } from "@/components/ui/Icon";
import styles from "./ParseProgress.module.css";

export interface StageState {
  id: string;
  label: string;
  status: "waiting" | "active" | "done" | "failed";
  message?: string;
}

/**
 * Report-reading progress: a document being scanned, beside the list of real
 * parser stages joined by a thread that fills as each one completes.
 */
export function ParseProgress({ stages, running, failed }: { stages: StageState[]; running: boolean; failed: boolean }) {
  const done = stages.filter((s) => s.status === "done").length;
  const active = stages.find((s) => s.status === "active");
  const progress = stages.length ? (done + (active ? 0.5 : 0)) / stages.length : 0;
  const complete = !running && !failed;

  return (
    <div className={styles.wrap} data-complete={complete || undefined} data-failed={failed || undefined}>
      <div className={styles.scanner} aria-hidden="true">
        <div className={styles.page}>
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} className={styles.line} style={{ "--w": `${[92, 70, 84, 40, 88, 76, 60, 82, 52][i]}%`, "--i": i } as React.CSSProperties} />
          ))}
          {running && <span className={styles.sweep} />}
        </div>
        <div className={styles.orb}>
          {complete ? <Icon name="check" size={28} /> : <span className={styles.orbCore} />}
        </div>
      </div>

      <div className={styles.side}>
        <h1 className={styles.title}>{complete ? "Report read" : failed ? "We hit a problem" : "Reading your report"}</h1>
        <div
          className={styles.bar}
          role="progressbar"
          aria-label="Reading progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>
        <ol className={styles.stages} role="list">
          {stages.map((s) => (
            <li key={s.id} className={styles.stage} data-status={s.status}>
              <span className={styles.node} aria-hidden="true">
                {s.status === "done" && <Icon name="check" size={14} />}
                {s.status === "failed" && <Icon name="close" size={14} />}
              </span>
              <span className={styles.text}>
                <span className={styles.label}>
                  {s.label}
                  <span className="visually-hidden">
                    {s.status === "done" ? ", done" : s.status === "active" ? ", in progress" : s.status === "failed" ? ", failed" : ", waiting"}
                  </span>
                </span>
                {s.message && <span className={styles.message}>{s.message}</span>}
              </span>
            </li>
          ))}
        </ol>
        <p className="visually-hidden" aria-live="polite">
          {active ? `${active.label}. ${active.message ?? ""}` : ""}
        </p>
      </div>
    </div>
  );
}
