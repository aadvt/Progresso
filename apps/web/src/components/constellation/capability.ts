/**
 * Which renderer a device gets. 3D needs WebGL and a device that isn't
 * obviously weak; everything else gets the 2D map. The 3D scene also watches
 * its own frame rate and asks for the 2D map if it can't keep up.
 */
export type RendererKind = "3d" | "2d";
export type RendererReason = "capable" | "forced" | "no-webgl" | "weak-device" | "save-data" | "slow" | "context-lost" | "user";

export interface RendererChoice {
  kind: RendererKind;
  reason: RendererReason;
}

interface NavigatorHints {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  connection?: { saveData?: boolean };
}

export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return false;
    (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** `?view=2d` or `?view=3d` in the URL overrides the automatic choice (testing, demos). */
export function chooseRenderer(search: string): RendererChoice {
  const forced = new URLSearchParams(search).get("view");
  if (forced === "2d") return { kind: "2d", reason: "forced" };
  const webgl = hasWebGL();
  if (!webgl) return { kind: "2d", reason: "no-webgl" };
  if (forced === "3d") return { kind: "3d", reason: "forced" };
  const nav = navigator as Navigator & NavigatorHints;
  if (nav.connection?.saveData) return { kind: "2d", reason: "save-data" };
  const memory = nav.deviceMemory;
  const cores = nav.hardwareConcurrency;
  if ((memory !== undefined && memory < 2) || (cores !== undefined && cores <= 2)) return { kind: "2d", reason: "weak-device" };
  return { kind: "3d", reason: "capable" };
}

export const REASON_TEXT: Record<RendererReason, string> = {
  capable: "",
  forced: "Showing the 2D map.",
  "no-webgl": "This browser can't draw 3D, so here is the 2D map.",
  "weak-device": "Showing the lighter 2D map on this device.",
  "save-data": "Data saver is on, so here is the lighter 2D map.",
  slow: "Switched to the 2D map to keep things smooth.",
  "context-lost": "The 3D view stopped, so here is the 2D map.",
  user: "",
};
