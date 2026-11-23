from manim import *
from progresso_manim import *

class ExplainerScene(ProgressoScene):
    def construct(self):
        # Scene 1: A common student answer (8s)
        self.caption("A common student answer for a standard integral:")
        expr1 = MathTex(r"\int 2x \, dx = x^2", font_size=54)
        expr1.move_to(CONTENT_CENTER)
        
        self.play(Write(expr1), run_time=2.0)
        self.wait(6.0)

        # Scene 2: Check by differentiating (10s)
        self.clear_content()
        self.caption("Let's check this by differentiating. It seems correct!")
        # Splitting to highlight 2x
        deriv_eq = MathTex(r"\frac{d}{dx}(", r"x^2", r") = ", r"2x", font_size=54)
        deriv_eq.move_to(CONTENT_CENTER)
        
        self.play(Write(deriv_eq), run_time=2.0)
        self.wait(1.5)
        
        # Highlight 2x
        self.play(
            deriv_eq[3].animate.set_color(HILITE),
            Indicate(deriv_eq[3], color=HILITE),
            run_time=1.5
        )
        
        # Arrow curving from result back to input
        arrow = CurvedArrow(
            deriv_eq[3].get_top() + UP * 0.2,
            deriv_eq[1].get_top() + UP * 0.2,
            angle=TAU / 4,
            color=ACCENT
        )
        self.play(Create(arrow), run_time=1.0)
        self.wait(4.0)

        # Scene 3: But wait... what about these functions? (12s)
        self.clear_content()
        self.caption("But wait... what about these functions?")
        
        l1 = MathTex(r"\frac{d}{dx}(x^2) = 2x", font_size=44)
        l2 = MathTex(r"\frac{d}{dx}(x^2", r" + 5", r") = 2x", font_size=44)
        l3 = MathTex(r"\frac{d}{dx}(x^2", r" - 3", r") = 2x", font_size=44)
        
        lines = VGroup(l1, l2, l3).arrange(DOWN, buff=0.5)
        fit(lines)
        lines.move_to(CONTENT_CENTER)

        self.play(Write(l1), run_time=1.5)
        self.play(Write(l2), Write(l3), run_time=2.0)
        self.wait(1.5)
        
        # Flash constants red and cross out
        self.play(
            l2[1].animate.set_color(WRONG),
            l3[1].animate.set_color(WRONG),
            run_time=1.0
        )
        cross2 = Cross(l2[1], stroke_color=WRONG, stroke_width=5)
        cross3 = Cross(l3[1], stroke_color=WRONG, stroke_width=5)
        self.play(Create(cross2), Create(cross3), run_time=1.0)
        self.wait(5.0)

        # Scene 4: An integral finds a family of curves (18s)
        self.clear_content()
        self.caption("An integral finds a family of curves with the same slope.")
        
        axes = Axes(
            x_range=[-2.5, 2.5, 1],
            y_range=[-2, 5, 1],
            x_length=6.5,
            y_length=4.0,
            tips=False
        ).set_color(MUTED)
        
        main_curve = axes.plot(lambda x: x**2, x_range=[-2.1, 2.1], color=CORRECT)
        
        # Ghost curves
        c_vals = [-1.5, -0.75, 0.75, 1.5, 2.25]
        ghosts = VGroup()
        for c in c_vals:
            # Keep curve inside y bounds
            x_lim = np.sqrt(max(0, 5-c)) if 5-c > 0 else 0
            x_range_val = [-min(2.1, x_lim), min(2.1, x_lim)]
            ghosts.add(axes.plot(lambda x, cv=c: x**2 + cv, x_range=x_range_val, color=ACCENT, stroke_opacity=0.4))
        
        formula_label = MathTex(r"y = x^2 + C", font_size=48).set_color(HILITE)
        
        viz = VGroup(axes, main_curve, ghosts)
        # Arrange to avoid overlap
        full_scene = VGroup(viz, formula_label).arrange(RIGHT, buff=0.8)
        fit(full_scene)
        full_scene.move_to(CONTENT_CENTER)
        
        self.play(Create(axes), run_time=1.5)
        self.play(Create(main_curve), run_time=1.5)
        self.wait(1.0)
        self.play(Write(formula_label), run_time=1.5)
        self.play(Create(ghosts), run_time=3.0)
        self.wait(9.5)

        # Scene 5: The Correct Rule (12s)
        self.clear_content()
        self.caption("The Correct Rule: Always add the constant of integration C.")
        
        rule = MathTex(r"\int f(x) \, dx = F(x)", r" + C", font_size=56)
        rule.move_to(CONTENT_CENTER)
        
        self.play(Write(rule[0]), run_time=2.0)
        self.play(FadeIn(rule[1], shift=UP*0.3), run_time=1.5)
        self.wait(1.5)
        
        self.play(
            rule[1].animate.set_color(CORRECT).scale(1.2),
            Indicate(rule[1], color=CORRECT),
            run_time=2.0
        )
        self.wait(5.0)

        # Scene 6: Worked Example: Integrating cos x (12s)
        self.clear_content()
        self.caption("Worked Example: Integrating cos x correctly.")
        
        prob = MathTex(r"\int \cos x \, dx", font_size=52).move_to(CONTENT_CENTER)
        self.play(Write(prob), run_time=2.0)
        self.wait(1.5)
        
        sol = MathTex(r"\int \cos x \, dx", r" = \sin x", r" + C", font_size=52)
        fit(sol)
        sol.move_to(CONTENT_CENTER)
        
        self.play(
            TransformMatchingTex(prob, sol),
            run_time=2.0
        )
        self.wait(1.0)
        self.play(sol[2].animate.set_color(CORRECT), run_time=1.0)
        self.wait(4.5)

        # Scene 7: Takeaway (10s)
        self.clear_content()
        self.caption("Takeaway: C represents the infinite family of possible solutions.")
        
        text_takeaway = MathTex(r"\text{Indefinite} = \text{Family of Curves}", font_size=48)
        
        # Minimalist family visual
        axes_mini = Axes(x_range=[-2,2], y_range=[-1,4], x_length=4, y_length=2, tips=False).set_color(MUTED)
        curves_mini = VGroup(*[axes_mini.plot(lambda x, cv=cv: x**2 + cv, x_range=[-1.4, 1.4], color=PURPLE) for cv in [-0.5, 0.5, 1.5]])
        family_viz = VGroup(axes_mini, curves_mini)
        
        final_group = VGroup(text_takeaway, family_viz).arrange(DOWN, buff=0.5)
        fit(final_group)
        final_group.move_to(CONTENT_CENTER)
        
        self.play(Write(text_takeaway), run_time=2.0)
        self.play(FadeIn(family_viz), run_time=2.0)
        self.play(Circumscribe(text_takeaway, color=HILITE), run_time=2.0)
        self.wait(4.0)
