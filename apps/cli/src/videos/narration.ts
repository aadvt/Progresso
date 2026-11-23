/**
 * Narration is optional: the videos carry on-screen captions and work with the
 * sound off. A provider turns the storyboard's narration lines into one audio
 * track timed to the caption cues; the pipeline muxes it in. Adding a real
 * text-to-speech engine later means implementing this interface and
 * registering it here, nothing else changes.
 */
import type { CaptionCue, Storyboard } from "@progresso/core";

export interface NarrationProvider {
  /** Stored in the manifest ("none" = captions only). */
  readonly name: string;
  /** Write an audio file for the video, or return undefined for no audio. */
  narrate(input: { storyboard: Storyboard; cues: CaptionCue[]; durationS: number; outDir: string }): Promise<string | undefined>;
}

export const noNarration: NarrationProvider = {
  name: "none",
  narrate: () => Promise.resolve(undefined),
};

const PROVIDERS: Record<string, NarrationProvider> = { none: noNarration };

export function narrationProvider(name: string): NarrationProvider {
  const p = PROVIDERS[name];
  if (!p) throw new Error(`Unknown narration provider "${name}". Available: ${Object.keys(PROVIDERS).join(", ")}`);
  return p;
}
