# apps/

Applications built on `@progresso/core` (domain logic lives there, not here):

- `cli/`: command-line tools that need several packages, e.g. `pnpm analyse` (root-cause analysis; `--llm` uses `@progresso/llm`)
- `web/`: Next.js web app, from Phase 3 (diagnosis view, constellation, missions)
- `mcp/`: MCP server and MCP App widget, Phase 10
