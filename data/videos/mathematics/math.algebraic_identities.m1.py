from manim import *
from progresso_manim import *

class ExplainerScene(ProgressoScene):
    def construct(self):
        # ----------------------------------------------------
        # Scene 1 (12 s)
        # ----------------------------------------------------
        self.caption("Does squaring a sum mean just squaring each individual term?")
        
        eq1 = MathTex(r"(x + 3)^2 = x^2 + 3^2 = x^2 + 9", font_size=48)
        fit(eq1, width=CONTENT_WIDTH, height=CONTENT_HEIGHT)
        eq1.move_to(CONTENT_CENTER)
        
        self.play(Write(eq1), run_time=2)
        self.wait(2)
        
        self.play(eq1.animate.set_color(WRONG), run_time=1.5)
        cross = Cross(eq1, stroke_color=WRONG, stroke_width=6)
        self.play(Create(cross), run_time=1.5)
        self.wait(5)
        
        # ----------------------------------------------------
        # Scene 2 (14 s)
        # ----------------------------------------------------
        self.clear_content()
        self.caption("Let us test x = 1 to check if both sides give the same value.")
        
        lhs = MathTex(r"\text{LHS: } (1+3)^2 = 4^2 = 16", font_size=42, color=CORRECT)
        rhs = MathTex(r"\text{RHS: } 1^2 + 9 = 10", font_size=42, color=WRONG)
        ineq = MathTex(r"16 \neq 10", font_size=52, color=HILITE)
        diff = MathTex(r"\text{Missing Difference} = 6", font_size=38, color=MUTED)
        
        scene2_vg = VGroup(lhs, rhs, ineq, diff).arrange(DOWN, buff=0.4)
        fit(scene2_vg, width=CONTENT_WIDTH, height=CONTENT_HEIGHT)
        scene2_vg.move_to(CONTENT_CENTER)
        
        self.play(Write(lhs), run_time=2)
        self.wait(1.5)
        self.play(Write(rhs), run_time=2)
        self.wait(1.5)
        self.play(Write(ineq), run_time=1.5)
        self.play(Indicate(ineq, color=HILITE), run_time=1)
        self.play(Write(diff), run_time=1.5)
        self.wait(3)
        
        # ----------------------------------------------------
        # Scene 3 (16 s)
        # ----------------------------------------------------
        self.clear_content()
        self.caption("Picture a large square with total side length (a + b).")
        
        a_len, b_len = 2.2, 1.0
        rect_a2 = Rectangle(width=a_len, height=a_len, fill_color=ACCENT, fill_opacity=0.5, stroke_color=WHITE)
        rect_ab1 = Rectangle(width=b_len, height=a_len, fill_color=HILITE, fill_opacity=0.5, stroke_color=WHITE)
        rect_ab2 = Rectangle(width=a_len, height=b_len, fill_color=HILITE, fill_opacity=0.5, stroke_color=WHITE)
        rect_b2 = Rectangle(width=b_len, height=b_len, fill_color=CORRECT, fill_opacity=0.5, stroke_color=WHITE)
        
        rect_a2.move_to([-b_len / 2, b_len / 2, 0])
        rect_ab1.next_to(rect_a2, RIGHT, buff=0)
        rect_ab2.next_to(rect_a2, DOWN, buff=0)
        rect_b2.next_to(rect_ab2, RIGHT, buff=0)
        
        label_a2 = MathTex(r"a^2", font_size=40).move_to(rect_a2)
        label_ab1 = MathTex(r"ab", font_size=40).move_to(rect_ab1)
        label_ab2 = MathTex(r"ab", font_size=40).move_to(rect_ab2)
        label_b2 = MathTex(r"b^2", font_size=40).move_to(rect_b2)
        
        labels_inside = VGroup(label_a2, label_ab1, label_ab2, label_b2)
        geo_shapes = VGroup(rect_a2, rect_ab1, rect_ab2, rect_b2)
        
        label_a_top = MathTex(r"a", font_size=36).next_to(rect_a2, UP, buff=0.15)
        label_b_top = MathTex(r"b", font_size=36).next_to(rect_ab1, UP, buff=0.15)
        label_a_left = MathTex(r"a", font_size=36).next_to(rect_a2, LEFT, buff=0.15)
        label_b_left = MathTex(r"b", font_size=36).next_to(rect_ab2, LEFT, buff=0.15)
        
        side_labels = VGroup(label_a_top, label_b_top, label_a_left, label_b_left)
        diagram = VGroup(geo_shapes, labels_inside, side_labels)
        
        eq_distrib = MathTex(r"(a+b)(a+b) = a(a+b) + b(a+b)", font_size=38)
        
        scene3_group = VGroup(diagram, eq_distrib).arrange(RIGHT, buff=0.8)
        fit(scene3_group, width=CONTENT_WIDTH, height=CONTENT_HEIGHT)
        scene3_group.move_to(CONTENT_CENTER)
        
        self.play(Create(geo_shapes), Write(side_labels), run_time=3)
        self.play(Write(labels_inside), run_time=2)
        self.wait(1.5)
        self.play(Write(eq_distrib), run_time=2.5)
        self.wait(7)
        
        # ----------------------------------------------------
        # Scene 4 (15 s)
        # ----------------------------------------------------
        self.clear_content()
        self.caption("The total area combines the two squares and two rectangle terms!")
        
        diagram_copy = diagram.copy()
        
        eq_line1 = MathTex(r"(a+b)^2 =", r"a^2", r"+", r"ab", r"+", r"ab", r"+", r"b^2", font_size=40)
        eq_line1[1].set_color(ACCENT)
        eq_line1[3].set_color(HILITE)
        eq_line1[5].set_color(HILITE)
        eq_line1[7].set_color(CORRECT)
        
        right_vg = VGroup(eq_line1)
        scene4_group = VGroup(diagram_copy, right_vg).arrange(RIGHT, buff=0.8)
        fit(scene4_group, width=CONTENT_WIDTH, height=CONTENT_HEIGHT)
        scene4_group.move_to(CONTENT_CENTER)
        
        eq_line2 = MathTex(r"(a+b)^2 =", r"a^2", r"+", r"2ab", r"+", r"b^2", font_size=44)
        eq_line2[1].set_color(ACCENT)
        eq_line2[3].set_color(HILITE)
        eq_line2[5].set_color(CORRECT)
        eq_line2.move_to(eq_line1)
        
        self.play(FadeIn(diagram_copy), run_time=1.5)
        self.play(Write(eq_line1), run_time=3)
        self.wait(1.5)
        self.play(Indicate(eq_line1[3], color=HILITE), Indicate(eq_line1[5], color=HILITE), run_time=1.5)
        self.play(ReplacementTransform(eq_line1, eq_line2), run_time=2)
        box = SurroundingRectangle(eq_line2, color=CORRECT, buff=0.15)
        self.play(Create(box), run_time=1.5)
        self.wait(4)
        
        # ----------------------------------------------------
        # Scene 5 (15 s)
        # ----------------------------------------------------
        self.clear_content()
        self.caption("Now expand (x + 3)^2 correctly by including the 2ab term.")
        
        line1 = MathTex(r"(x + 3)^2", font_size=46)
        line2 = MathTex(r"= x^2 + ", r"2 \cdot x \cdot 3", r"+ 3^2", font_size=46)
        line2[1].set_color(HILITE)
        line3 = MathTex(r"= x^2 + 6x + 9", font_size=48, color=CORRECT)
        
        scene5_vg = VGroup(line1, line2, line3).arrange(DOWN, buff=0.5)
        fit(scene5_vg, width=CONTENT_WIDTH, height=CONTENT_HEIGHT)
        scene5_vg.move_to(CONTENT_CENTER)
        
        self.play(Write(line1), run_time=1.5)
        self.wait(1)
        self.play(Write(line2), run_time=2.5)
        self.play(Indicate(line2[1], color=HILITE), run_time=1.5)
        self.wait(1.5)
        self.play(Write(line3), run_time=2.5)
        box3 = SurroundingRectangle(line3, color=CORRECT, buff=0.15)
        self.play(Create(box3), run_time=1.5)
        self.wait(3)
        
        # ----------------------------------------------------
        # Scene 6 (14 s)
        # ----------------------------------------------------
        self.clear_content()
        self.caption("Checking x = 1 gives 1 + 6 + 9 = 16. It works!")
        
        check_eq1 = MathTex(r"(1 + 3)^2 = 1^2 + 6(1) + 9", font_size=42)
        check_eq2 = MathTex(r"16 = 1 + 6 + 9 = 16", font_size=44, color=CORRECT)
        checkmark = MathTex(r"\checkmark", font_size=56, color=CORRECT)
        
        check_row = VGroup(check_eq2, checkmark).arrange(RIGHT, buff=0.3)
        
        takeaway_text = Text("Squaring a sum always creates the middle term 2ab!", font_size=32, color=HILITE)
        takeaway_box = SurroundingRectangle(takeaway_text, color=HILITE, buff=0.2)
        takeaway_grp = VGroup(takeaway_box, takeaway_text)
        
        scene6_vg = VGroup(check_eq1, check_row, takeaway_grp).arrange(DOWN, buff=0.5)
        fit(scene6_vg, width=CONTENT_WIDTH, height=CONTENT_HEIGHT)
        scene6_vg.move_to(CONTENT_CENTER)
        
        self.play(Write(check_eq1), run_time=2)
        self.wait(1)
        self.play(Write(check_eq2), FadeIn(checkmark, scale=0.5), run_time=2.5)
        self.wait(1.5)
        self.play(FadeIn(takeaway_grp, shift=UP), run_time=1.5)
        self.wait(5.5)
