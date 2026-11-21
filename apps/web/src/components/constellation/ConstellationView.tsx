"use client";

/**
 * The knowledge constellation: picks the renderer (3D, or the 2D map on weak
 * devices / no WebGL / low frame rate), animates whatever changed in the
 * database since the map was last drawn, and hosts the controls and panel.
 *
 * Two variants: "embedded" (the diagnosis page's slot: a live preview that
 * opens the full map) and "full" (its own full-screen page).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  diffConstellation,
  STATE_LABEL,
  withSavedStates,
  type ConstellationModel,
  type StarState,
} from "@progresso/core/constellation/client";
import { demoMasterRoot, demoResetConstellation } from "@/app/actions";
import { Icon } from "@/components/ui/Icon";
import { plural } from "@/lib/format";
import { readPalette, type Palette } from "./appearance";
import { chooseRenderer, REASON_TEXT, type RendererChoice } from "./capability";
import { ConceptPanel, Legend } from "./ConceptPanel";
import type { SceneStats } from "./engine/scene";
import { Map2D } from "./Map2D";
import { Scene3D } from "./Scene3D";
import type { RendererApi } from "./types";
import styles from "./Constellation.module.css";

type Snapshot = { key: string; nodes: Record<string, { s: StarState; l: boolean }>; roots: Record<string, boolean> };

const storageKey = (m: ConstellationModel) => `progresso:constellation:${m.student_id}:${m.graph_fingerprint}`;

function readSnapshot(m: ConstellationModel): Snapshot | undefined {
  try {
    const raw = localStorage.getItem(storageKey(m));
    return raw ? (JSON.parse(raw) as Snapshot) : undefined;
  } catch {
    return undefined;
  }
}

function writeSnapshot(m: ConstellationModel): void {
  try {
    const snap: Snapshot = {
      key: m.state_key,
      nodes: Object.fromEntries(m.nodes.map((n) => [n.id, { s: n.state, l: n.lit }])),
      roots: Object.fromEntries(m.roots.map((r) => [r.id, r.mastered])),
    };
    localStorage.setItem(storageKey(m), JSON.stringify(snap));
  } catch {
    /* storage unavailable: the map still works, it just can't replay changes since the last visit */
  }
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function summarise(m: ConstellationModel): string {
  const subjects = m.subjects.map((s) => s.name).join(" and ");
  const open = m.roots.filter((r) => !r.mastered);
  const parts = [`${plural(m.nodes.length, "topic")} of ${subjects}.`];
  if (open.length > 0) parts.push(`${open.length === 1 ? "Root gap" : `${open.length} root gaps`}: ${open.map((r) => r.name).join(", ")}.`);
  if (m.counts.weak > 0) parts.push(`${plural(m.counts.weak, "topic")} with mistakes.`);
  if (m.counts.mastered > 0) parts.push(`${m.counts.mastered} mastered.`);
  return parts.join(" ");
}

declare global {
  interface Window {
    __constellation?: { renderer: string; reason: string; stats?: SceneStats; ripples: number; ready: boolean };
  }
}

