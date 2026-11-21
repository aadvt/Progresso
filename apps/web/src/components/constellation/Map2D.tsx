"use client";

/**
 * The 2D constellation: the same layout seen from above, drawn in SVG. Used
 * when WebGL is missing, the device is weak, or the 3D scene can't keep up.
 * The ripple is CSS transitions with per-star delays, so it costs almost nothing.
 */
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { rippleHops, STATE_LABEL, type ConstellationModel, type ConstellationNode } from "@progresso/core/constellation/client";
import { starLook, unitLabel, type Palette } from "./appearance";
import type { RendererApi } from "./types";
import styles from "./Map2D.module.css";

const HOP_SECONDS = 0.42;
const ROOT_STAGGER = 0.7;

const PAD = 14;
const viewBoxOf = (m: ConstellationModel) => ({
  x: m.bounds.minX - PAD,
  y: m.bounds.minY - PAD,
  w: m.bounds.maxX - m.bounds.minX + PAD * 2,
  h: m.bounds.maxY - m.bounds.minY + PAD * 2,
});

interface View {
  k: number;
  tx: number;
  ty: number;
}

interface Ripple {
  nonce: number;
  arrival: Map<number, number>;
  roots: number[];
  edgeStart: Map<number, number>;
  shock: { x: number; y: number; r: number; delay: number }[];
}

