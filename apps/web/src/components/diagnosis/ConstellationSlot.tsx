import { Surface } from "@/components/ui/Surface";
import styles from "./ConstellationSlot.module.css";

/** Small deterministic PRNG so the star field is identical on server and client. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STARS = (() => {
  const r = rng(11);
  return Array.from({ length: 70 }, () => ({ x: r() * 400, y: r() * 260, s: 0.5 + r() * 1.3, o: 0.25 + r() * 0.6, d: r() * 4 }));
})();

/** Where the root stars sit; the 3D constellation (Phase 4) replaces all of this. */
const ROOT_SPOTS = [
  { x: 150, y: 78 },
  { x: 272, y: 58 },
  { x: 240, y: 122 },
  { x: 96, y: 132 },
];

/**
 * Layout slot for the 3D knowledge constellation (Phase 4). Today it shows a
 * static preview: a decorative star field with the student's root gaps as the
 * bright stars. The slot keeps its size so Phase 4 can drop the scene in.
 */
export function ConstellationSlot({ roots }: { roots: { id: string; name: string }[] }) {
  const lit = roots.slice(0, ROOT_SPOTS.length).map((r, i) => ({ ...r, ...ROOT_SPOTS[i]! }));
  // Faint links from each root to nearby stars, to hint at the graph.
  const links = lit.flatMap((root, i) =>
    STARS.map((s, j) => ({ s, j, d: Math.hypot(s.x - root.x, s.y - root.y) }))
      .filter((x) => x.d < 70)
      .slice(0, 5)
      .map((x) => ({ key: `${i}-${x.j}`, x1: root.x, y1: root.y, x2: x.s.x, y2: x.s.y })),
  );

  return (
    <Surface as="section" level={2} pad="none" className={styles.slot} data-slot="constellation" aria-labelledby="constellation-title">
      <svg className={styles.sky} viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <radialGradient id="cs-glow">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.35" stopColor="#8fb0ff" stopOpacity="0.9" />
            <stop offset="1" stopColor="#3d6ef7" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="cs-link" x1="0" x2="1">
            <stop offset="0" stopColor="#7fa2ff" />
            <stop offset="1" stopColor="#5fe0cf" />
          </linearGradient>
        </defs>
        {links.map((l) => (
          <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="url(#cs-link)" strokeOpacity="0.35" strokeWidth="0.8" />
        ))}
        {STARS.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.s} fill="#dfe8ff" opacity={s.o} className={styles.twinkle} style={{ animationDelay: `${s.d}s` }} />
        ))}
        {lit.map((r) => (
          <g key={r.id}>
            <circle cx={r.x} cy={r.y} r="18" fill="url(#cs-glow)" className={styles.glow} />
            <circle cx={r.x} cy={r.y} r="3.2" fill="#fff" />
          </g>
        ))}
      </svg>
      <div className={styles.labels} aria-hidden="true">
        {lit.map((r) => (
          <span key={r.id} className={styles.starLabel} style={{ left: `${(r.x / 400) * 100}%`, top: `${(r.y / 260) * 100}%` }}>
            {r.name}
          </span>
        ))}
      </div>
      <div className={styles.caption}>
        <h2 id="constellation-title" className={styles.title}>
          Your knowledge constellation
        </h2>
        <p className={styles.soon}>
          <span className={styles.soonTag}>Coming soon</span>
          {lit.length > 0 ? "A 3D map of your syllabus. Your root gaps are the bright stars." : "A 3D map of your syllabus."}
        </p>
      </div>
    </Surface>
  );
}
