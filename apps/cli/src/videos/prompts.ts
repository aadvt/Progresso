/**
 * Prompts and LLM output schemas for explainer videos. Inputs are graph text
 * (concept, misconception) and the verified step explainer for the
 * misconception: no student data at all, since videos are per misconception.
 */
import { z } from "zod";
import type { ConceptGraph, Storyboard, StepExplainer } from "@progresso/core";

export const VIDEO_PROMPT_VERSION = "video-1";

// ------------------------------------------------------------------ storyboard

export const StoryboardGenSchema = z.object({
  title: z.string().min(1),
  idea: z.string().min(1),
  scenes: z
    .array(
      z.object({
        caption: z.string().min(1),
        narration: z.string().nullable(),
        visual: z.string().min(1),
        math: z.array(z.string()),
        seconds: z.number(),
      }),
    )
    .min(4)
    .max(10),
});
export type StoryboardGen = z.infer<typeof StoryboardGenSchema>;

export const STORYBOARD_SYSTEM = `You storyboard a short explainer animation in the style of 3Blue1Brown for CBSE Class 11-12 students (NCERT syllabus). It is rendered with Manim and plays with the sound OFF: on-screen captions carry the words.
Rules:
- ONE idea. 60-120 seconds in total (scene seconds must add up to 70-110), 5-8 scenes.
- Scene 1 shows the typical WRONG step this misconception produces, as a student would write it, and lets it look plausible for a moment.
- Then build intuition visually for why it fails and what is really going on (a picture, a graph, a substitution with numbers, a "zoom in" on the structure), then state the correct rule, then one short worked example done right, ending on the takeaway.
- Each scene: caption (what the viewer reads, max 110 characters, plain friendly English, write powers with superscript characters like x², cos²x, never ^ or LaTeX; include units and degree signs, e.g. 60°), visual (precise directions for the animator: what appears, where, what moves, colours: wrong in red, right in green, highlights in yellow), math (the LaTeX expressions shown in that scene, no $, at most 3, each short enough to fit one line), seconds (4-25).
- narration: an optional spoken line per scene (null is fine). The video must make sense without it.
- Keep the screen simple: at most 3 expressions at once. Prefer visuals that animate meaningfully (transforming one expression into the next, highlighting the inner function, plotting) over walls of text.
- Every formula must be mathematically correct, except the deliberately wrong step, which must be shown as wrong (red, crossed out) once it is explained.
- When a verified step explainer is given, stay faithful to it: same wrong step, same correct rule, same worked example and numbers. Do not invent different maths.`;

export function storyboardPrompt(graph: ConceptGraph, misconceptionId: string, explainer?: StepExplainer): string {
  const m = graph.misconceptions.get(misconceptionId)!;
  const c = graph.get(m.concept_id);
  const lines = [
    `Subject: ${c.subject}. Topic: ${c.name} (Class ${c.class}, ${c.chapter}).`,
    `Misconception to undo: ${m.description}`,
  ];
  if (explainer) {
    lines.push("", `Verified step explainer for this misconception (use its maths): "${explainer.title}"`);
    for (const [i, s] of explainer.steps.entries()) lines.push(`${i + 1}. [${s.kind}] ${s.say}${s.math ? `  Board: ${s.math}` : ""}`);
    lines.push(`Takeaway: ${explainer.takeaway}`);
  } else {
    lines.push("", "There is no verified step explainer yet: work the maths out carefully yourself.");
  }
  return lines.join("\n");
}

export function toStoryboard(g: StoryboardGen): Storyboard {
  return {
    title: g.title.slice(0, 90),
    idea: g.idea.slice(0, 240),
    scenes: g.scenes.map((s) => ({
      caption: s.caption.trim().replace(/\s+/g, " "),
      ...(s.narration ? { narration: s.narration.trim().slice(0, 400) } : {}),
      visual: s.visual.trim().slice(0, 600),
      math: s.math.map((x) => x.replace(/^\$+|\$+$/g, "").trim()).filter(Boolean).slice(0, 4),
      seconds: Math.round(Math.min(30, Math.max(4, s.seconds))),
    })),
  };
}

