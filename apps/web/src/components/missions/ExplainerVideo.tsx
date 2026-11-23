"use client";

/**
 * Explainer video (Phase 7): a checked Manim animation for one misconception.
 * Captions are drawn into the video, so it works with the sound off; the same
 * captions are offered as a text track and a readable transcript. Never
 * auto-plays (phone data). If the file can't be played, `onUnavailable` lets
 * the caller fall back to the step explainer.
 */
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import type { ExplainerVideoView } from "@/lib/mission-types";
import styles from "./Lessons.module.css";

const minutes = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function ExplainerVideo({ videos, onUnavailable }: { videos: ExplainerVideoView[]; onUnavailable?: () => void }) {
  const [index, setIndex] = useState(0);
  const v = videos[Math.min(index, videos.length - 1)];
  if (!v) return null;
  return (
    <div className={styles.explainer} data-video={v.misconception_id}>
      {videos.length > 1 && (
        <div className={styles.switcher} role="group" aria-label="Choose a video">
          {videos.map((x, k) => (
            <button key={x.misconception_id} type="button" className={`${styles.chip} ${x.yours ? styles.chipYours : ""}`} aria-pressed={k === index} onClick={() => setIndex(k)}>
              {x.title}
            </button>
          ))}
        </div>
      )}
      <div className={styles.explainerHead}>
        <h3 className={styles.explainerTitle}>{v.title}</h3>
        <span className={styles.videoLength}>{minutes(v.duration_s)}</span>
        {v.yours && <Badge tone="amber">In your report</Badge>}
      </div>
      <video
        key={v.src}
        className={styles.video}
        controls
        playsInline
        preload="metadata"
        poster={v.poster}
        aria-label={`Explainer video: ${v.title}`}
        onError={() => onUnavailable?.()}
      >
        <source src={v.src} type="video/mp4" onError={() => onUnavailable?.()} />
        <track kind="captions" src={v.captions_src} srcLang="en" label="English" />
      </video>
      <details className={styles.transcript}>
        <summary>Read the captions</summary>
        <ol>
          {v.transcript.map((t, k) => (
            <li key={k}>{t}</li>
          ))}
        </ol>
      </details>
      <p className={styles.checked}>{v.checked}</p>
    </div>
  );
}
