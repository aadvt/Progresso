/**
 * Deterministic constellation layout. Depends only on the concept graph, so it
 * is computed once per graph (and cached by the caller), not per student.
 *
 * Each subject is a disc:
 *  - rings by class: Class 9–10 foundations at the core, Class 11 around it,
 *    Class 12 at the rim. Prerequisite threads therefore point outwards, and a
 *    chain reaction from a root visibly spreads outwards.
 *  - within a ring, each unit is a sector (a cluster), and deeper concepts sit
 *    further out. Sectors are ordered so that units that depend on each other
 *    face each other across rings, which keeps threads short (no hairball).
 *  - a light force relaxation removes overlaps and gives an organic look.
 *
 * Ring thickness grows with the number of concepts, so the same code works on
 * the full Phase P graph. Nothing here knows any concept id.
 */
import type { ConceptGraph } from "../graph/graph";
import type { ConstellationLayout, ConstellationRing, ConstellationSubject, ConstellationUnit, StarPosition } from "./types";

export interface LayoutParams {
  /** Concepts closer than this are pushed apart. */
  minDist: number;
  /** Disc area per concept; sets ring thickness. */
  areaPerNode: number;
  minRingThickness: number;
  ringGap: number;
  coreRadius: number;
  /** Empty angle between sectors, radians. */
  sectorGap: number;
  subjectGap: number;
  /** Height of the disc's dome at its centre (3D only). */
  domeHeight: number;
  iterations: number;
}

export const DEFAULT_LAYOUT_PARAMS: LayoutParams = {
  minDist: 8.5,
  areaPerNode: 210,
  minRingThickness: 14,
  ringGap: 8,
  coreRadius: 5,
  sectorGap: 0.16,
  subjectGap: 46,
  domeHeight: 16,
  iterations: 220,
};

const TAU = Math.PI * 2;
const SUBJECT_HUES: readonly number[] = [222, 268, 188, 300, 160];

/** Stable 0..1 hash of a string (FNV-1a). */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100000) / 100000;
}

const wrap = (a: number): number => {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  if (x < -Math.PI) x += TAU;
  return x;
};
const angDist = (a: number, b: number): number => Math.abs(wrap(a - b));

function circularMean(angles: number[], weights?: number[]): number | undefined {
  if (angles.length === 0) return undefined;
  let sx = 0;
  let sy = 0;
  angles.forEach((a, i) => {
    const w = weights?.[i] ?? 1;
    sx += Math.cos(a) * w;
    sy += Math.sin(a) * w;
  });
  if (Math.hypot(sx, sy) < 1e-9) return undefined;
  return Math.atan2(sy, sx);
}

interface UnitSlot {
  id: string;
  name: string;
  class: number;
  board_marks: number;
  ring: number;
  members: string[];
  angle: number;
  halfWidth: number;
  full: boolean;
}

interface Placed {
  id: string;
  unit: UnitSlot;
  ring: number;
  rTarget: number;
  r: number;
  a: number;
}

function ringLabel(cls: number): string {
  return cls <= 10 ? "Foundations · Class 9–10" : `Class ${cls}`;
}

