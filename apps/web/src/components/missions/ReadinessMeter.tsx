import type { Readiness, ScoreRange } from "@progresso/core/missions/client";
import { Badge } from "@/components/ui/Badge";
import styles from "./ReadinessMeter.module.css";

const pct = (n: number) => `${Math.round(n)}%`;
const range = (r: ScoreRange) => (Math.round(r.low) === Math.round(r.high) ? pct(r.mid) : `${Math.round(r.low)}–${pct(r.high)}`);

/**
 * Projected score for the next exam, as ranges: where the reports put you
 * (start), where you are now, and where finishing the plan should get you.
 * Always a range, always labelled as an estimate.
 */
export function ReadinessMeter({ readiness, examName, compact = false }: { readiness: Readiness; examName: string; compact?: boolean }) {
  const { start, now, potential } = readiness;
  const lo = Math.max(0, Math.floor((Math.min(start.low, now.low) - 4) / 5) * 5);
  const hi = 100;
  const x = (v: number) => `${((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100}%`;
  const band = (r: ScoreRange) => ({ left: x(r.low), width: `calc(${x(r.high)} - ${x(r.low)})` });
  const gained = now.mid - start.mid;
  return (
    <section className={`${styles.meter} ${compact ? styles.compact : ""}`} aria-labelledby="readiness-title">
      <header className={styles.head}>
        <h2 id="readiness-title" className={styles.title}>
          Readiness for {examName}
        </h2>
        <Badge tone="neutral">Estimate</Badge>
      </header>
      <p className={styles.big}>
        <span className="tabular">{range(now)}</span>
        <span className={styles.bigLabel}>projected score</span>
      </p>
      {gained >= 0.5 && (
        <p className={styles.gain}>
          <span className="tabular">+{gained.toFixed(1)}</span> points since you started
        </p>
      )}
      <div className={styles.track} aria-hidden="true">
        <div className={styles.scale}>
          {Array.from({ length: (hi - lo) / 5 + 1 }, (_, i) => lo + i * 5).map((v) => (
            <span key={v} className={styles.tick} style={{ left: x(v) }}>
              {v % 10 === 0 ? v : ""}
            </span>
          ))}
        </div>
        <div className={styles.bands}>
          <span className={`${styles.band} ${styles.potential}`} style={band(potential)} />
          <span className={`${styles.band} ${styles.start}`} style={band(start)} />
          <span className={`${styles.band} ${styles.now}`} style={band(now)} />
          <span className={styles.mid} style={{ left: x(now.mid) }} />
        </div>
      </div>
      <dl className={styles.legend}>
        <div>
          <dt>
            <span className={`${styles.key} ${styles.start}`} aria-hidden="true" />
            When you started
          </dt>
          <dd className="tabular">{range(start)}</dd>
        </div>
        <div>
          <dt>
            <span className={`${styles.key} ${styles.now}`} aria-hidden="true" />
            Now
          </dt>
          <dd className="tabular">{range(now)}</dd>
        </div>
        <div>
          <dt>
            <span className={`${styles.key} ${styles.potential}`} aria-hidden="true" />
            If you finish the plan
          </dt>
          <dd className="tabular">{range(potential)}</dd>
        </div>
      </dl>
      {!compact && (
        <ul className={styles.notes} role="list">
          {readiness.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
