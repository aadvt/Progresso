"use client";

/**
 * Mounts the three.js scene (loaded on demand) and exposes it through the
 * shared RendererApi. The scene is created once; later model changes go
 * through the API so the camera and animations aren't reset.
 */
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { ConstellationModel } from "@progresso/core/constellation/client";
import type { Palette } from "./appearance";
import type { ConstellationScene, SceneStats } from "./engine/scene";
import type { RendererApi } from "./types";
import styles from "./Scene3D.module.css";

export function Scene3D({
  model,
  palette,
  embedded,
  reducedMotion,
  onSelect,
  onActivate,
  onStats,
  onDegrade,
  onReady,
  apiRef,
}: {
  model: ConstellationModel;
  palette: Palette;
  embedded: boolean;
  reducedMotion: boolean;
  onSelect(id: string | null): void;
  onActivate?(): void;
  onStats?(s: SceneStats): void;
  onDegrade(reason: "slow" | "context-lost"): void;
  onReady?(): void;
  apiRef: Ref<RendererApi>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const scene = useRef<ConstellationScene | null>(null);
  const pending = useRef<((s: ConstellationScene) => void)[]>([]);
  // Latest callbacks without re-creating the scene.
  const cb = useRef({ onSelect, onActivate, onStats, onDegrade, onReady });
  useEffect(() => {
    cb.current = { onSelect, onActivate, onStats, onDegrade, onReady };
  });
  const initial = useRef({ model, palette, embedded, reducedMotion });

  useEffect(() => {
    let cancelled = false;
    let created: ConstellationScene | null = null;
    import("./engine/scene")
      .then(({ ConstellationScene }) => {
        if (cancelled || !host.current || !labels.current) return;
        const i = initial.current;
        created = new ConstellationScene(host.current, i.model, {
          embedded: i.embedded,
          reducedMotion: i.reducedMotion,
          palette: i.palette,
          labelLayer: labels.current,
          labelClass: {
            subject: styles.subject!,
            unit: styles.unit!,
            root: styles.root!,
            focus: styles.focus!,
            hover: styles.hover!,
          },
          onSelect: (id) => cb.current.onSelect(id),
          onActivate: () => cb.current.onActivate?.(),
          onStats: (s) => cb.current.onStats?.(s),
          onDegrade: (r) => cb.current.onDegrade(r),
        });
        scene.current = created;
        for (const f of pending.current.splice(0)) f(created);
        cb.current.onReady?.();
      })
      .catch(() => cb.current.onDegrade("context-lost"));
    return () => {
      cancelled = true;
      created?.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    scene.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  const run = (f: (s: ConstellationScene) => void) => {
    if (scene.current) f(scene.current);
    else pending.current.push(f);
  };

  useImperativeHandle(apiRef, () => ({
    setModel: (m) => run((s) => s.setModel(m)),
    ripple: (req) => run((s) => s.playRipple(req)),
    select: (id) => run((s) => s.select(id)),
    showRoots: () => run((s) => s.showRoots()),
    overview: () => run((s) => s.overview()),
  }));

  return (
    <div className={styles.wrap} data-renderer="3d">
      <div ref={host} className={styles.host} />
      <div ref={labels} className={styles.labels} aria-hidden="true" />
    </div>
  );
}