// ------------------------------------------------------------------ code

export const CODEGEN_SYSTEM = `You write Manim Community Edition (v0.22) Python code for a short educational animation, from a storyboard. Output ONLY one \`\`\`python code block.
Fixed frame: 16:9, 14.22 x 8 units, dark background. A helper module is available; start the file with exactly:
from manim import *
from progresso_manim import *

class ExplainerScene(ProgressoScene):
    def construct(self):
        ...

The helper (progresso_manim) gives you:
- self.caption("text"): shows the scene's caption in a fixed band at the bottom (replacing the previous one). Call it ONCE at the start of every storyboard scene with the scene's caption text exactly. Never draw your own captions or subtitles.
- self.clear_content(): fades out everything except the caption. Call it between scenes.
- Layout constants: CONTENT_TOP (3.65), CONTENT_BOTTOM (-2.45), CONTENT_LEFT, CONTENT_RIGHT (±6.76), CONTENT_WIDTH, CONTENT_HEIGHT, CONTENT_CENTER (a point; use .move_to(CONTENT_CENTER)). ALL content must stay inside this box: nothing below CONTENT_BOTTOM (that is the caption band), nothing off-screen.
- fit(mobject, width=CONTENT_WIDTH, height=CONTENT_HEIGHT): scales a mobject DOWN to fit. Use it on every wide group.
- Colours: INK (default text), MUTED, ACCENT (blue), WRONG (red), CORRECT (green), HILITE (yellow), PURPLE.
Layout rules (a checker measures every text at every frame and rejects overlaps and anything outside the content box):
- Build each scene's content as a VGroup arranged with .arrange(DOWN, buff=0.5) (or RIGHT), then fit(...) and .move_to(CONTENT_CENTER). Use next_to(..., buff>=0.3) for labels. Never place two texts at the same position; to change an expression use TransformMatchingTex / ReplacementTransform, or FadeOut the old one first.
- At most 3 expressions plus one short label on screen at once. Clear the screen between scenes.
- Sizes: MathTex font_size 44-56 (never below 36), Text font_size 30-40 (never below 28). Short labels only; no paragraphs of text on screen (the caption carries the words).
- Axes: Axes(x_range=..., y_range=..., x_length<=9, y_length<=4.2, tips=False), positioned inside the content box; plot with axes.plot(lambda x: ..., x_range=[a, b]) keeping values inside y_range. Label with small MathTex next_to the curve.
- Emphasis: Indicate, Circumscribe, SurroundingRectangle(color=HILITE, buff=0.1), Cross(mobject, stroke_color=WRONG), Underline.
- To colour part of an equation, split it into separate strings: MathTex(r"2x", r"\\cos(x^2)") then eq[0].set_color(HILITE). Do not use substrings_to_isolate or set_color_by_tex with partial matches.
Timing: each storyboard scene's run_time + wait() must add up to its seconds (±2 s); the whole video 60-120 s. Use self.wait(...) generously so a viewer can read; minimum 1.5 s wait after each new expression.
LaTeX: standard amsmath only. Use \\text{...} only for short words. Write maths in MathTex raw strings r"...". No \\begin{align}; one line per MathTex.
Forbidden: imports other than manim/progresso_manim/numpy/math/random; files, images, SVGs, Code, sounds; os, sys, open, eval, exec, getattr; while loops; overriding setup/tear_down/play/wait; global state.
Correctness: every expression must be mathematically correct, except the deliberate wrong step from the storyboard, which you colour WRONG and later cross out.`;

export function codegenPrompt(storyboard: Storyboard): string {
  const total = storyboard.scenes.reduce((a, s) => a + s.seconds, 0);
  return [
    `Storyboard: "${storyboard.title}". The idea: ${storyboard.idea}`,
    `Total length: about ${total} s.`,
    ...storyboard.scenes.flatMap((s, i) => [
      "",
      `Scene ${i + 1} (${s.seconds} s)`,
      `caption: ${JSON.stringify(s.caption)}`,
      `visual: ${s.visual}`,
      ...(s.math.length ? [`math: ${s.math.map((x) => JSON.stringify(x)).join(" | ")}`] : []),
    ]),
  ].join("\n");
}