export function Map2D({
  model,
  palette,
  embedded,
  reducedMotion,
  selectedId,
  onSelect,
  onActivate,
  apiRef,
}: {
  model: ConstellationModel;
  palette: Palette;
  embedded: boolean;
  reducedMotion: boolean;
  selectedId: string | null;
  onSelect(id: string | null): void;
  onActivate?(): void;
  apiRef: Ref<RendererApi>;
}) {
  const [shown, setShown] = useState(model);
  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [ripple, setRipple] = useState<Ripple | null>(null);
  const [focusSet, setFocusSet] = useState<Set<number> | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const shownRef = useRef(shown);
  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);

  const vb = viewBoxOf(shown);

  const fitTo = (idx: number[], m: ConstellationModel) => {
    if (idx.length === 0) return setView({ k: 1, tx: 0, ty: 0 });
    const xs = idx.map((i) => m.nodes[i]!.x);
    const ys = idx.map((i) => m.nodes[i]!.y);
    // Never zoom into less than ~70 units of map: a lone star needs its neighbourhood.
    const cx0 = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy0 = (Math.min(...ys) + Math.max(...ys)) / 2;
    const minX = Math.min(Math.min(...xs) - 16, cx0 - 35);
    const maxX = Math.max(Math.max(...xs) + 16, cx0 + 35);
    const minY = Math.min(Math.min(...ys) - 16, cy0 - 35);
    const maxY = Math.max(Math.max(...ys) + 20, cy0 + 35);
    const v = viewBoxOf(m);
    const k = Math.min(3, Math.max(1, Math.min(v.w / (maxX - minX), v.h / (maxY - minY))));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    // Keep (cx, cy) at the centre of the viewBox after scaling about its centre.
    const vcx = v.x + v.w / 2;
    const vcy = v.y + v.h / 2;
    setView({ k, tx: (vcx - cx) * k, ty: (vcy - cy) * k });
  };

  useImperativeHandle(apiRef, () => ({
    setModel(m) {
      setRipple(null);
      setShown(m);
    },
    ripple({ roots, to }) {
      const from = shownRef.current;
      const index = new Map(from.nodes.map((n, i) => [n.id, i]));
      const rootIdx = roots.map((r) => index.get(r)).filter((i): i is number => i !== undefined);
      const arrival = new Map<number, number>();
      rootIdx.forEach((r, k) => {
        for (const [i, hop] of rippleHops(from, r)) arrival.set(i, Math.min(arrival.get(i) ?? Infinity, k * ROOT_STAGGER + hop * HOP_SECONDS));
      });
      const edgeStart = new Map<number, number>();
      from.edges.forEach((e, ei) => {
        const a = arrival.get(e.from);
        const b = arrival.get(e.to);
        if (a !== undefined && b !== undefined && b > a) edgeStart.set(ei, a);
      });
      const shock = rootIdx.map((r, k) => {
        const n = from.nodes[r]!;
        const s = from.subjects.find((x) => x.name === n.subject);
        return { x: n.x, y: n.y, r: (s?.radius ?? 80) * 1.1, delay: k * ROOT_STAGGER };
      });
      setFocusSet(null);
      setRipple(reducedMotion ? null : { nonce: Date.now(), arrival, roots: rootIdx, edgeStart, shock });
      setShown(to);
      const reach = [...arrival.keys()];
      if (!reducedMotion && reach.length > 0) fitTo(reach, from);
    },
    select(id) {
      const m = shownRef.current;
      const i = m.nodes.findIndex((n) => n.id === id);
      if (i < 0) {
        setFocusSet(null);
        return;
      }
      const n = m.nodes[i]!;
      const set = new Set<number>([i, ...n.prerequisites, ...n.dependents]);
      if (n.root_rank !== undefined) m.nodes.forEach((x, j) => x.root_ids.includes(n.id) && set.add(j));
      setFocusSet(set);
      fitTo([...set], m);
    },
    showRoots() {
      const m = shownRef.current;
      const focus = m.nodes.map((n, i) => (n.root_ids.length > 0 || n.root_rank !== undefined ? i : -1)).filter((i) => i >= 0);
      const weak = m.nodes.map((n, i) => (n.state === "weak" ? i : -1)).filter((i) => i >= 0);
      setFocusSet(focus.length > 0 ? new Set(focus) : null);
      fitTo(focus.length > 0 ? focus : weak, m);
    },
    overview() {
      setFocusSet(null);
      setView({ k: 1, tx: 0, ty: 0 });
    },
  }));

  // Clear ripple decorations once the light has passed.
  useEffect(() => {
    if (!ripple) return;
    const max = Math.max(0, ...ripple.arrival.values());
    const t = window.setTimeout(() => setRipple((r) => (r?.nonce === ripple.nonce ? null : r)), (max + 2.2) * 1000);
    return () => window.clearTimeout(t);
  }, [ripple]);

  // ---- pan & zoom (drag, wheel, pinch)
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; star: string | null; start?: { x: number; y: number }; dist?: number } | null>(null);
  const toSvgScale = () => {
    const el = svgRef.current;
    if (!el) return 1;
    const r = el.getBoundingClientRect();
    const v = viewBoxOf(shownRef.current);
    return Math.max(v.w / r.width, v.h / r.height);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (embedded) return;
    const star = (e.target as Element).closest("[data-star]")?.getAttribute("data-star") ?? null;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    gesture.current = { moved: false, star, start: { x: e.clientX, y: e.clientY } };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !gesture.current) return;
    const s = toSvgScale();
    if (pointers.current.size === 2 && gesture.current.dist) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const f = d / gesture.current.dist;
      gesture.current.dist = d;
      gesture.current.moved = true;
      setView((v) => ({ ...v, k: Math.min(6, Math.max(0.6, v.k * f)) }));
      return;
    }
    const dx = (e.clientX - prev.x) * s;
    const dy = (e.clientY - prev.y) * s;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const st = gesture.current.start!;
    if (Math.hypot(e.clientX - st.x, e.clientY - st.y) > 5) gesture.current.moved = true;
    if (gesture.current.moved) setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 0) gesture.current = null;
    if (embedded) {
      onActivate?.();
      return;
    }
    if (g && !g.moved) onSelect(g.star);
  };
  useEffect(() => {
    const el = svgRef.current;
    if (!el || embedded) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0015);
      setView((v) => ({ ...v, k: Math.min(6, Math.max(0.6, v.k * f)) }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [embedded]);

  const looks = useMemo(() => shown.nodes.map((n) => starLook(n, palette)), [shown, palette]);
  const unitHue = useMemo(() => new Map(shown.units.map((u) => [u.id, u.hue])), [shown]);
  const selectedIdx = selectedId ? shown.nodes.findIndex((n) => n.id === selectedId) : -1;
  const dim = (i: number) => (focusSet && !focusSet.has(i) ? 0.34 : 1);

  const vcx = vb.x + vb.w / 2;
  const vcy = vb.y + vb.h / 2;
  const transform = `translate(${view.tx} ${view.ty}) translate(${vcx} ${vcy}) scale(${view.k}) translate(${-vcx} ${-vcy})`;
  const labelScale = 1 / Math.sqrt(view.k);

  const fillFor = (n: ConstellationNode, tint: number): string => {
    const look = starLook(n, palette);
    if (tint > 0 && look.tint > 0) return `hsl(${unitHue.get(n.unit_id) ?? 222} 45% 70%)`;
    return look.color;
  };

  const labelled = shown.nodes
    .map((n, i) => ({ n, i }))
    .filter(({ n, i }) => n.root_rank !== undefined || i === selectedIdx || n.id === hover || (focusSet?.has(i) && !embedded && view.k > 1.6));

  return (
    <svg
      ref={svgRef}
      className={`${styles.svg} ${embedded ? styles.embedded : ""} ${reducedMotion ? styles.still : ""}`}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      data-renderer="2d"
    >
      <defs>
        {(["root", "weak", "learning", "mastered", "lit", "unassessed"] as const).map((k) => (
          <radialGradient key={k} id={`m2d-glow-${k}`}>
            <stop offset="0" stopColor={palette[k]} stopOpacity="0.9" />
            <stop offset="0.35" stopColor={palette[k]} stopOpacity="0.35" />
            <stop offset="1" stopColor={palette[k]} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      <g transform={transform} className={styles.world}>
        {shown.subjects.map((s) => (
          <g key={s.name}>
            <circle cx={s.center.x} cy={s.center.y} r={s.radius * 1.15} className={styles.nebula} />
            {s.rings.map((r) => (
              <circle key={r.label} cx={s.center.x} cy={s.center.y} r={r.outer + 0.8} className={styles.ring} />
            ))}
            <text x={s.center.x} y={s.center.y - s.radius - 3} className={styles.subjectLabel} style={{ fontSize: 7 * labelScale }}>
              {s.name}
            </text>
          </g>
        ))}
        {shown.units.map((u) => {
          if (u.half_width >= Math.PI - 0.01) return null;
          const s = shown.subjects.find((x) => x.name === u.subject)!;
          const r = s.rings[u.ring]!.outer + 2.2;
          const a0 = u.angle - u.half_width + 0.02;
          const a1 = u.angle + u.half_width - 0.02;
          const p = (a: number) => `${s.center.x + r * Math.cos(a)} ${s.center.y + r * Math.sin(a)}`;
          return (
            <path
              key={u.id}
              d={`M ${p(a0)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`}
              className={styles.arc}
              style={{ stroke: `hsl(${u.hue} 60% 66%)` }}
            />
          );
        })}

        {shown.edges.map((e, ei) => {
          const a = shown.nodes[e.from]!;
          const b = shown.nodes[e.to]!;
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = `M ${a.x} ${a.y} Q ${mx - dy * 0.12} ${my + dx * 0.12} ${b.x} ${b.y}`;
          const flow = e.chain && (a.state === "root" || a.state === "weak" || b.state === "weak");
          const fixed = (a.state === "mastered" || a.lit) && (b.lit || b.state === "mastered");
          const kind = flow ? styles.chain : fixed ? styles.litEdge : styles.edge;
          const on = !focusSet || (focusSet.has(e.from) && focusSet.has(e.to));
          const start = ripple?.edgeStart.get(ei);
          return (
            <g key={ei} opacity={focusSet ? (on ? 1 : 0.2) : 1}>
              <path d={d} className={kind} pathLength={1} />
              {start !== undefined && (
                <path
                  key={ripple!.nonce}
                  d={d}
                  pathLength={1}
                  className={styles.rippleEdge}
                  style={{ animationDelay: `${start}s`, animationDuration: `${HOP_SECONDS}s` }}
                />
              )}
            </g>
          );
        })}

        {ripple?.shock.map((s, k) => (
          <circle
            key={`${ripple.nonce}-${k}`}
            cx={s.x}
            cy={s.y}
            r={s.r}
            className={styles.shock}
            style={{ animationDelay: `${s.delay}s`, transformOrigin: `${s.x}px ${s.y}px` }}
          />
        ))}

        {shown.nodes.map((n, i) => {
          const look = looks[i]!;
          const arr = ripple?.arrival.get(i);
          const delay = arr !== undefined ? `${arr}s` : "0s";
          const glowKey = n.state === "unassessed" ? (n.lit ? "lit" : "unassessed") : n.state;
          return (
            <g
              key={n.id}
              transform={`translate(${n.x} ${n.y})`}
              data-star={n.id}
              className={styles.star}
              opacity={dim(i)}
              style={{ "--d": delay } as React.CSSProperties}
            >
              <circle r={look.size * 0.95} fill={`url(#m2d-glow-${glowKey})`} className={styles.glow} opacity={Math.min(1, look.bright)} />
              {n.state === "root" && (
                <>
                  <circle r={2.4} className={styles.pulse} style={{ stroke: palette.root }} />
                  <circle r={2.4} className={`${styles.pulse} ${styles.pulseLate}`} style={{ stroke: palette.root }} />
                </>
              )}
              {n.state === "mastered" && <circle r={look.size * 0.5} className={styles.halo} style={{ stroke: palette.mastered }} />}
              <circle r={Math.max(0.75, look.size * (n.state === "root" ? 0.2 : 0.24))} fill={fillFor(n, 1)} className={styles.core} />
              {arr !== undefined && <circle key={ripple!.nonce} r={look.size * 1.4} className={styles.flash} />}
              <circle r={Math.max(3.2, look.size * 0.6)} className={styles.hit} onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(null)} />
            </g>
          );
        })}

        {!embedded &&
          shown.units.map((u) => (
            <text
              key={u.id}
              x={u.label.x}
              y={u.label.y}
              className={styles.unitLabel}
              style={{ fontSize: 3.6 * labelScale }}
              opacity={view.k > 1.3 || u.concept_count >= 4 ? 1 : 0}
            >
              {(() => {
                const t = unitLabel(u, shown.units);
                return t.length > 26 ? `${t.slice(0, 24)}…` : t;
              })()}
            </text>
          ))}

        {labelled.map(({ n, i }) => {
          const title = n.name;
          const sub = n.root_rank !== undefined && n.state === "root" ? `Root gap ${n.root_rank}` : STATE_LABEL[n.state];
          const fs = (embedded ? 6 : 4.4) * labelScale;
          const strong = n.root_rank !== undefined || i === selectedIdx || n.id === hover;
          return (
            <g key={`l-${n.id}`} transform={`translate(${n.x} ${n.y + looks[i]!.size * 0.45 + fs * 1.1})`} className={styles.label}>
              <text className={strong ? styles.labelTitle : styles.labelFaint} style={{ fontSize: fs }}>
                {title}
              </text>
              {strong && (
                <text y={fs * 1.05} className={styles.labelSub} style={{ fontSize: fs * 0.78 }}>
                  {sub}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
