"""
Static check of LLM-generated Manim code before it is rendered on this machine.

Reads the code on stdin, prints JSON {"ok": bool, "errors": [str]}.
Allow-list, not block-list: only manim / progresso_manim / numpy / math /
random imports; no file, process, network or reflection builtins; no dunder
attribute access; exactly one ExplainerScene(ProgressoScene) with construct().
"""
import ast
import json
import sys

ALLOWED_IMPORTS = {"manim", "progresso_manim", "numpy", "math", "random"}
FORBIDDEN_NAMES = {
    "open", "exec", "eval", "compile", "__import__", "input", "globals", "locals", "vars",
    "getattr", "setattr", "delattr", "breakpoint", "memoryview", "exit", "quit", "help",
    "os", "sys", "subprocess", "shutil", "pathlib", "socket", "importlib", "builtins",
}
# Manim / helper constants that must keep their meaning (directions, layout, palette).
PROTECTED = {
    "UP", "DOWN", "LEFT", "RIGHT", "IN", "OUT", "ORIGIN", "UL", "UR", "DL", "DR", "PI", "TAU",
    "CONTENT_TOP", "CONTENT_BOTTOM", "CONTENT_LEFT", "CONTENT_RIGHT", "CONTENT_WIDTH", "CONTENT_HEIGHT", "CONTENT_CENTER",
    "INK", "MUTED", "ACCENT", "WRONG", "CORRECT", "HILITE", "BG",
}
# Manim classes that read files or the network.
FORBIDDEN_CALLS = {"ImageMobject", "SVGMobject", "Code", "VideoMobject", "add_sound"}


def check(src: str) -> list[str]:
    try:
        tree = ast.parse(src)
    except SyntaxError as e:
        return [f"SyntaxError line {e.lineno}: {e.msg}"]
    errors: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name.split(".")[0] not in ALLOWED_IMPORTS:
                    errors.append(f"line {node.lineno}: import of '{a.name}' is not allowed")
        elif isinstance(node, ast.ImportFrom):
            if (node.module or "").split(".")[0] not in ALLOWED_IMPORTS or node.level:
                errors.append(f"line {node.lineno}: import from '{node.module}' is not allowed")
        elif isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
            errors.append(f"line {node.lineno}: '{node.id}' is not allowed")
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("__"):
                errors.append(f"line {node.lineno}: dunder attribute '{node.attr}' is not allowed")
            if node.attr in FORBIDDEN_CALLS:
                errors.append(f"line {node.lineno}: '{node.attr}' is not allowed")
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in FORBIDDEN_CALLS:
            errors.append(f"line {node.lineno}: '{node.func.id}' is not allowed (no external files)")
        elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store) and node.id in PROTECTED:
            errors.append(f"line {node.lineno}: '{node.id}' is a Manim/helper constant and must not be reassigned")
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            errors.append(f"line {node.lineno}: global/nonlocal is not allowed")
        elif isinstance(node, ast.While):
            errors.append(f"line {node.lineno}: while loops are not allowed (use for loops with a fixed range)")
    scenes = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "ExplainerScene"]
    if len(scenes) != 1:
        errors.append("there must be exactly one class named ExplainerScene")
    else:
        cls = scenes[0]
        if not any(isinstance(b, ast.Name) and b.id == "ProgressoScene" for b in cls.bases):
            errors.append("ExplainerScene must subclass ProgressoScene")
        if not any(isinstance(f, ast.FunctionDef) and f.name == "construct" for f in cls.body):
            errors.append("ExplainerScene must define construct(self)")
        for f in cls.body:
            if isinstance(f, ast.FunctionDef) and f.name in {"setup", "tear_down", "play", "wait", "render"}:
                errors.append(f"ExplainerScene must not override {f.name}() (the base scene audits the layout there)")
    captions = sum(1 for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "caption")
    if captions < 3:
        errors.append(f"only {captions} self.caption(...) call(s): every scene of the storyboard needs its caption")
    return errors


if __name__ == "__main__":
    errs = check(sys.stdin.read())
    print(json.dumps({"ok": not errs, "errors": errs}))
