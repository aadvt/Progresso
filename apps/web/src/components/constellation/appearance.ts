/**
 * How each star looks, shared by the 3D scene and the 2D map. Colours come
 * from the design tokens (tokens.css), read at runtime.
 */
import type { ConstellationNode, StarState } from "@progresso/core/constellation/client";

export interface Palette {
  unassessed: string;
  weak: string;
  root: string;
  learning: string;
  mastered: string;
  lit: string;
  thread: string;
  chain: string;
  ripple: string;
  sky0: string;
  sky1: string;
  sky2: string;
}

const TOKENS: Record<keyof Palette, string> = {
  unassessed: "--star-unassessed",
  weak: "--star-weak",
  root: "--star-root",
  learning: "--star-learning",
  mastered: "--star-mastered",
  lit: "--star-lit",
  thread: "--star-thread",
  chain: "--star-chain",
  ripple: "--star-ripple",
  sky0: "--sky-0",
  sky1: "--sky-1",
  sky2: "--sky-2",
};

export function readPalette(el: Element): Palette {
  const css = getComputedStyle(el);
  const out = {} as Palette;
  for (const [k, v] of Object.entries(TOKENS) as [keyof Palette, string][]) out[k] = css.getPropertyValue(v).trim() || "#ffffff";
  return out;
}

export interface StarLook {
  /** Colour as a CSS colour string. */
  color: string;
  /** Mix of the unit hue into the colour, 0..1 (dim stars carry their cluster's tint). */
  tint: number;
  /** World-unit radius of the glow. */
  size: number;
  /** 0..1.5 brightness. */
  bright: number;
  /** 0 plain, 1 pulsing root, 2 mastered halo. */
  kind: 0 | 1 | 2;
}

export function starLook(
  n: Pick<ConstellationNode, "state" | "lit" | "error_count" | "root_rank" | "downstream_count">,
  p: Palette,
): StarLook {
  // Topics many others build on are bigger stars.
  const weight = 0.85 + 0.35 * Math.min(1, Math.sqrt(n.downstream_count) / 5);
  switch (n.state) {
    case "root":
      return { color: p.root, tint: 0, size: 10, bright: 1.35, kind: 1 };
    case "weak":
      return { color: p.weak, tint: 0, size: (3.6 + Math.min(n.error_count, 4) * 0.4) * weight, bright: 1.1, kind: 0 };
    case "learning":
      return { color: p.learning, tint: 0, size: 3.8 * weight, bright: n.lit ? 1.15 : 1, kind: 0 };
    case "mastered":
      return { color: p.mastered, tint: 0, size: n.root_rank !== undefined ? 7 : 4 * weight, bright: 1.2, kind: 2 };
    case "unassessed":
    default:
      return n.lit
        ? { color: p.lit, tint: 0.12, size: 3.4 * weight, bright: 1, kind: 0 }
        : { color: p.unassessed, tint: 0.5, size: 2.8 * weight, bright: 0.68, kind: 0 };
  }
}

/** "Calculus" appears in Class 11 and 12: say which. */
export function unitLabel(u: { id: string; name: string; subject: string; class: number }, all: readonly { id: string; name: string; subject: string }[]): string {
  const dup = all.some((x) => x.id !== u.id && x.subject === u.subject && x.name === u.name);
  return dup ? `${u.name} · ${u.class <= 10 ? "9–10" : u.class}` : u.name;
}

export const STATE_ORDER: readonly StarState[] = ["root", "weak", "learning", "mastered", "unassessed"];