export function ConstellationView({
  model,
  variant,
  fullHref,
  demoEnabled = false,
}: {
  model: ConstellationModel;
  variant: "embedded" | "full";
  fullHref?: string;
  demoEnabled?: boolean;
}) {
  const router = useRouter();
  const embedded = variant === "embedded";
  const reducedMotion = useReducedMotion();
  const [choice, setChoice] = useState<RendererChoice | null>(null);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [initial, setInitial] = useState<ConstellationModel | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<RendererApi>(null);
  const shown = useRef<ConstellationModel>(model);
  const latest = useRef(model);
  useEffect(() => {
    latest.current = model;
  }, [model]);

  // Decide the renderer and what to draw first, on the client only.
  useEffect(() => {
    const el = rootRef.current!;
    setPalette(readPalette(el));
    setChoice(chooseRenderer(window.location.search));
    let first = model;
    if (!embedded) {
      const snap = readSnapshot(model);
      if (snap && snap.key !== model.state_key) first = withSavedStates(model, snap.nodes, snap.roots);
    }
    shown.current = first;
    setInitial(first);
    window.__constellation = { renderer: "pending", reason: "", ripples: 0, ready: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Animate from what is on screen to `next`. */
  const transition = useCallback(
    (next: ConstellationModel) => {
      const prev = shown.current;
      if (prev.state_key === next.state_key) return;
      shown.current = next;
      const diff = diffConstellation(prev, next);
      if (diff && diff.roots.length > 0) {
        apiRef.current?.ripple({ roots: diff.roots, to: next });
        const names = diff.roots.map((id) => next.roots.find((r) => r.id === id)?.name ?? id);
        const lit = diff.roots.reduce((s, id) => s + (next.roots.find((r) => r.id === id)?.downstream_count ?? 0), 0);
        setAnnounce(`${names.join(" and ")} mastered. The light spreads to ${plural(lit, "topic")} built on it.`);
        if (window.__constellation) window.__constellation.ripples++;
      } else {
        apiRef.current?.setModel(next);
        if (diff && diff.changed.length > 0) setAnnounce("Map updated.");
      }
      if (!embedded) writeSnapshot(next);
    },
    [embedded],
  );

  // A new model from the server (a mission, the MCP server, the demo trigger): animate the change.
  // Until the renderer is up, onReady catches up instead.
  const ready = useRef(false);
  useEffect(() => {
    if (ready.current) transition(model);
  }, [model, transition]);

  const onReady = useCallback(() => {
    ready.current = true;
    if (window.__constellation) window.__constellation.ready = true;
    // Changes since the last visit replay once the map is up.
    if (shown.current.state_key !== latest.current.state_key) window.setTimeout(() => transition(latest.current), 700);
    else if (!embedded) writeSnapshot(latest.current);
  }, [transition, embedded]);

  useEffect(() => {
    if (!choice) return;
    const c = window.__constellation;
    if (c) {
      c.renderer = choice.kind;
      c.reason = choice.reason;
    }
    rootRef.current?.setAttribute("data-renderer", choice.kind);
    if (choice.kind === "2d") onReady();
  }, [choice, onReady]);

  const onStats = useCallback((s: SceneStats) => {
    if (window.__constellation) window.__constellation.stats = s;
    rootRef.current?.setAttribute("data-fps", String(s.fps));
  }, []);

  /** Swap renderers; the new one starts from what is on screen now. */
  const switchRenderer = useCallback((next: RendererChoice) => {
    setInitial(shown.current);
    setChoice(next);
  }, []);
  const onDegrade = useCallback((reason: "slow" | "context-lost") => switchRenderer({ kind: "2d", reason }), [switchRenderer]);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    apiRef.current?.select(id);
  }, []);

  const activate = useCallback(() => {
    if (fullHref) router.push(fullHref);
  }, [fullHref, router]);

  useEffect(() => {
    if (embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedId) select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [embedded, selectedId, select]);

  const master = (rootId: string) =>
    startTransition(async () => {
      setSelectedId(null);
      const res = await demoMasterRoot(model.student_id, rootId);
      if (res.ok) router.refresh();
    });
  const reset = () =>
    startTransition(async () => {
      setSelectedId(null);
      const res = await demoResetConstellation(model.student_id);
      if (res.ok) router.refresh();
    });

  const renderer =
    choice && palette && initial ? (
      choice.kind === "3d" ? (
        <Scene3D
          model={initial}
          palette={palette}
          embedded={embedded}
          reducedMotion={reducedMotion}
          onSelect={setSelectedId}
          onActivate={activate}
          onStats={onStats}
          onDegrade={onDegrade}
          onReady={onReady}
          apiRef={apiRef}
        />
      ) : (
        <Map2D
          key={`2d-${choice.reason}`}
          model={initial}
          palette={palette}
          embedded={embedded}
          reducedMotion={reducedMotion}
          selectedId={selectedId}
          onSelect={select}
          onActivate={activate}
          apiRef={apiRef}
        />
      )
    ) : null;

  const note = choice && choice.kind === "2d" && choice.reason !== "forced" ? REASON_TEXT[choice.reason] : "";
  const summary = summarise(model);

  if (embedded) {
    return (
      <div ref={rootRef} className={styles.embedded}>
        <div className={styles.stage} role="img" aria-label={`Knowledge constellation. ${summary}`}>
          {renderer}
        </div>
        <div className={styles.embedKey}>
          <Legend compact only={["root", "weak", "mastered"]} />
        </div>
        <div className={styles.embedCaption}>
          <h2 id="constellation-title" className={styles.embedTitle}>
            Your knowledge constellation
          </h2>
          {fullHref && (
            <Link href={fullHref} className={styles.openLink}>
              Open the map
              <Icon name="arrowRight" size={16} />
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={styles.full}>
      <div className={styles.stage}>
        <div className={styles.canvas} role="img" aria-label={`Knowledge constellation. ${summary}`}>
          {renderer}
          {!renderer && <p className={styles.loading}>Drawing your constellation…</p>}
        </div>
        <div className={styles.toolbar} role="toolbar" aria-label="Map view">
          <button type="button" className={styles.tool} onClick={() => (setSelectedId(null), apiRef.current?.showRoots())}>
            <Icon name="target" size={16} />
            {model.roots.length === 1 ? "Your root" : "Your roots"}
          </button>
          <button type="button" className={styles.tool} onClick={() => (setSelectedId(null), apiRef.current?.overview())}>
            <Icon name="compass" size={16} />
            Whole map
          </button>
          {choice && (
            <button
              type="button"
              className={styles.tool}
              aria-pressed={choice.kind === "2d"}
              onClick={() => switchRenderer(choice.kind === "3d" ? { kind: "2d", reason: "user" } : { kind: "3d", reason: "user" })}
            >
              <Icon name="layers" size={16} />
              {choice.kind === "3d" ? "2D map" : "3D view"}
            </button>
          )}
        </div>
        {note && (
          <p className={styles.note} role="status">
            {note}
          </p>
        )}
        <div className={styles.legendFloat}>
          <Legend compact />
        </div>
      </div>
      <aside className={styles.panel} aria-label={selectedId ? "Selected topic" : "Your roots and the map key"}>
        <ConceptPanel
          model={model}
          selectedId={selectedId}
          onSelect={select}
          demo={{ enabled: demoEnabled, pending, onMaster: master, onReset: reset }}
        />
      </aside>
      <p className="visually-hidden" role="status" aria-live="polite">
        {announce}
      </p>
      {selectedId && (
        <p className="visually-hidden" aria-live="polite">
          {model.nodes.find((n) => n.id === selectedId)?.name}: {STATE_LABEL[model.nodes.find((n) => n.id === selectedId)?.state ?? "unassessed"]}
        </p>
      )}
    </div>
  );
}
