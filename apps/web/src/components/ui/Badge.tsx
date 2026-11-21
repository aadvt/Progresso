import type { ReactNode } from "react";
import styles from "./Badge.module.css";

export type BadgeTone = "neutral" | "blue" | "teal" | "amber" | "sample";

export function Badge({
  tone = "neutral",
  dot = false,
  children,
  title,
  className,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span className={`${styles.badge} ${styles[tone]} ${className ?? ""}`} title={title}>
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Shown wherever demo fixtures appear (scope rule 5). */
export function SampleDataBadge({ notice }: { notice?: string }) {
  return (
    <Badge tone="sample" dot title={notice}>
      Sample data
    </Badge>
  );
}
