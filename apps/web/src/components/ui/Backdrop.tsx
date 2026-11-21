import styles from "./Backdrop.module.css";

/** The ambient aurora behind every page. Decorative; static under reduced motion. */
export function Backdrop() {
  return (
    <div className={styles.backdrop} aria-hidden="true">
      <div className={`${styles.blob} ${styles.a}`} />
      <div className={`${styles.blob} ${styles.b}`} />
      <div className={`${styles.blob} ${styles.c}`} />
      <div className={styles.grid} />
      <div className={styles.horizon} />
    </div>
  );
}
