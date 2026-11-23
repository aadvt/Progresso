/**
 * Explainer videos (Phase 7): short Manim animations, one per misconception
 * (not per student), generated and checked offline by `pnpm videos:generate`
 * and listed in `<videosDir>/manifest.json`.
 *
 * Every attempt is recorded. Only entries with status "passed" are ever shown
 * to a student; anything "failed" is kept in the manifest for the report and
 * the step explainer (Phase 6) is shown instead.
 */
import { z } from "zod";

const Id = z.string().regex(/^[a-z0-9][a-z0-9_.:-]*$/);
/** A path inside the videos dir: forward slashes, no "..", no leading slash. */
const RelPath = z.string().regex(/^(?!\/)(?!.*\.\.)[A-Za-z0-9_./-]+$/);

export const STORYBOARD_SECONDS = { min: 60, max: 120 } as const;

export const StoryboardSceneSchema = z
  .object({
    /** On-screen caption (always shown; the video works with the sound off). */
    caption: z.string().min(1).max(120),
    /** Optional spoken line, for a narration provider. Not rendered when narration is off. */
    narration: z.string().min(1).max(400).optional(),
    /** What the animation shows and how it moves. */
    visual: z.string().min(1).max(600),
    /** The LaTeX shown in this scene (no $), so the frame check can compare. */
    math: z.array(z.string().min(1).max(200)).max(4),
    seconds: z.number().min(4).max(30),
  })
  .strict();
export type StoryboardScene = z.infer<typeof StoryboardSceneSchema>;

export const StoryboardSchema = z
  .object({
    title: z.string().min(1).max(90),
    /** The one idea the video builds. */
    idea: z.string().min(1).max(240),
    scenes: z.array(StoryboardSceneSchema).min(4).max(10),
  })
  .strict()
  .superRefine((s, ctx) => {
    const total = s.scenes.reduce((a, x) => a + x.seconds, 0);
    if (total < STORYBOARD_SECONDS.min || total > STORYBOARD_SECONDS.max)
      ctx.addIssue({ code: "custom", path: ["scenes"], message: `scenes add up to ${total} s; a video is ${STORYBOARD_SECONDS.min}-${STORYBOARD_SECONDS.max} s` });
  });
export type Storyboard = z.infer<typeof StoryboardSchema>;

export const VIDEO_ATTEMPT_STAGES = ["lint", "render", "duration", "layout_audit", "frame_check", "passed"] as const;
export type VideoAttemptStage = (typeof VIDEO_ATTEMPT_STAGES)[number];

export const VideoAttemptSchema = z
  .object({
    n: z.number().int().positive(),
    /** Where this attempt stopped ("passed" when it got through every check). */
    stage: z.enum(VIDEO_ATTEMPT_STAGES),
    problems: z.array(z.string()),
    render_seconds: z.number().nonnegative().optional(),
    duration_s: z.number().nonnegative().optional(),
  })
  .strict();
export type VideoAttempt = z.infer<typeof VideoAttemptSchema>;

export const CaptionCueSchema = z
  .object({ start: z.number().nonnegative(), end: z.number().nonnegative(), text: z.string().min(1) })
  .strict();
export type CaptionCue = z.infer<typeof CaptionCueSchema>;

export const VideoEntrySchema = z
  .object({
    misconception_id: Id,
    concept_id: Id,
    subject: z.string().min(1),
    status: z.enum(["passed", "failed"]),
    title: z.string().min(1),
    storyboard: StoryboardSchema,
    /** Fixed by the pipeline; a passing entry has every file. */
    files: z
      .object({
        video: RelPath,
        poster: RelPath,
        captions: RelPath,
        code: RelPath,
      })
      .strict()
      .optional(),
    duration_s: z.number().positive().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    captions: z.array(CaptionCueSchema).optional(),
    /** "none": on-screen captions only. Otherwise the narration provider's name. */
    narration: z.string().min(1),
    attempts: z.array(VideoAttemptSchema).min(1),
    /** Attempts after the first (each fed the previous attempt's problems back). */
    fix_iterations: z.number().int().nonnegative(),
    frame_check: z
      .object({ model: z.string(), frames: z.number().int().nonnegative(), summary: z.string() })
      .strict()
      .optional(),
    generator: z.object({ provider: z.string(), model: z.string() }).strict(),
    /**
     * A person's check of the frames after the automatic checks. "rejected" is
     * never served, whatever the automatic status; "approved" records the sign-off.
     */
    review: z
      .object({
        verdict: z.enum(["approved", "rejected"]),
        notes: z.string().min(1),
        at: z.string().min(1),
      })
      .strict()
      .optional(),
    /** Hash of the verified step explainer the storyboard was built from, if any. */
    source_explainer_hash: z.string().optional(),
    prompt_version: z.string().min(1),
    generated_at: z.string().min(1),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.status === "passed" && (!e.files || !e.duration_s || !e.captions?.length || !e.frame_check))
      ctx.addIssue({ code: "custom", path: ["status"], message: "a passing video needs its files, duration, captions and frame check" });
    if (e.status === "passed" && e.attempts.at(-1)?.stage !== "passed")
      ctx.addIssue({ code: "custom", path: ["attempts"], message: "a passing video's last attempt must have passed" });
  });
export type VideoEntry = z.infer<typeof VideoEntrySchema>;

/** Shown to students: passed every automatic check and not rejected on review. */
export const isServable = (v: VideoEntry): boolean => v.status === "passed" && v.review?.verdict !== "rejected";

export const VideoManifestSchema = z
  .object({
    schema_version: z.literal("1.0"),
    videos: z.array(VideoEntrySchema),
  })
  .strict();
export type VideoManifest = z.infer<typeof VideoManifestSchema>;
