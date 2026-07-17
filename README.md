# ttj-skills-playwright

> A CLI that drives an existing Chrome over CDP (Playwright core) with instant one-shot commands.

Built so an AI agent (Claude Code, Codex) and the user can **work on the same browser screen**.
It attaches to a running Chrome over the Chrome DevTools Protocol — evaluate-class commands talk to
the active tab over its own dedicated WebSocket (no session management, no attach to other tabs), so
most commands finish in **~0.1s**.

- ✅ Dedicated Chrome (CDP port 9227, fixed profile — login sessions persist, window always maximized)
- ✅ **`snapshot`**: ARIA accessibility tree → compact text file with refs (`- textbox "Password" [ref=e10]`) — stdout stays tiny (URL/title/path), the agent reads the file selectively (token-efficient, playwright-cli style)
- ✅ **Ref actions**: `click e5` / `fill e5 "text"` act on the exact snapshot element — no CSS selector guessing, stale refs fail with a clear "re-snapshot" error (never a wrong-element click)
- ✅ One-shot commands: `eval` / `goto` / `click` / `fill` / `press` / `type` / `wait` / `tabs` / `console` / `screenshot`
- ✅ `fill` = instant trusted input (login forms in ~0.1s); `type` = 100–300ms per-key human delay (bot-detection etiquette)
- ✅ `batch`: run a whole goto→snapshot→fill→press sequence in one process + one connection
- ✅ **Auto-relaunches** the browser if it was closed, then continues; reuses a running one without adding tabs
- ✅ Always targets the tab the user actually works in (Chrome's most-recently-used order — never a stale start tab)
- ✅ `click`/`fill`/`press`/`type` use real CDP input events (isTrusted=true)
- ✅ Instant element visualization (`--visualize`): red boxes + numbered badges (`v1, v2, …`) in under a second, hover to inspect, click a badge to copy its CSS selector (`--full` for lazy-load auto-scroll + full-page screenshot)
- ✅ Crawl-target analysis (`analyze`): red-box overlay + structure JSON (repeating lists, tables, forms) to stdout
- ✅ `console`: read the tab's console messages (buffered replay + optional `--watch` live seconds)
- ✅ Daily auto-update check (background, never blocks a run)

> Full features need **Node 22+** (native WebSocket). On Node 18–21 evaluate/CSS-selector commands fall back to playwright; ref actions (`click e5`) and `console` require 22+.

## Requirements

| Item | Version |
|------|---------|
| Node.js | >= 18.0.0 |
| Chrome / Chromium | must be installed |

## Install

```bash
npm install -g ttj-skills-playwright
```

The agent skill is installed automatically on global install.

| Tool | Invocation |
|------|------------|
| Claude Code | `/ttj-skills-playwright` |
| Codex | `$ttj-skills-playwright` |

## Usage

```bash
# Launch the browser (brings the window to front if already open)
ttj-skills-playwright

# Map the page: ARIA tree + refs to a file (read it, then act by ref)
ttj-skills-playwright snapshot
# → Snapshot: ~/.ttj-skills-playwright/snapshots/<targetId>.txt (31 lines, 28 refs)

# One-shot commands — run against the active tab of the running browser
ttj-skills-playwright eval "document.title"
ttj-skills-playwright goto https://example.com
ttj-skills-playwright click e12                      # by snapshot ref
ttj-skills-playwright click "#login-btn"             # or by CSS selector
ttj-skills-playwright fill e8 "user@mail.com"        # instant fill (no key delay)
ttj-skills-playwright press Enter
ttj-skills-playwright type "#query" "search text"    # human-delay typing
ttj-skills-playwright wait ".search-result" 5000
ttj-skills-playwright console --watch 5
ttj-skills-playwright tabs
ttj-skills-playwright tab 2
ttj-skills-playwright screenshot /tmp/shot.png --full

# Multi-step sequence in ONE process + ONE connection (login in one call)
ttj-skills-playwright batch '[{"cmd":"goto","url":"https://site.com/login"},{"cmd":"snapshot"},{"cmd":"fill","ref":"e8","text":"user"},{"cmd":"fill","ref":"e10","text":"pass"},{"cmd":"press","key":"Enter"}]'

# Visualize every element (instant red boxes + numbered badges; --full adds auto-scroll + screenshot)
ttj-skills-playwright --visualize

# Analyze crawl targets (red boxes + structure JSON on stdout; --full adds auto-scroll + screenshot)
ttj-skills-playwright analyze

# Remove overlays
ttj-skills-playwright clear
```

Every one-shot command auto-detects the running browser and targets its visible active tab.
If no browser is running, it launches one and continues.

## Profile path

| OS | Path |
|----|------|
| macOS / Linux | `~/.ttj-skills-playwright` |
| Windows | `%APPDATA%\ttj-skills-playwright` |

## Chrome detection

| OS | Method |
|----|--------|
| macOS | `mdfind -name "Google Chrome.app"` or the default app path |
| Linux | `which google-chrome` or `which chromium` |
| Windows | `where chrome.exe` / `where chromium.exe` / standard install path |

## Development

```bash
npm install     # install deps
npm run build   # TypeScript → dist/
npm start       # run locally
```

## Troubleshooting

```bash
curl http://localhost:9227/json/version   # is CDP responding?
```

If there is no response, the port may have fallen back — check the launch log line
"🔌 CDP port XXXX open" for the actual port.

## License

MIT
