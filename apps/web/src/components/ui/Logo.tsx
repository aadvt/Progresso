import Link from "next/link";
import styles from "./Logo.module.css";

/** The mark: a root node with a thread of light rising from it. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={styles.mark}>
      <defs>
        <linearGradient id="pg-thread" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#3d6ef7" />
          <stop offset="1" stopColor="#16b3a0" />
        </linearGradient>
        <radialGradient id="pg-orb" cx="0.35" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor="#7ea0ff" />
          <stop offset="1" stopColor="#2453e0" />
        </radialGradient>
      </defs>
      <path d="M9 23 C 13 17, 17 19, 20 12 S 25 6, 27 5" fill="none" stroke="url(#pg-thread)" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="27" cy="5" r="2.2" fill="#16b3a0" />
      <circle cx="9" cy="23" r="6" fill="url(#pg-orb)" />
    </svg>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className={styles.logo} aria-label="Progresso, home">
      <LogoMark />
      <span className={styles.word} aria-hidden="true">
        Progresso
      </span>
    </Link>
  );
}
