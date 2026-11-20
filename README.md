# Progresso

Turns an AI exam-diagnosis report (CBSE Class 11–12) into a short, personal plan:
**diagnose → find the root gap → fix it in daily missions → prove it's fixed → keep it fixed until exam day.**

Prototype. Everything about the product, scope rules, architecture and commands is in [CLAUDE.md](CLAUDE.md).
Progress: [docs/progress.md](docs/progress.md).

```bash
pnpm install
cp .env.example .env   # set GEMINI_API_KEY
pnpm verify            # typecheck, lint, tests, graph validation
pnpm db:seed           # load the demo students (sample data)
```
