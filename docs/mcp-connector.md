# Progresso in Claude: connector setup and demo script

The MCP server (`apps/mcp`) lets a student ask Claude "what should I study tonight?" and get the mission as an interactive widget in the conversation. It reads and writes the same database as the web app, so an answer given in Claude shows up on the web app's constellation.

All students are **SAMPLE DATA** demo students.

---

## 1. Run it locally

Three terminals, from the repo root:

```bash
# 1. The web app (the constellation you'll watch update)
pnpm web:build && pnpm web:start          # http://localhost:3100   (pnpm web:dev also works)

# 2. The MCP server, with an access token because it will be public through the tunnel
#    PowerShell:  $env:PROGRESSO_MCP_TOKEN = "pick-a-long-random-string"; pnpm mcp
PROGRESSO_MCP_TOKEN=pick-a-long-random-string pnpm mcp
#    → [progresso-mcp] listening on http://127.0.0.1:3101/mcp (access token required)

# 3. The tunnel (see step 2)
```

Pick a real random token, e.g. `node -e "console.log(crypto.randomUUID())"`. You can also put `PROGRESSO_MCP_TOKEN=…` in `.env`.

In the web app, open the student picker, choose **Riya**, add her report (the demo parser), and open **Map** (the constellation). Leave that tab open: it syncs every 3 seconds.

## 2. Expose the server through a tunnel

Claude on the web connects from Anthropic's servers, so `localhost` isn't reachable. Use either:

**cloudflared (no account needed):**

```bash
npx cloudflared tunnel --url http://localhost:3101
```

Copy the `https://<random-words>.trycloudflare.com` URL it prints. It changes every time you restart cloudflared.

**ngrok (installed on this machine; needs a free account and `ngrok config add-authtoken …` once):**

```bash
ngrok http 3101
```

Copy the `https://….ngrok-free.app` forwarding URL.

Check the tunnel works: open `https://<tunnel>/health` in a browser. It should show `{"ok":true,"name":"progresso",…}`.

Your connector URL is:

```
https://<tunnel>/mcp?token=<your-token>&student=demo-riya
```

- `token` keeps strangers off the tunnel. Without it the server answers `401`, which makes Claude try OAuth and fail, so always include it.
- `student=demo-riya` binds the connector to Riya: tools stop asking which student. Leave it out to choose a student per question (`demo-riya`, `demo-kabir`, `demo-ananya`, `demo-vihaan`).

## 3. Add it to Claude as a custom connector

1. In Claude (claude.ai), open **Settings → Connectors** (on Team/Enterprise plans an owner may need to allow custom connectors first).
2. Click **Add custom connector**.
3. **Name:** `Progresso`. **Remote MCP server URL:** the connector URL from step 2. Leave the OAuth fields empty.
4. Click **Add**. Claude lists six tools: `get_tonight_mission`, `submit_answer`, `finish_mission`, `get_progress`, `explain_my_mistake`, `list_students`.
5. In a new chat, open the **+ / tools** menu and make sure **Progresso** is enabled.

If you restart cloudflared, the URL changes: edit the connector (or remove and re-add it) with the new URL.

**Claude Desktop (local, stdio) instead of a tunnel:** add this to `claude_desktop_config.json` (Settings → Developer → Edit config), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "progresso": {
      "command": "node",
      "args": ["--import", "tsx", "C:/Users/TUF/Desktop/LearnOS/apps/mcp/src/main.ts", "--stdio"],
      "cwd": "C:/Users/TUF/Desktop/LearnOS/apps/mcp",
      "env": { "PROGRESSO_STUDENT": "demo-riya" }
    }
  }
}
```

(Don't use `pnpm mcp:stdio` there: pnpm prints a banner on stdout, which corrupts the stdio stream.)

## 4. Demo script (about 4 minutes)

Have the web app's **Map** for Riya visible next to Claude.

1. **"What should I study tonight?"**
   Claude calls `get_tonight_mission`. The widget appears: *Fix the root: Chain rule*, the root-gap star (8 mistakes across 3 exams, ~12 marks), Riya's own working from Unit Test 1 Q7 with the mistake circled, the explainer buttons, then **Prove it · question 1 of 3**.
   *Point out:* this is one root behind 8 mistakes, not 8 separate topics. The working shown is quoted from her report.
2. **Answer question 1 wrong on purpose** (pick the option that forgets the inner derivative), then **Check answer**.
   The widget says *Not quite* and shows the tag *Same mistake as Unit Test 1 Q7 in your report*. The answer is saved and Claude is told.
3. Click **Ask Claude why →**.
   Claude calls `explain_my_mistake` with the question id and explains using the report's own words and the verified fix, not a generic chain-rule lecture.
4. **Answer questions 2 and 3 correctly.** The result says *Not proven yet: it's in your plan again* (the gate needs 3/3). On the web Map, the Chain rule star turns from red to yellow (learning) within a few seconds.
   *Point out:* nothing was refreshed by hand; Claude and the web app share one database.
5. **"How am I doing?"**
   Claude calls `get_progress`. The widget shows the readiness range (always a range, labelled Estimate), 0 of 1 roots fixed, and a mini constellation.
6. **The ripple (optional, resets Riya):** in the web app, **Today → Reset plan** (sample students only; the next question in Claude sets the plan up again). Ask again: **"What should I study tonight?"** Answer all three correctly. The widget shows *Mission passed ✓ / Chain rule is fixed*. On the web Map the chain reaction plays: the root goes green and the 21 topics built on it light up.
7. Click **What's next?** in the widget. It sends that question to Claude for you.

Good follow-ups to show Claude grounding: *"Explain my Half-Yearly Q18 mistake"*, *"Why is chain rule my root problem?"*, *"Which of my mistakes were just slips?"*

## Troubleshooting

| Symptom | Fix |
|---|---|
| Claude says it couldn't connect / asks for OAuth | The URL is missing `?token=…`, or the token doesn't match `PROGRESSO_MCP_TOKEN`. |
| `403 Invalid Host` | You started the server without a token. Set `PROGRESSO_MCP_TOKEN` (any Host is then accepted), or add the tunnel host to `MCP_ALLOWED_HOSTS`. |
| Tools work but no widget appears | The host or plan doesn't render MCP Apps yet; the text answer still works. Try Claude on the web or Desktop. |
| Web map doesn't change | Make sure the web app and the MCP server use the same `DATABASE_PATH` (default `data/progresso.db`), and the Map tab is the visible tab. |
| "Watch the explainer" opens nothing | It opens `PROGRESSO_WEB_URL` (default `http://localhost:3100`), which only works on the machine running the web app. |