/** Lay out the given subjects (in the given order). Unknown subjects are skipped. */
export function layoutConstellation(
  graph: ConceptGraph,
  subjects: readonly string[],
  params: Partial<LayoutParams> = {},
): ConstellationLayout {
  const p = { ...DEFAULT_LAYOUT_PARAMS, ...params };
  const chosen = subjects.filter((s) => graph.subjects.includes(s));
  const discs = chosen.map((s) => layoutSubject(graph, s, p));

  // Subjects side by side along x, centred on the origin.
  const total = discs.reduce((w, d) => w + d.radius * 2, 0) + p.subjectGap * Math.max(0, discs.length - 1);
  let cursor = -total / 2;
  const positions: Record<string, StarPosition> = {};
  const subjOut: ConstellationSubject[] = [];
  const units: ConstellationUnit[] = [];
  discs.forEach((d, si) => {
    const cx = cursor + d.radius;
    cursor += d.radius * 2 + p.subjectGap;
    for (const [id, pos] of Object.entries(d.positions)) positions[id] = { x: pos.x + cx, y: pos.y, h: pos.h };
    subjOut.push({ name: d.subject, center: { x: round(cx), y: 0 }, radius: round(d.radius), rings: d.rings });
    const base = SUBJECT_HUES[si % SUBJECT_HUES.length]!;
    d.units.forEach((u, ui) => {
      const spread = d.units.length > 1 ? (ui / (d.units.length - 1) - 0.5) * 44 : 0;
      units.push({ ...u, hue: Math.round((base + spread + 360) % 360), label: { ...u.label, x: round(u.label.x + cx) } });
    });
  });

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of subjOut) {
    minX = Math.min(minX, s.center.x - s.radius);
    maxX = Math.max(maxX, s.center.x + s.radius);
    minY = Math.min(minY, s.center.y - s.radius);
    maxY = Math.max(maxY, s.center.y + s.radius);
  }
  if (!Number.isFinite(minX)) [minX, maxX, minY, maxY] = [-1, 1, -1, 1];

  return { graph_fingerprint: graph.fingerprint, subjects: subjOut, units, positions, bounds: { minX, maxX, minY, maxY } };
}

const round = (n: number): number => Math.round(n * 100) / 100;

