/**
 * Bundles each widget into ONE self-contained HTML file (inline JS and CSS,
 * maths arrives as MathML in the data), as MCP Apps hosts expect for a
 * ui:// resource. Output: apps/mcp/dist/{mission,progress}.html.
 *
 *   pnpm --filter @progresso/mcp build:ui
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(root, "dist");

const WIDGETS = [
  { entry: "src/ui/mission.ts", file: "mission.html", title: "Tonight's mission" },
  { entry: "src/ui/progress.ts", file: "progress.html", title: "Progress" },
] as const;

const SKELETON = `<div class="card loading" aria-busy="true"><div class="shimmer" style="width:40%"></div><div class="shimmer" style="width:85%;height:18px"></div><div class="shimmer" style="width:70%"></div><div class="shimmer" style="width:60%"></div></div>`;

/**
 * zod (a dependency of the MCP Apps SDK) re-exports every locale as a namespace,
 * which a bundler can't tree-shake: ~260 KB of error messages in 40 languages.
 * Only English is ever used here, so the locales index resolves to English alone.
 */
const zodEnglishOnly = {
  name: "zod-english-only",
  setup(b: Parameters<NonNullable<Parameters<typeof build>[0]["plugins"]>[number]["setup"]>[0]) {
    b.onResolve({ filter: /locales[\\/]index\.js$/ }, (args) => {
      if (!/[\\/]zod[\\/]/.test(args.importer)) return undefined;
      return { path: resolve(dirname(args.importer), args.path), namespace: "zod-locales" };
    });
    b.onLoad({ filter: /.*/, namespace: "zod-locales" }, (args) => ({
      contents: `export { default as en } from ${JSON.stringify(join(dirname(args.path), "en.js"))};`,
      loader: "js",
      resolveDir: dirname(args.path),
    }));
  },
};

function page(title: string, css: string, js: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Progresso · ${title}</title>
<style>${css}</style>
</head>
<body>
<div id="app">${SKELETON}</div>
<script>${js.replace(new RegExp("</(script)", "gi"), "<\\/$1")}</script>
</body>
</html>
`;
}

export async function buildWidgets(log = true): Promise<void> {
  mkdirSync(out, { recursive: true });
  for (const w of WIDGETS) {
    const res = await build({
      entryPoints: [join(root, w.entry)],
      bundle: true,
      minify: true,
      format: "iife",
      target: ["es2022", "chrome110", "safari16", "firefox110"],
      platform: "browser",
      write: false,
      outdir: out,
      legalComments: "none",
      plugins: [zodEnglishOnly],
      logLevel: "warning",
    });
    const js = res.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
    const css = res.outputFiles.find((f) => f.path.endsWith(".css"))?.text ?? "";
    const html = page(w.title, css, js);
    writeFileSync(join(out, w.file), html);
    if (log) console.error(`dist/${w.file}  ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB (js ${(js.length / 1024).toFixed(1)} KB, css ${(css.length / 1024).toFixed(1)} KB)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildWidgets();
