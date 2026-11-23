from manim import *
from progresso_manim import *

class ExplainerScene(ProgressoScene):
    def construct(self):
        # ---------------------------------------------------------
        # Scene 1 (12 s)
        # ---------------------------------------------------------
        self.caption("Differentiating sin(x²): it feels natural to just write cos(x²). But is that complete?")
        
        eq1 = MathTex(r"\frac{d}{dx} \sin(x^2) = \cos(x^2)", font_size=48)
        scene1_grp = VGroup(eq1)
        fit(scene1_grp)
        scene1_grp.move_to(CONTENT_CENTER)

        self.play(Write(eq1), run_time=2.5)
        self.wait(1.5)

        cross = Cross(eq1, stroke_color=WRONG, stroke_width=6)
        q_mark = Text("?", font_size=48, color=WRONG).next_to(cross, UP, buff=0.2)
        
        self.play(Create(cross), FadeIn(q_mark, shift=UP * 0.2), run_time=2.0)
        self.wait(6.0)

        # ---------------------------------------------------------
        # Scene 2 (15 s)
        # ---------------------------------------------------------
        self.clear_content()
        self.caption("When x changes slightly, x² changes by 2x times as much! That is the inner speed.")

        # Top level track (x level)
        line1 = Line(LEFT * 3, RIGHT * 3, color=MUTED)
        label1 = Text("x level:", font_size=32, color=WHITE).next_to(line1, LEFT, buff=0.3)
        dot1_a = Dot(line1.point_from_proportion(0.3), color=ACCENT)
        dot1_b = Dot(line1.point_from_proportion(0.42), color=ACCENT)
        step1 = DoubleArrow(dot1_a.get_center(), dot1_b.get_center(), color=ACCENT, buff=0, tip_length=0.12)
        label_step1 = MathTex(r"\Delta x", color=ACCENT, font_size=36).next_to(step1, UP, buff=0.1)

        top_grp = VGroup(label1, line1, dot1_a, dot1_b, step1, label_step1)

        # Bottom level track (x^2 level)
        line2 = Line(LEFT * 3, RIGHT * 3, color=MUTED)
        label2 = Text("x² level:", font_size=32, color=WHITE).next_to(line2, LEFT, buff=0.3)
        dot2_a = Dot(line2.point_from_proportion(0.3), color=HILITE)
        dot2_b = Dot(line2.point_from_proportion(0.85), color=HILITE)
        step2 = DoubleArrow(dot2_a.get_center(), dot2_b.get_center(), color=HILITE, buff=0, tip_length=0.12)
        label_step2 = MathTex(r"\Delta (x^2) \approx 2x \cdot \Delta x", color=HILITE, font_size=36).next_to(step2, DOWN, buff=0.15)

        bot_grp = VGroup(label2, line2, dot2_a, dot2_b, step2, label_step2)

        scene2_grp = VGroup(top_grp, bot_grp).arrange(DOWN, buff=1.2)
        fit(scene2_grp)
        scene2_grp.move_to(CONTENT_CENTER)

        self.play(FadeIn(line1), FadeIn(label1), FadeIn(line2), FadeIn(label2), run_time=2.0)
        self.play(
            Create(dot1_a), Create(dot1_b), GrowFromCenter(step1), Write(label_step1),
            run_time=2.5
        )
        self.play(
            Create(dot2_a), Create(dot2_b), GrowFromCenter(step2), Write(label_step2),
            run_time=3.5
        )
        self.wait(7.0)

        # ---------------------------------------------------------
        # Scene 3 (16 s)
        # ---------------------------------------------------------
        self.clear_content()
        self.caption("Think of nested functions as linked gears: total speed is outer speed times inner speed.")

        def make_gear(radius, num_teeth, color):
            circle = Circle(radius=radius, color=color, stroke_width=3)
            teeth = VGroup()
            for i in range(num_teeth):
                angle = i * (2 * PI / num_teeth)
                tooth = Square(side_length=radius * 0.22, color=color, fill_opacity=0.3)
                tooth.move_to(circle.point_at_angle(angle))
                tooth.rotate(angle)
                teeth.add(tooth)
            spokes = VGroup(
                Line(circle.point_at_angle(0), circle.point_at_angle(PI), color=color, stroke_width=2),
                Line(circle.point_at_angle(PI/2), circle.point_at_angle(3*PI/2), color=color, stroke_width=2)
            )
            return VGroup(circle, teeth, spokes)

        gear_inner = make_gear(0.8, 8, ACCENT)
        gear_outer = make_gear(1.3, 13, PURPLE)

        lbl_inner = Text("Inner layer (x²)", font_size=30, color=ACCENT).next_to(gear_inner, DOWN, buff=0.2)
        lbl_outer = Text("Outer layer (sin)", font_size=30, color=PURPLE).next_to(gear_outer, DOWN, buff=0.2)

        inner_pack = VGroup(gear_inner, lbl_inner)
        outer_pack = VGroup(gear_outer, lbl_outer)
        gears_row = VGroup(inner_pack, outer_pack).arrange(RIGHT, buff=0.8)

        formula_gear = MathTex(
            r"\text{Total Speed}", r"=", r"\text{Outer Speed}", r"\times", r"\text{Inner Speed}",
            font_size=40
        )
        formula_gear[0].set_color(HILITE)
        formula_gear[2].set_color(PURPLE)
        formula_gear[4].set_color(ACCENT)

        scene3_grp = VGroup(gears_row, formula_gear).arrange(DOWN, buff=0.6)
        fit(scene3_grp)
        scene3_grp.move_to(CONTENT_CENTER)

        self.play(FadeIn(gears_row), run_time=2.0)
        self.play(Write(formula_gear), run_time=2.0)
        self.play(
            Rotate(gear_inner, angle=2 * PI, run_time=6.0, rate_func=linear),
            Rotate(gear_outer, angle=-2 * PI * (0.8 / 1.3), run_time=6.0, rate_func=linear)
        )
        self.wait(6.0)

        # ---------------------------------------------------------
        # Scene 4 (14 s)
        # ---------------------------------------------------------
        self.clear_content()
        self.caption("The Chain Rule: multiply the outer derivative by the derivative of the inner layer.")

        chain_eq = MathTex(
            r"\frac{d}{dx}\Big[ f(", r"g(x)", r"\Big)] = f'\Big(", r"g(x)", r"\Big) \cdot ", r"g'(x)",
            font_size=46
        )
        chain_eq[1].set_color(ACCENT)
        chain_eq[3].set_color(ACCENT)
        chain_eq[5].set_color(CORRECT)

        lbl_inner_rule = Text("Inner function", font_size=30, color=ACCENT).next_to(chain_eq[1], UP, buff=0.6)
        lbl_deriv_rule = Text("Inner derivative", font_size=30, color=CORRECT).next_to(chain_eq[5], DOWN, buff=0.6)

        arr_inner = Arrow(lbl_inner_rule.get_bottom(), chain_eq[1].get_top(), color=ACCENT, buff=0.1, tip_length=0.15)
        arr_deriv = Arrow(lbl_deriv_rule.get_top(), chain_eq[5].get_bottom(), color=CORRECT, buff=0.1, tip_length=0.15)

        scene4_grp = VGroup(chain_eq, lbl_inner_rule, lbl_deriv_rule, arr_inner, arr_deriv)
        fit(scene4_grp)
        scene4_grp.move_to(CONTENT_CENTER)

        self.play(Write(chain_eq), run_time=3.0)
        self.wait(1.0)
        self.play(
            FadeIn(lbl_inner_rule), GrowArrow(arr_inner),
            Indicate(chain_eq[1], color=ACCENT), Indicate(chain_eq[3], color=ACCENT),
            run_time=2.0
        )
        self.wait(1.0)
        self.play(
            FadeIn(lbl_deriv_rule), GrowArrow(arr_deriv),
            Indicate(chain_eq[5], color=CORRECT),
            run_time=2.0
        )
        self.wait(5.0)

        # ---------------------------------------------------------
        # Scene 5 (16 s)
        # ---------------------------------------------------------
        self.clear_content()
        self.caption("First take derivative of sine, then multiply by the derivative of the inner x² part.")

        step1_tex = MathTex(r"\frac{d}{dx} \sin(x^2)", font_size=44)
        step2_tex = MathTex(r"= \cos(x^2) \cdot ", r"\frac{d}{dx}(x^2)", font_size=44)
        step2_tex[1].set_color(HILITE)

        step3_tex = MathTex(r"= 2x \cos(x^2)", font_size=48, color=CORRECT)
        box_step3 = SurroundingRectangle(step3_tex, color=CORRECT, buff=0.15, corner_radius=0.1)
        step3_grp = VGroup(step3_tex, box_step3)

        scene5_grp = VGroup(step1_tex, step2_tex, step3_grp).arrange(DOWN, buff=0.5, aligned_edge=LEFT)
        fit(scene5_grp)
        scene5_grp.move_to(CONTENT_CENTER)

        self.play(Write(step1_tex), run_time=2.0)
        self.wait(1.5)
        self.play(Write(step2_tex), run_time=3.0)
        self.play(Indicate(step2_tex[1], color=HILITE), run_time=1.5)
        self.wait(1.5)
        self.play(Write(step3_tex), Create(box_step3), run_time=2.5)
        self.wait(4.0)

        # ---------------------------------------------------------
        # Scene 6 (12 s)
        # ---------------------------------------------------------
        self.clear_content()
        self.caption("Takeaway: Always identify the inner part and multiply by its derivative!")

        final_eq = MathTex(r"\frac{d}{dx} \sin(", r"x^2", r") = ", r"2x", r" \cos(x^2)", font_size=46)
        final_eq[1].set_color(ACCENT)
        final_eq[3].set_color(CORRECT)

        checkmark = Tex(r"\checkmark", font_size=60, color=CORRECT).next_to(final_eq, RIGHT, buff=0.3)
        top_result = VGroup(final_eq, checkmark)

        inner_note = MathTex(r"\text{Inner layer: } ", r"\frac{d}{dx}(x^2) = 2x", font_size=40)
        inner_note[1].set_color(CORRECT)

        scene6_grp = VGroup(top_result, inner_note).arrange(DOWN, buff=0.8)
        fit(scene6_grp)
        scene6_grp.move_to(CONTENT_CENTER)

        self.play(Write(final_eq), run_time=2.5)
        self.wait(1.0)
        self.play(FadeIn(checkmark, scale=1.5), run_time=1.5)
        self.play(Write(inner_note), run_time=2.0)
        self.play(Indicate(inner_note[1], color=CORRECT), run_time=1.5)
        self.wait(3.5)
