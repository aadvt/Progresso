import type { ReactNode } from "react";
import { Logo } from "./Logo";
import styles from "./TopBar.module.css";

/** Sticky glass bar: logo left, context (student, badges, actions) right. */
export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className={styles.bar}>
      <div className={`container ${styles.inner}`}>
        <Logo />
        <div className={styles.right}>{children}</div>
      </div>
    </header>
  );
}