function layoutSubject(graph: ConceptGraph, subject: string, p: LayoutParams) {
  const concepts = graph.list(subject).sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set(concepts.map((c) => c.id));

  // ---- units and rings
  const unitMap = new Map<string, UnitSlot>();
  for (const c of concepts) {
    const u = graph.units.get(c.unit_id);
    let slot = unitMap.get(c.unit_id);
    if (!slot) {
      slot = {
        id: c.unit_id,
        name: u?.name ?? c.unit_id,
        class: u?.class ?? c.class,
        board_marks: u?.board_marks ?? 0,
        ring: 0,
        members: [],
        angle: 0,
        halfWidth: Math.PI,
        full: false,
      };
      unitMap.set(c.unit_id, slot);
    }
    slot.members.push(c.id);
  }
  const ringKey = (u: UnitSlot) => (u.class <= 10 ? 10 : u.class);
  const ringKeys = [...new Set([...unitMap.values()].map(ringKey))].sort((a, b) => a - b);
  const ringsUnits: UnitSlot[][] = ringKeys.map(() => []);
  for (const u of [...unitMap.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    u.ring = ringKeys.indexOf(ringKey(u));
    ringsUnits[u.ring]!.push(u);
  }

  const rings: ConstellationRing[] = [];
  let rIn = p.coreRadius;
  ringsUnits.forEach((list, i) => {
    const n = list.reduce((s, u) => s + u.members.length, 0);
    let rOut = Math.sqrt(rIn * rIn + (n * p.areaPerNode) / Math.PI);
    rOut = Math.max(rOut, rIn + p.minRingThickness);
    rings.push({ label: ringLabel(ringKeys[i]!), inner: round(rIn), outer: round(rOut) });
    rIn = rOut + p.ringGap;
  });
  const radius = (rings[rings.length - 1]?.outer ?? 10) + 10;

  // ---- sector arrangement: order units in each ring so linked units face each other
  const unitOf = new Map<string, UnitSlot>();
  for (const u of unitMap.values()) for (const m of u.members) unitOf.set(m, u);
  const unitLinks = new Map<string, number>();
  for (const c of concepts) {
    for (const pre of c.prerequisites) {
      if (!ids.has(pre)) continue;
      const a = unitOf.get(pre)!;
      const b = unitOf.get(c.id)!;
      if (a === b) continue;
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      unitLinks.set(key, (unitLinks.get(key) ?? 0) + 1);
    }
  }
  const links = [...unitLinks.entries()].map(([k, w]) => {
    const [a, b] = k.split("|");
    return { a: unitMap.get(a!)!, b: unitMap.get(b!)!, w };
  });

  const orders = ringsUnits.map((list) => [...list]);
  const offsets = ringsUnits.map(() => 0);
  const pack = (ring: number) => {
    const list = orders[ring]!;
    if (list.length === 1) {
      const u = list[0]!;
      u.full = true;
      u.angle = offsets[ring]!;
      u.halfWidth = Math.PI;
      return;
    }
    const weight = (u: UnitSlot) => u.members.length + 0.8;
    const totalW = list.reduce((s, u) => s + weight(u), 0);
    const usable = TAU - p.sectorGap * list.length;
    let a = offsets[ring]!;
    for (const u of list) {
      const w = (weight(u) / totalW) * usable;
      u.full = false;
      u.halfWidth = w / 2;
      u.angle = wrap(a + w / 2);
      a += w + p.sectorGap;
    }
  };
  ringsUnits.forEach((_, i) => pack(i));
  const cost = () => links.reduce((s, l) => (l.a.full || l.b.full ? s : s + l.w * angDist(l.a.angle, l.b.angle) ** 2), 0);

  // Hill-climb over swaps and rotations; deterministic. The first multi-unit ring keeps offset 0.
  const anchorRing = orders.findIndex((o) => o.length > 1);
  for (let pass = 0; pass < 40; pass++) {
    let improved = false;
    for (let ring = 0; ring < orders.length; ring++) {
      const list = orders[ring]!;
      if (list.length < 2) continue;
      let best = cost();
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (ring === anchorRing && i === 0) continue;
          [list[i], list[j]] = [list[j]!, list[i]!];
          pack(ring);
          const c = cost();
          if (c < best - 1e-9) {
            best = c;
            improved = true;
          } else {
            [list[i], list[j]] = [list[j]!, list[i]!];
            pack(ring);
          }
        }
      }
      if (ring !== anchorRing) {
        const base = offsets[ring]!;
        let bestOff = base;
        for (let k = 1; k < 48; k++) {
          offsets[ring] = base + (k * TAU) / 48;
          pack(ring);
          const c = cost();
          if (c < best - 1e-9) {
            best = c;
            bestOff = offsets[ring]!;
            improved = true;
          }
        }
        offsets[ring] = wrap(bestOff);
        pack(ring);
      }
    }
    if (!improved) break;
  }

  // ---- radial targets: deeper concepts further out within their ring
  const placed = new Map<string, Placed>();
  ringsUnits.forEach((list, ring) => {
    const members = list.flatMap((u) => u.members);
    const depths = [...new Set(members.map((m) => graph.depthOf(m)))].sort((a, b) => a - b);
    const { inner, outer } = rings[ring]!;
    const pad = Math.min(3, (outer - inner) * 0.15);
    for (const m of members) {
      const rank = depths.indexOf(graph.depthOf(m));
      const t = (rank + 0.5) / depths.length;
      const jitter = (hash01(`${m}:r`) - 0.5) * ((outer - inner - 2 * pad) / Math.max(depths.length, 2)) * 0.9;
      const rTarget = inner + pad + t * (outer - inner - 2 * pad) + jitter;
      placed.set(m, { id: m, unit: unitOf.get(m)!, ring, rTarget, r: rTarget, a: 0 });
    }
  });

  // ---- angular order: barycentric sweeps (crossing reduction)
  const neighbours = new Map<string, string[]>();
  for (const c of concepts) {
    for (const pre of c.prerequisites) {
      if (!ids.has(pre)) continue;
      neighbours.set(c.id, [...(neighbours.get(c.id) ?? []), pre]);
      neighbours.set(pre, [...(neighbours.get(pre) ?? []), c.id]);
    }
  }
  const spread = (u: UnitSlot, order: string[]) => {
    const n = order.length;
    if (u.full) {
      // Evenly round the whole ring, rotated to best match the targets.
      const targets = order.map((m) => placed.get(m)!.a);
      const phase = circularMean(targets.map((t, k) => t - (TAU * k) / n)) ?? 0;
      order.forEach((m, k) => (placed.get(m)!.a = wrap(phase + (TAU * k) / n)));
      return;
    }
    const usable = u.halfWidth * 2 * 0.9;
    order.forEach((m, k) => (placed.get(m)!.a = wrap(u.angle - usable / 2 + (usable * (k + 0.5)) / n)));
  };
  for (const u of unitMap.values()) spread(u, [...u.members]);
  for (let sweep = 0; sweep < 8; sweep++) {
    for (const u of [...unitMap.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      const keyed = u.members.map((m) => {
        const nb = neighbours.get(m) ?? [];
        const own = placed.get(m)!.a;
        const target = circularMean([...nb.map((x) => placed.get(x)!.a), own], [...nb.map(() => 1), 0.5]) ?? own;
        return { m, k: u.full ? target : wrap(target - u.angle) };
      });
      if (u.full) {
        keyed.forEach(({ m, k }) => (placed.get(m)!.a = k));
        keyed.sort((x, y) => x.k - y.k || x.m.localeCompare(y.m));
      } else {
        keyed.sort((x, y) => x.k - y.k || x.m.localeCompare(y.m));
      }
      spread(
        u,
        keyed.map((x) => x.m),
      );
    }
  }

  // ---- relaxation: overlaps out, organic feel, nodes stay in their ring and sector
  const nodes = [...placed.values()].sort((a, b) => a.id.localeCompare(b.id));
  const xy = nodes.map((n) => ({ x: n.r * Math.cos(n.a), y: n.r * Math.sin(n.a) }));
  for (let it = 0; it < p.iterations; it++) {
    const cool = 1 - it / p.iterations;
    const fx = new Float64Array(nodes.length);
    const fy = new Float64Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = xy[i]!.x - xy[j]!.x;
        const dy = xy[i]!.y - xy[j]!.y;
        const d = Math.hypot(dx, dy) || 1e-3;
        const want = p.minDist * 1.25;
        if (d < want) {
          const f = ((want - d) / d) * 0.5;
          fx[i]! += dx * f;
          fy[i]! += dy * f;
          fx[j]! -= dx * f;
          fy[j]! -= dy * f;
        }
      }
    }
    nodes.forEach((n, i) => {
      let x = xy[i]!.x + fx[i]! * 0.6;
      let y = xy[i]!.y + fy[i]! * 0.6;
      let r = Math.hypot(x, y);
      let a = Math.atan2(y, x);
      // Radial spring towards the depth target, hard ring limits.
      r += (n.rTarget - r) * 0.12 * (0.4 + cool);
      const ring = rings[n.ring]!;
      r = Math.min(ring.outer - 1, Math.max(ring.inner + 1, r));
      // Sector walls.
      if (!n.unit.full) {
        const off = wrap(a - n.unit.angle);
        const lim = Math.max(0.01, n.unit.halfWidth - Math.min(0.06, n.unit.halfWidth * 0.2));
        if (Math.abs(off) > lim) a = n.unit.angle + Math.sign(off) * lim;
      }
      x = r * Math.cos(a);
      y = r * Math.sin(a);
      xy[i] = { x, y };
      n.r = r;
      n.a = a;
    });
  }

  const positions: Record<string, StarPosition> = {};
  nodes.forEach((n, i) => {
    const rn = n.r / radius;
    const h = p.domeHeight * (1 - rn * rn) + (hash01(`${n.id}:h`) - 0.5) * 5;
    positions[n.id] = { x: round(xy[i]!.x), y: round(xy[i]!.y), h: round(h) };
  });

  const units: Omit<ConstellationUnit, "hue">[] = [...unitMap.values()]
    .sort((a, b) => a.ring - b.ring || wrap(a.angle) - wrap(b.angle))
    .map((u) => {
      const ring = rings[u.ring]!;
      const la = u.full ? -Math.PI / 2 : u.angle;
      const lr = ring.outer + 4.5;
      return {
        id: u.id,
        name: u.name,
        subject,
        class: u.class,
        board_marks: u.board_marks,
        ring: u.ring,
        angle: round(wrap(u.angle)),
        half_width: round(u.halfWidth),
        label: { x: round(lr * Math.cos(la)), y: round(lr * Math.sin(la)), h: 0 },
        concept_count: u.members.length,
      };
    });

  return { subject, radius, rings, units, positions };
}
