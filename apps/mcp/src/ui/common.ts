/**
 * Shared widget runtime: connect to the host (MCP Apps), follow its theme,
 * build DOM, open links through the host. Vanilla TS: no framework, so each
 * widget stays one small self-contained HTML file.
 */
import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";

export type Child = Node | string | null | undefined | false;

/** Create an element. `html` sets trusted server HTML (escaped text + MathML built on our server). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string | number | boolean | EventListener>> & { html?: string } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (k === "html") el.innerHTML = String(v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export const LOGO = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="pg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#3d6ef7"/><stop offset="1" stop-color="#16b3a0"/></linearGradient></defs><path d="M5 19 C 9 15, 12 12, 19 4" stroke="url(#pg)" stroke-width="2.6" fill="none" stroke-linecap="round"/><circle cx="5.5" cy="18.5" r="3.2" fill="#3d6ef7"/></svg>`;

export function brand(sample: boolean, label: string): HTMLElement {
  return h(
    "div",
    { class: "top" },
    h("span", { class: "brand", html: `${LOGO}<span>Progresso · ${label}</span>` }),
    sample ? h("span", { class: "sample", title: "Demo student built from hand-written fixtures, not a real report." }, "Sample data") : null,
  );
}

function applyTheme(ctx: McpUiHostContext | undefined): void {
  if (ctx?.theme) document.documentElement.dataset.theme = ctx.theme;
}

export function connectApp(name: string, onData: (data: unknown) => void): App {
  const app = new App({ name, version: "0.1.0" });
  app.ontoolresult = (result) => {
    if (result.structuredContent) onData(result.structuredContent);
    else if (result.isError) showError(result.content?.find((c) => c.type === "text")?.text ?? "Something went wrong.");
  };
  app.onhostcontextchanged = (ctx) => applyTheme(ctx);
  app.onerror = (e) => console.error("[progresso widget]", e);
  app.connect().then(
    () => applyTheme(app.getHostContext()),
    (e) => console.error("[progresso widget] connect failed", e),
  );
  return app;
}

export function showError(text: string): void {
  const root = document.getElementById("app")!;
  root.replaceChildren(h("div", { class: "card" }, h("p", {}, text)));
}

/** Open a web-app link through the host (the iframe sandbox can't navigate itself). */
export function opener(app: App) {
  return (url: string) => () => {
    app.openLink({ url }).catch(() => window.open(url, "_blank", "noopener"));
  };
}

export function fmtRange(r: { low: number; mid: number; high: number }): string {
  return `${Math.round(r.low)}–${Math.round(r.high)}%`;
}

/** A readiness range bar (always a range, labelled Estimate), optionally with the earlier range as a ghost. */
export function meter(now: { low: number; mid: number; high: number }, before?: { low: number; mid: number; high: number }): HTMLElement {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const span = (r: { low: number; high: number }, cls: string) =>
    h("i", { class: cls, style: `left:${clamp(r.low)}%;width:${Math.max(1, clamp(r.high) - clamp(r.low))}%` });
  return h(
    "div",
    { class: "meter", role: "img", "aria-label": `Readiness estimate ${Math.round(now.low)} to ${Math.round(now.high)} percent, most likely ${Math.round(now.mid)}${before ? `, up from ${Math.round(before.mid)}` : ""}` },
    h(
      "div",
      { class: "bar" },
      before ? span(before, "range ghost") : null,
      span(now, "range"),
      h("i", { class: "mid", style: `left:calc(${clamp(now.mid)}% - 1px)` }),
    ),
    h(
      "div",
      { class: "legend" },
      h("span", {}, `Estimate: ${fmtRange(now)} (most likely ${Math.round(now.mid)}%)`),
      before ? h("span", {}, `was ${Math.round(before.mid)}%`) : null,
    ),
  );
}
