# ttj-skills-playwright

> A CLI that drives an existing Chrome over CDP (Playwright core) with instant one-shot commands.

Built so an AI agent (Claude Code, Codex) and the user can **work on the same browser screen**.
It attaches to a running Chrome over the Chrome DevTools Protocol via `playwright-core`, so there is
no session management and each command finishes in ~0.4s.

- ✅ Dedicated Chrome (CDP port 9227, fixed profile — login sessions persist)
- ✅ One-shot commands: `eval` / `goto` / `click` / `type` / `wait` / `tabs` / `screenshot`
- ✅ **Auto-relaunches** the browser if it was closed, then continues
- ✅ `click`/`type` use real CDP input events (isTrusted=true); `type` adds a 100–300ms per-key random delay
- ✅ Page element visualization (`--visualize`): badge overlay + hover selector + click-to-copy
- ✅ Crawl-target analysis (`analyze`): red-box overlay + structure JSON (repeating lists, tables, forms) to stdout
- ✅ Daily auto-update check

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

# One-shot commands — run against the active tab of the running browser
ttj-skills-playwright eval "document.title"
ttj-skills-playwright goto https://example.com
ttj-skills-playwright click "#login-btn"
ttj-skills-playwright type "#query" "search text"
ttj-skills-playwright wait ".search-result" 5000
ttj-skills-playwright tabs
ttj-skills-playwright tab 2
ttj-skills-playwright screenshot /tmp/shot.png --full

# Visualize every element (badge overlay + full-page screenshot)
ttj-skills-playwright --visualize

# Analyze crawl targets (red boxes + full-page screenshot + structure JSON on stdout)
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
