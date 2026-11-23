from manim import *
from progresso_manim import *

class ExplainerScene(ProgressoScene):
    def construct(self):
        # Scene 1: Initial (incorrect) formula
        self.caption("Does a^3 - b^3 factorize like this?")
        eq1 = MathTex(r"a^3 - b^3 = (a - b)(a^2 ", r"- ab", r" + b^2)")
        eq1[1].set_color(HILITE)
        formula1 = fit(eq1).move_to(CONTENT_CENTER)
        self.play(Write(formula1))
        self.play(Indicate(eq1[1], color=HILITE))
        self.wait(6)

        # Scene 2: Expansion process
        self.clear_content()
        self.caption("Let's test it. If we expand these brackets, do we get back to the start?")
        top_expr = MathTex(r"(a - b)(a^2 - ab + b^2)")
        expansion = MathTex(r"a^3 - a^2b + ab^2 - a^2b + ab^2 - b^3", font_size=40)
        group2 = VGroup(top_expr, expansion).arrange(DOWN, buff=1)
        fit(group2).move_to(CONTENT_CENTER)
        
        self.play(Write(top_expr))
        self.wait(2)
        # Showing distribution steps
        self.play(Write(expansion))
        self.wait(10)

        # Scene 3: Showing it's wrong
        self.clear_content()
        self.caption("The middle terms don't cancel! This formula is incorrect.")
        wrong_sum = MathTex(r"a^3 - 2a^2b + 2ab^2 - b^3")
        not_equal = MathTex(r"\neq a^3 - b^3", color=WRONG)
        group3 = VGroup(wrong_sum, not_equal).arrange(DOWN, buff=0.5)
        fit(group3).move_to(CONTENT_CENTER)
        
        self.play(Write(wrong_sum))
        self.wait(2)
        self.play(Write(not_equal))
        
        big_x = Cross(group3, stroke_color=WRONG, stroke_width=10)
        self.play(Create(big_x))
        self.wait(6)

        # Scene 4: Correcting the sign
        self.clear_content()
        self.caption("To cancel those terms, the middle sign must be positive.")
        correct_eq = MathTex(r"a^3 - b^3 = (a - b)(a^2 ", r"+ ab", r" + b^2)")
        correct_eq[1].set_color(CORRECT)
        fit(correct_eq).move_to(CONTENT_CENTER)
        
        self.play(Write(correct_eq))
        self.play(Indicate(correct_eq[1], color=CORRECT))
        self.wait(8)

        # Scene 5: Verifying the correct expansion
        self.clear_content()
        self.caption("Now, the expansion works perfectly.")
        exp2 = MathTex(r"a^3", r"+ a^2b", r"+ ab^2", r"- a^2b", r"- ab^2", r"- b^3")
        final_res = MathTex(r"a^3 - b^3")
        group5 = VGroup(exp2, final_res).arrange(DOWN, buff=1)
        fit(group5).move_to(CONTENT_CENTER)
        
        self.play(Write(exp2))
        self.wait(2)
        
        # Strikethroughs for cancellation
        line1 = Line(exp2[1].get_left(), exp2[1].get_right(), color=HILITE)
        line2 = Line(exp2[3].get_left(), exp2[3].get_right(), color=HILITE)
        line3 = Line(exp2[2].get_left(), exp2[2].get_right(), color=HILITE)
        line4 = Line(exp2[4].get_left(), exp2[4].get_right(), color=HILITE)
        
        self.play(Create(line1), Create(line2))
        self.wait(1.5)
        self.play(Create(line3), Create(line4))
        self.wait(2)
        
        self.play(Write(final_res))
        self.wait(8)

        # Scene 6: Numerical Example
        self.clear_content()
        self.caption("Example: Factorize x^3 - 27")
        ex1 = MathTex(r"x^3 - 3^3")
        ex2 = MathTex(r"(x - 3)(x^2 + (x)(3) + 3^2)")
        ex3 = MathTex(r"(x - 3)(x^2 + 3x + 9)", color=ACCENT)
        group6 = VGroup(ex1, ex2, ex3).arrange(DOWN, buff=0.6)
        fit(group6).move_to(CONTENT_CENTER)
        
        self.play(Write(ex1))
        self.wait(2)
        self.play(Write(ex2))
        self.wait(3)
        self.play(Write(ex3))
        self.wait(7)

        # Scene 7: Takeaway summary
        self.clear_content()
        self.caption("Takeaway: In a^3 - b^3, the signs are (minus) then (plus).")
        final_formula = MathTex(r"a^3 - b^3 = (a ", r"-", r" b)(a^2 ", r"+", r" ab + b^2)")
        final_formula[1].set_color(HILITE)
        final_formula[3].set_color(HILITE)
        
        box = SurroundingRectangle(final_formula, color=CORRECT, buff=0.4)
        group7 = VGroup(final_formula, box)
        fit(group7).move_to(CONTENT_CENTER)
        
        self.play(Write(final_formula))
        self.play(Create(box))
        self.play(Indicate(final_formula[1]), Indicate(final_formula[3]))
        self.wait(5)
