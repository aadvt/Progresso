import styles from "./StudentAvatar.module.css";

const HUES = [
  ["#3d6ef7", "#16b3a0"],
  ["#6d5df5", "#3d9bf7"],
  ["#16b3a0", "#7cc96b"],
  ["#e0729a", "#8d6cf5"],
  ["#2fa8e0", "#3d6ef7"],
] as const;

/** A glowing orb with the student's initial. Purely decorative; the name is always shown beside it. */
export function StudentAvatar({ name, seed = 0, size = "md" }: { name: string; seed?: number; size?: "sm" | "md" }) {
  const [a, b] = HUES[seed % HUES.length]!;
  return (
    <span
      className={`${styles.avatar} ${styles[size]}`}
      style={{ "--a": a, "--b": b } as React.CSSProperties}
      aria-hidden="true"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
