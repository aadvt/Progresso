"""
Shared base for generated explainer animations (Phase 7).

Every generated scene subclasses ProgressoScene. It gives the LLM a small,
safe vocabulary (palette, caption band, content area) and audits the layout
deterministically while rendering:

- after every play()/wait(), each visible text-like mobject (Text, MathTex,
  Tex, numbers) is checked for: leaving the frame, overlapping another text,
  sitting in the caption band, or being too small to read;
- every caption is time-stamped, which gives exact frame times for the
  vision check and a WebVTT captions track.

The audit is written as JSON to $PROGRESSO_AUDIT when the scene ends.
"""
from __future__ import annotations

import json
import os
import textwrap

from manim import (
    DOWN,
    UP,
    BackgroundRectangle,
    DecimalNumber,
    FadeIn,
    FadeOut,
    Integer,
    MarkupText,
    MathTex,
    Mobject,
    Paragraph,
    Scene,
    SingleStringMathTex,
    Tex,
    Text,
    VGroup,
    config,
)

# ------------------------------------------------------------------ palette
BG = "#0E1222"
INK = "#ECEFF7"
MUTED = "#9AA3BD"
ACCENT = "#7AA2FF"
WRONG = "#FF6B6B"
CORRECT = "#4ADE80"
HILITE = "#FFD166"
PURPLE = "#C4A1FF"

config.background_color = BG

# ------------------------------------------------------------------ layout (Manim units; frame is 14.22 x 8)
FRAME_W = config.frame_width
FRAME_H = config.frame_height
MARGIN = 0.35
#: Content must stay inside this box: above the caption band, inside the margins.
CONTENT_TOP = FRAME_H / 2 - MARGIN
CONTENT_BOTTOM = -FRAME_H / 2 + 1.55
CONTENT_LEFT = -FRAME_W / 2 + MARGIN
CONTENT_RIGHT = FRAME_W / 2 - MARGIN
CONTENT_WIDTH = CONTENT_RIGHT - CONTENT_LEFT
CONTENT_HEIGHT = CONTENT_TOP - CONTENT_BOTTOM
#: Vertical centre of the content area (use .move_to(CONTENT_CENTER)).
CONTENT_CENTER = (CONTENT_TOP + CONTENT_BOTTOM) / 2 * UP
CAPTION_Y = -FRAME_H / 2 + 0.75
CAPTION_FONT = 30
CAPTION_CHARS_PER_LINE = 58
CAPTION_MAX_CHARS = 120

TEXT_TYPES = (Text, MarkupText, Paragraph, MathTex, Tex, SingleStringMathTex, DecimalNumber, Integer)
# On a phone the video is ~360 px wide (25 px per unit): below these sizes text is unreadable.
MIN_TEXT_FONT = 28
MIN_MATH_FONT = 34


def _font_size(m: Mobject) -> float | None:
    """The effective font size after any scaling (None when the type has none)."""
    try:
        v = getattr(m, "font_size", None)
        return float(v) if v is not None else None
    except Exception:  # noqa: BLE001
        return None


def fit(mob: Mobject, width: float = CONTENT_WIDTH, height: float = CONTENT_HEIGHT) -> Mobject:
    """Scale a mobject down (never up) so it fits the given box."""
    if mob.width > width:
        mob.scale_to_fit_width(width)
    if mob.height > height:
        mob.scale_to_fit_height(height)
    return mob


def _text_of(mob: Mobject) -> str:
    for attr in ("text", "tex_string", "original_text"):
        v = getattr(mob, attr, None)
        if isinstance(v, str) and v.strip():
            return v.strip()[:80]
    if hasattr(mob, "get_value"):
        try:
            return str(mob.get_value())
        except Exception:  # noqa: BLE001
            pass
    return type(mob).__name__


def _visible(mob: Mobject) -> bool:
    leaves = mob.family_members_with_points()
    if not leaves:
        return False
    best = 0.0
    for m in leaves:
        try:
            best = max(best, float(m.get_fill_opacity()), float(m.get_stroke_opacity()) if m.get_stroke_width() > 0 else 0.0)
        except Exception:  # noqa: BLE001
            best = max(best, 1.0)
    return best > 0.08