export function fixPrompt(storyboard: Storyboard, code: string, stage: string, problems: string[]): string {
  return [
    codegenPrompt(storyboard),
    "",
    "---",
    `Your previous code failed at the ${stage} stage. Problems:`,
    ...problems.map((p) => `- ${p}`),
    "",
    "Previous code:",
    "```python",
    code,
    "```",
    "",
    "Return the COMPLETE corrected file in one ```python block. Fix every problem listed; keep what already works (same captions, same scenes, same timing). If text overlaps or leaves the box, rearrange (arrange/next_to with more buff, fit(), fewer items on screen) rather than just shrinking fonts below the minimum.",
  ].join("\n");
}

/** The code from the first ```python block (or the whole reply if it is bare code). */
export function extractCode(reply: string): string | undefined {
  const m = /```(?:python|py)?\s*\n([\s\S]*?)```/.exec(reply);
  const code = (m ? m[1]! : reply).trim();
  return code.includes("class ExplainerScene") ? code + "\n" : undefined;
}

// ------------------------------------------------------------------ frame check

export const FRAME_PROBLEM_KINDS = ["overlap", "off_screen", "wrong_maths", "unreadable", "mismatch", "other"] as const;

export const FrameCheckSchema = z.object({
  frames: z.array(
    z.object({
      frame: z.number().int(),
      problems: z.array(
        z.object({
          kind: z.enum(FRAME_PROBLEM_KINDS),
          severity: z.enum(["blocker", "minor"]),
          description: z.string(),
        }),
      ),
    }),
  ),
  maths_correct: z.boolean(),
  maths_notes: z.string(),
  summary: z.string(),
});
export type FrameCheck = z.infer<typeof FrameCheckSchema>;

export const FRAME_CHECK_SYSTEM = `You are a strict quality reviewer for short maths explainer animations shown to Class 11-12 students on phones. You get the storyboard and still frames from the rendered video (each labelled with its time and the caption that should be on screen).
For EVERY frame, list problems:
- overlap: any text, formula or label touching or overlapping another one, or drawn on top of a curve, axis or shape (look closely at labels near graphs);
- off_screen: anything cut off at an edge, including curves or shapes running out of the frame;
- wrong_maths: an expression presented as correct that is mathematically wrong, a wrong step presented as correct, a CORRECT expression that is crossed out, struck through or coloured as wrong (check exactly which expression every cross/strike line covers), or a garbled/broken formula (missing symbols, stray characters, LaTeX errors). The storyboard's deliberate wrong step, shown in red or crossed out as the mistake, is NOT a problem;
- unreadable: text too small for a phone, poor contrast, or a cluttered layout;
- mismatch: the frame doesn't show what the storyboard scene says (missing caption, wrong caption, wrong content);
- other.
severity "blocker" if a student would be confused or misled, or the frame looks broken; "minor" for cosmetic nits. Be precise and concrete in descriptions (say which expression and where) so an animator can fix it. Do not invent problems: a clean frame has an empty problems list.
maths_correct: true only if every expression presented as correct in all frames is correct. A frame captured mid-transition may be slightly blended; judge the layout, not the blend.`;

export function frameCheckPrompt(graph: ConceptGraph, misconceptionId: string, storyboard: Storyboard, frames: { index: number; time: number; caption: string }[]): string {
  const m = graph.misconceptions.get(misconceptionId)!;
  const c = graph.get(m.concept_id);
  return [
    `Topic: ${c.name}. The video undoes this misconception: ${m.description}`,
    `Storyboard "${storyboard.title}":`,
    ...storyboard.scenes.map((s, i) => `Scene ${i + 1}: caption ${JSON.stringify(s.caption)}; shows: ${s.visual}${s.math.length ? `; maths: ${s.math.join(" | ")}` : ""}`),
    "",
    `${frames.length} frames follow, in order:`,
    ...frames.map((f) => `Frame ${f.index}: t=${f.time.toFixed(1)} s, caption should be ${JSON.stringify(f.caption)}`),
  ].join("\n");
}
