/**
 * Progress widget (ui://progresso/progress.html), rendered by the host for
 * get_progress: roots fixed, the readiness range, and a mini knowledge
 * constellation drawn from the same layout and mastery as the web app's map.
 */
import type { App } from "@modelcontextprotocol/ext-apps";
import type { ProgressData, SkyData } from "../shared/types";
import { brand, connectApp, h, meter, opener } from "./common";
import "./widget.css";

const app: App = connectApp("Progresso progress", (d) => {
  const p = d as ProgressData;
  if (p.view !== "progress") return;
  document.getElementById("app")!.replaceChildren(view(p));
});
const open = opener(app);

const STATE_LABEL = { gap: "Still a gap", learning: "Learning", proven: "Proven", retained: "Held ✓" } as const;

function view(p: ProgressData): HTMLElement {
  return h(
    "div",
    { class: "card" },
    brand(p.sample, "Progress"),
    h("h1", {}, `${p.roots_fixed} of ${p.roots.length} root gap${p.roots.length === 1 ? "" : "s"} fixed`),
    h("div", { class: "meta" }, [p.exam ? `${p.exam.name} in ${p.exam.days_left} day${p.exam.days_left === 1 ? "" : "s"}` : "", `today ${p.today}`].filter(Boolean).join(" · ")),
    h("section", {}, h("h2", {}, "Readiness"), meter(p.readiness.now, p.readiness.start), h("p", { class: "muted", style: "margin:2px 0 0;font-size:12px" }, `If every planned topic is proven and held: ${Math.round(p.readiness.potential.low)}–${Math.round(p.readiness.potential.high)}%.`)),
    p.has_plan
      ? h(
          "div",
          { class: "stats" },
          stat(String(p.missions_done), "missions done"),
          stat(`${p.concepts_proven}/${p.concepts_targeted}`, "topics proven"),
          p.exam ? stat(String(p.exam.days_left), "days to the exam") : null,
        )
      : h("p", { class: "why" }, "No comeback plan yet: ask for tonight's mission to start one."),
    p.roots.length
      ? h(
          "section",
          { "aria-labelledby": "roots-h" },
          h("h2", { id: "roots-h" }, "Root gaps"),
          h(
            "ul",
            { class: "roots" },
            ...p.roots.map((r) =>
              h(
                "li",
                {},
                h("span", { class: `root-dot${r.state === "proven" || r.state === "retained" ? " fixed" : r.state === "learning" ? " learning" : ""}`, "aria-hidden": "true" }),
                h("div", {}, h("div", { style: "font-weight:650" }, `${r.rank}. ${r.name}`), h("div", { class: "meta" }, `${r.errors_explained} mistake${r.errors_explained === 1 ? "" : "s"} · ~${r.marks_lost} marks · ${r.downstream} topics build on it`)),
                h("span", { class: `state ${r.state}` }, STATE_LABEL[r.state]),
              ),
            ),
          ),
        )
      : null,
    h("section", { "aria-labelledby": "sky-h" }, h("h2", { id: "sky-h" }, "Your knowledge constellation"), sky(p.sky, p.roots)),
    p.still_making.length
      ? h("section", {}, h("h2", {}, "Still showing up in your checks"), h("ul", { class: "watch" }, ...p.still_making.map((s) => h("li", {}, `${s.description} (${s.concept})`))))
      : null,
    h(
      "div",
      { class: "actions" },
      h("button", { class: "btn primary", type: "button", onclick: () => void app.sendMessage({ role: "user", content: [{ type: "text", text: "What should I study tonight?" }] }).catch(() => {}) }, "What should I study tonight?"),
      h("button", { class: "btn", type: "button", onclick: open(p.links.constellation) }, "Open the full constellation ↗"),
    ),
  );
}

function stat(value: string, label: string): HTMLElement {
  return h("div", { class: "stat" }, h("b", {}, value), h("span", {}, label));
}

const COLORS = ["var(--star-unassessed)", "var(--star-weak)", "var(--star-root)", "var(--star-learning)", "var(--star-mastered)"];
const NS = "http://www.w3.org/2000/svg";

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** A flat, static drawing of the map: threads, stars by state, roots haloed and named. */
function sky(s: SkyData, roots: ProgressData["roots"]): HTMLElement {
  const fixed = roots.filter((r) => r.state === "proven" || r.state === "retained").length;
  const root = svg("svg", { viewBox: `0 0 ${s.w} ${s.h}`, role: "img", "aria-label": `Knowledge map: ${s.nodes.length} topics, ${roots.length} root gaps, ${fixed} fixed.` });
  const lines = svg("g", { "stroke-linecap": "round" });
  for (const [a, b, chain] of s.edges) {
    const p = s.nodes[a];
    const q = s.nodes[b];
    if (!p || !q) continue;
    // A thread is lit once both ends are fixed or lit by a fixed root.
    const on = (n: SkyData["nodes"][number]) => (n[3] & 1) !== 0 || n[2] === 4;
    const lit = on(p) && on(q);
    lines.append(
      svg("line", {
        x1: p[0],
        y1: p[1],
        x2: q[0],
        y2: q[1],
        stroke: chain ? (lit ? "var(--star-mastered)" : "var(--star-chain)") : lit ? "var(--star-lit)" : "var(--star-thread)",
        "stroke-opacity": chain ? 0.75 : lit ? 0.45 : 0.18,
        "stroke-width": chain ? 4 : 2,
      }),
    );
  }
  root.append(lines);
  const stars = svg("g", {});
  s.nodes.forEach(([x, y, state, flags]) => {
    const isRoot = (flags & 4) !== 0;
    const lit = (flags & 1) !== 0;
    const color = state === 0 && lit ? "var(--star-lit)" : COLORS[state]!;
    // Sized for a ~340 px drawing of a 1000-unit map.
    const r = isRoot ? 18 : state === 0 ? 6 : 10;
    if (isRoot || state === 4 || lit) stars.append(svg("circle", { cx: x, cy: y, r: r * 2.6, fill: color, "fill-opacity": isRoot ? 0.22 : 0.12 }));
    stars.append(svg("circle", { cx: x, cy: y, r, fill: color, "fill-opacity": state === 0 && !lit ? 0.55 : 1 }));
  });
  root.append(stars);
  const labels = svg("g", { "font-size": 46, "font-weight": 650, fill: "var(--sky-ink-1)", "paint-order": "stroke", stroke: "var(--sky-0)", "stroke-width": 10 });
  for (const r of roots) {
    const i = s.roots[r.id];
    const n = i !== undefined ? s.nodes[i] : undefined;
    if (!n) continue;
    const right = n[0] < s.w * 0.7;
    const t = svg("text", { x: n[0] + (right ? 30 : -30), y: n[1] + 15, "text-anchor": right ? "start" : "end" });
    t.textContent = r.name;
    labels.append(t);
  }
  root.append(labels);
  const legend = h(
    "div",
    { class: "sky-legend", "aria-hidden": "true" },
    h("span", { style: "--c:var(--star-root)" }, "root gap"),
    h("span", { style: "--c:var(--star-weak)" }, "where it showed up"),
    h("span", { style: "--c:var(--star-learning)" }, "learning"),
    h("span", { style: "--c:var(--star-mastered)" }, "fixed"),
    h("span", { style: "--c:var(--star-lit)" }, "lit by a fix"),
  );
  return h("div", { class: "sky" }, root as unknown as HTMLElement, legend);
}