class ProgressoScene(Scene):
    """Base scene: captions in a fixed band at the bottom, everything else in the content area above it."""

    def setup(self) -> None:
        super().setup()
        self._captions: list[dict] = []
        self._caption_mob: Mobject | None = None
        self._issues: dict[tuple, dict] = {}
        #: Still moments (inside wait()): the frame check samples these, never mid-animation.
        self._holds: list[dict] = []

    # -------------------------------------------------------------- captions
    def caption(self, text: str, run_time: float = 0.5) -> None:
        """Show an on-screen caption (replacing the previous one). Keep it under 120 characters."""
        text = " ".join(text.split())
        now = self._now()
        if self._captions and self._captions[-1]["end"] is None:
            self._captions[-1]["end"] = now
        if len(text) > CAPTION_MAX_CHARS:
            self._issue("caption_too_long", [text[:80]], f"caption has {len(text)} characters (max {CAPTION_MAX_CHARS})")
        lines = textwrap.wrap(text, CAPTION_CHARS_PER_LINE) or [""]
        if len(lines) > 2:
            self._issue("caption_too_long", [text[:80]], f"caption wraps to {len(lines)} lines (max 2)")
        mob = Paragraph(*lines, font_size=CAPTION_FONT, color=INK, alignment="center", line_spacing=0.8)
        mob.set_z_index(100)
        fit(mob, CONTENT_WIDTH, 1.2)
        mob.move_to([0, CAPTION_Y, 0])
        mob.is_caption = True  # type: ignore[attr-defined]
        anims = [FadeIn(mob, shift=0.1 * UP)]
        if self._caption_mob is not None:
            anims.append(FadeOut(self._caption_mob))
        self._caption_mob = mob
        self._captions.append({"start": round(now, 3), "end": None, "text": text})
        super().play(*anims, run_time=run_time)
        self._audit()

    def clear_caption(self, run_time: float = 0.3) -> None:
        if self._caption_mob is not None:
            if self._captions and self._captions[-1]["end"] is None:
                self._captions[-1]["end"] = self._now()
            super().play(FadeOut(self._caption_mob), run_time=run_time)
            self._caption_mob = None

    def clear_content(self, run_time: float = 0.5) -> None:
        """Fade out everything except the caption."""
        keep = self._caption_mob
        mobs = [m for m in self.mobjects if m is not keep]
        if mobs:
            super().play(*[FadeOut(m) for m in mobs], run_time=run_time)

    # -------------------------------------------------------------- audit hooks
    def play(self, *args, **kwargs):  # noqa: ANN002, ANN003
        result = super().play(*args, **kwargs)
        self._audit()
        return result

    def wait(self, *args, **kwargs):  # noqa: ANN002, ANN003
        start = self._now()
        result = super().wait(*args, **kwargs)
        if self._now() - start >= 0.4:
            self._holds.append({"start": round(start, 3), "end": round(self._now(), 3)})
        self._audit()
        return result

    def _now(self) -> float:
        return float(getattr(self.renderer, "time", 0.0))

    def _issue(self, kind: str, texts: list[str], detail: str) -> None:
        key = (kind, tuple(texts))
        if key in self._issues:
            self._issues[key]["count"] += 1
            return
        self._issues[key] = {"kind": kind, "at": round(self._now(), 2), "texts": texts, "detail": detail, "count": 1}

    def _text_leaves(self) -> list[Mobject]:
        out: list[Mobject] = []

        def visit(m: Mobject) -> None:
            if isinstance(m, TEXT_TYPES):
                if _visible(m):
                    out.append(m)
                return
            if isinstance(m, BackgroundRectangle):
                return
            for s in m.submobjects:
                visit(s)

        for m in self.mobjects:
            visit(m)
        return out

    def _audit(self) -> None:
        leaves = self._text_leaves()
        half_w, half_h = FRAME_W / 2, FRAME_H / 2
        boxes = []
        for m in leaves:
            if m.width == 0 and m.height == 0:
                continue
            l, r = m.get_left()[0], m.get_right()[0]
            b, t = m.get_bottom()[1], m.get_top()[1]
            caption = bool(getattr(m, "is_caption", False))
            label = "caption" if caption else _text_of(m)
            if l < -half_w + 0.05 or r > half_w - 0.05 or b < -half_h + 0.05 or t > half_h - 0.05:
                self._issue("off_screen", [label], f"text extends outside the frame (x {l:.2f}..{r:.2f}, y {b:.2f}..{t:.2f})")
            elif not caption and b < CONTENT_BOTTOM - 0.05:
                self._issue("in_caption_band", [label], f"content text reaches into the caption band (bottom y={b:.2f}, must stay above {CONTENT_BOTTOM:.2f})")
            size = _font_size(m)
            minimum = MIN_MATH_FONT if isinstance(m, (MathTex, Tex, SingleStringMathTex)) else MIN_TEXT_FONT
            if not caption and size is not None and size < minimum - 0.5:
                self._issue("too_small", [label], f"font size {size:.0f} is too small to read on a phone (minimum {minimum})")
            boxes.append((l, r, b, t, label, m))
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                a, c = boxes[i], boxes[j]
                ix = min(a[1], c[1]) - max(a[0], c[0])
                iy = min(a[3], c[3]) - max(a[2], c[2])
                if ix <= 0.02 or iy <= 0.02:
                    continue
                smaller = min((a[1] - a[0]) * (a[3] - a[2]), (c[1] - c[0]) * (c[3] - c[2]))
                if smaller > 0 and ix * iy / smaller > 0.12:
                    self._issue("overlap", sorted([a[4], c[4]]), f"two texts overlap ({ix * iy / smaller:.0%} of the smaller one)")

    def tear_down(self) -> None:
        if self._captions and self._captions[-1]["end"] is None:
            self._captions[-1]["end"] = self._now()
        path = os.environ.get("PROGRESSO_AUDIT")
        if path:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(
                    {"duration": round(self._now(), 3), "captions": self._captions, "holds": self._holds, "issues": list(self._issues.values())},
                    f,
                    indent=2,
                )
        super().tear_down()


__all__ = [
    "ProgressoScene",
    "fit",
    "BG",
    "INK",
    "MUTED",
    "ACCENT",
    "WRONG",
    "CORRECT",
    "HILITE",
    "PURPLE",
    "CONTENT_TOP",
    "CONTENT_BOTTOM",
    "CONTENT_LEFT",
    "CONTENT_RIGHT",
    "CONTENT_WIDTH",
    "CONTENT_HEIGHT",
    "CONTENT_CENTER",
    "VGroup",
    "DOWN",
]
