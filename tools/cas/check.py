"""
Symbolic check for generated maths questions (SymPy).

Reads a JSON list of checks on stdin, writes a JSON list of results on stdout.
Each check:
  { "id": str, "mode": "equal" | "antiderivative" | "numeric" | "set",
    "symbols": [str], "compute": str, "answer": str, "wrong": [str] }
- compute: a SymPy expression that works the answer out from scratch,
           e.g. "diff(sin(x**2), x)" or "integrate(cos(x)**2, x)".
- answer:  the keyed correct answer, e.g. "2*x*cos(x**2)".
- wrong:   the distractors; each must NOT be equivalent to the answer.

The expressions come from an LLM, so they are never passed to eval directly:
every identifier must be on an allow-list (SymPy functions and declared
symbols), and attribute access, strings, dunders and statements are rejected
before sympify sees them.
"""
import json
import random
import re
import sys

import sympy as sp

ALLOWED_FUNCS = {
    "diff", "integrate", "limit", "Limit", "Derivative", "Integral", "simplify", "expand", "factor", "solve",
    "sin", "cos", "tan", "cot", "sec", "csc", "asin", "acos", "atan", "acot", "asec", "acsc",
    "sinh", "cosh", "tanh", "exp", "log", "ln", "sqrt", "Abs", "pi", "E", "I", "oo", "Rational",
    "Matrix", "det", "summation", "binomial", "factorial", "Eq", "Symbol", "S", "nsimplify", "N",
    "trigsimp", "expand_trig", "cancel", "apart", "together", "FiniteSet", "Interval", "floor", "ceiling",
    "sign", "Min", "Max", "atan2", "re", "im", "conjugate",
}
IDENT = re.compile(r"[A-Za-z_][A-Za-z_0-9]*")
FORBIDDEN = re.compile(r"__|\.[A-Za-z_]|['\"`;\\]|\blambda\b|\bimport\b|\bexec\b|\beval\b|\bopen\b|=(?!=)")


class Unsafe(Exception):
    pass


def namespace(symbols):
    ns = {name: getattr(sp, name) for name in ALLOWED_FUNCS if hasattr(sp, name)}
    ns["ln"] = sp.log
    ns["det"] = lambda m: sp.Matrix(m).det()
    for s in symbols:
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,15}", s):
            raise Unsafe(f"bad symbol name {s!r}")
        ns[s] = sp.Symbol(s, real=True)
    return ns


def parse(text, ns):
    if not isinstance(text, str) or len(text) > 600:
        raise Unsafe("expression missing or too long")
    t = text.replace("^", "**")
    if FORBIDDEN.search(t.replace("==", "")):
        raise Unsafe(f"forbidden syntax in {text!r}")
    for name in IDENT.findall(t):
        if name not in ns:
            raise Unsafe(f"unknown name {name!r} in {text!r}")
    return sp.sympify(t, locals=ns, convert_xor=True)


def as_value(e):
    if hasattr(e, "doit"):
        e = e.doit()
    return e


def numeric_equal(a, b, symbols, ns, trials=8):
    """Spot-check at random points (handles trig/log forms simplify misses)."""
    syms = [ns[s] for s in symbols]
    rng = random.Random(7)
    ok = 0
    for _ in range(trials * 3):
        point = {s: sp.Rational(rng.randint(11, 140), 100) for s in syms}
        try:
            va = complex(sp.N(a.subs(point), 30))
            vb = complex(sp.N(b.subs(point), 30))
        except Exception:
            continue
        if any(map(lambda v: v != v or abs(v) == float("inf"), (va.real, vb.real))):
            continue
        if abs(va - vb) > 1e-7 * max(1.0, abs(va), abs(vb)):
            return False
        ok += 1
        if ok >= trials:
            return True
    return ok >= 3


def equivalent(a, b, mode, symbols, ns):
    a, b = as_value(a), as_value(b)
    if mode == "set":
        sa = set(a) if isinstance(a, (list, tuple, set, sp.FiniteSet)) else {a}
        sb = set(b) if isinstance(b, (list, tuple, set, sp.FiniteSet)) else {b}
        if len(sa) != len(sb):
            return False
        return all(any(sp.simplify(x - y) == 0 for y in sb) for x in sa)
    if mode == "numeric":
        return abs(complex(sp.N(a)) - complex(sp.N(b))) <= 1e-6 * max(1.0, abs(complex(sp.N(b))))
    if mode == "antiderivative":
        if not symbols:
            return False
        x = ns[symbols[0]]
        d = sp.diff(a - b, x)
        return sp.simplify(d) == 0 or numeric_equal(sp.diff(a, x), sp.diff(b, x), symbols, ns)
    diff = sp.simplify(a - b)
    if diff == 0:
        return True
    if not symbols:
        try:
            return abs(complex(sp.N(diff))) < 1e-9
        except Exception:
            return False
    return numeric_equal(a, b, symbols, ns)


def run(check):
    out = {"id": check.get("id"), "ok": False}
    try:
        mode = check.get("mode", "equal")
        symbols = check.get("symbols") or []
        ns = namespace(symbols)
        computed = parse(check["compute"], ns)
        answer = parse(check["answer"], ns)
        out["computed"] = str(as_value(computed))
        out["answer_matches"] = bool(equivalent(computed, answer, mode, symbols, ns))
        wrong = []
        for w in check.get("wrong", []):
            try:
                wrong.append(not equivalent(parse(w, ns), answer, mode, symbols, ns))
            except Unsafe as e:
                raise e
            except Exception as e:  # unparsable distractor: can't prove it differs
                wrong.append(False)
                out.setdefault("notes", []).append(f"distractor {w!r}: {e}")
        out["wrong_distinct"] = wrong
        out["ok"] = out["answer_matches"] and all(wrong)
    except Unsafe as e:
        out["error"] = f"unsafe: {e}"
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {e}"
    return out


def main():
    checks = json.load(sys.stdin)
    json.dump([run(c) for c in checks], sys.stdout)


if __name__ == "__main__":
    main()
