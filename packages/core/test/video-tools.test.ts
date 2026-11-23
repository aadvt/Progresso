/**
 * The static safety check for generated Manim code (tools/manim/lint.py).
 * Generated code runs on this machine, so this is an allow-list check.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findRepoRoot } from "../src";

const lint = join(findRepoRoot(), "tools", "manim", "lint.py");
const hasPython = spawnSync("python", ["--version"]).status === 0;

function check(code: string): string[] {
  const r = spawnSync("python", ["-I", lint], { input: code, encoding: "utf8" });
  return (JSON.parse(r.stdout) as { errors: string[] }).errors;
}

const ok = `from manim import *
from progresso_manim import *
import numpy as np

class ExplainerScene(ProgressoScene):
    def construct(self):
        self.caption("one")
        self.caption("two")
        for i in range(3):
            self.wait(0.5)
        self.caption("three")
`;

describe.skipIf(!hasPython)("generated-code lint", () => {
  it("accepts a plain scene", () => {
    expect(check(ok)).toEqual([]);
  });
  it.each([
    ["import os", "import of 'os'"],
    ["import subprocess as s", "import of 'subprocess'"],
    ["from pathlib import Path", "import from 'pathlib'"],
    ["x = open('a.txt')", "'open' is not allowed"],
    ["x = eval('1')", "'eval' is not allowed"],
    ["x = ().__class__", "dunder attribute"],
    ["x = getattr(1, 'real')", "'getattr' is not allowed"],
    ["x = ImageMobject('a.png')", "'ImageMobject' is not allowed"],
    ["while True:\n    pass", "while loops"],
    ['RIGHT = "#00FF00"', "must not be reassigned"],
  ])("rejects %s", (line, msg) => {
    expect(check(`${line}\n${ok}`).join(" ")).toContain(msg);
  });
  it("requires one ExplainerScene on the audited base scene, with captions, not overriding the audit hooks", () => {
    expect(check(ok.replace("ProgressoScene)", "Scene)")).join(" ")).toContain("must subclass ProgressoScene");
    expect(check(ok.replace("class ExplainerScene", "class Other")).join(" ")).toContain("exactly one class named ExplainerScene");
    expect(check(ok.replace(/ {8}self\.caption\("(two|three)"\)\n/g, "")).join(" ")).toContain("self.caption");
    expect(check(ok.replace("    def construct", "    def wait(self):\n        pass\n    def construct")).join(" ")).toContain("must not override wait()");
  });
  it("reports syntax errors", () => {
    expect(check("class ExplainerScene(:\n").join(" ")).toContain("SyntaxError");
  });
});
