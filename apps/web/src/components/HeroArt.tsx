import styles from "./HeroArt.module.css";

/** Branch end points (topics built on the root) and the mistakes that surface in each. */
const BRANCHES = [
  { d: "M90 300 C 140 250, 150 170, 230 140", x: 230, y: 140, marks: [[300, 96], [318, 140], [300, 184]] },
  { d: "M90 300 C 170 300, 200 250, 270 250", x: 270, y: 250, marks: [[340, 226], [350, 270]] },
  { d: "M90 300 C 110 220, 120 120, 160 64", x: 160, y: 64, marks: [[222, 36], [232, 76]] },
] as const;

/**
 * Landing illustration of the core idea: one root gap at the bottom, threads of
 * light to the topics built on it, and the mistakes that surface there.
 * Decorative and data-free.
 */
export function HeroArt() {
  return (
    <div className={styles.art} aria-hidden="true">
      <svg viewBox="0 0 400 340" className={styles.svg}>
        <defs>
          <linearGradient id="ha-thread" x1="0" y1="1" x2="1" y2="0" gradientUnits="objectBoundingBox">
            <stop offset="0" stopColor="#3d6ef7" />
            <stop offset="1" stopColor="#16b3a0" />
          </linearGradient>
          <radialGradient id="ha-orb" cx="0.35" cy="0.32" r="0.8">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.3" stopColor="#8fb0ff" />
            <stop offset="1" stopColor="#2453e0" />
          </radialGradient>
          <radialGradient id="ha-halo">
            <stop offset="0" stopColor="#3d6ef7" stopOpacity="0.35" />
            <stop offset="1" stopColor="#3d6ef7" stopOpacity="0" />
          </radialGradient>
        </defs>

        {BRANCHES.map((b, i) => (
          <g key={i}>
            {b.marks.map(([mx, my], j) => (
              <line key={j} x1={b.x} y1={b.y} x2={mx} y2={my} className={styles.twig} style={{ animationDelay: `${900 + i * 200 + j * 90}ms` }} />
            ))}
            <path d={b.d} className={styles.thread} pathLength={1} style={{ animationDelay: `${300 + i * 200}ms` }} />
          </g>
        ))}

        {BRANCHES.map((b, i) => (
          <g key={`n${i}`} className={styles.pop} style={{ animationDelay: `${700 + i * 200}ms` }}>
            <circle cx={b.x} cy={b.y} r="9" fill="#fff" stroke="#3d6ef7" strokeWidth="3" />
            {b.marks.map(([mx, my], j) => (
              <g key={j} className={styles.mistake} style={{ animationDelay: `${1100 + i * 200 + j * 90}ms` }}>
                <circle cx={mx} cy={my} r="11" fill="#fff" stroke="rgb(10 26 47 / 0.12)" />
                <path d={`M${mx - 4} ${my - 4} L${mx + 4} ${my + 4} M${mx + 4} ${my - 4} L${mx - 4} ${my + 4}`} stroke="#c2410c" strokeWidth="2" strokeLinecap="round" />
              </g>
            ))}
          </g>
        ))}

        <circle cx="90" cy="300" r="60" fill="url(#ha-halo)" className={styles.halo} />
        <circle cx="90" cy="300" r="22" fill="url(#ha-orb)" />
      </svg>
      <span className={`${styles.tag} ${styles.tagRoot}`}>One root gap</span>
      <span className={`${styles.tag} ${styles.tagMistakes}`}>…behind the mistakes in many topics</span>
    </div>
  );
}
