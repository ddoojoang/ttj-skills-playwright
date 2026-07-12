---
name: ttj-skills-playwright
description: Drive an existing Chrome over CDP (Playwright core) with one-shot commands — eval / goto / click / type / wait / tabs / screenshot — plus page element visualization and analysis. After opening the browser with this skill, ALL browser actions must go through this skill's commands. Reply in the user's language (any language).
disable-model-invocation: false
allowed-tools: Bash, Read, Write
auto-invoke-keywords: [
  "visualize", "show elements", "show me the elements", "page structure",
  "find buttons", "find links", "what elements", "highlight elements",
  "analyze elements", "show the html", "show html structure",
  "시각화해줘", "시각화해봐", "시각화 해줘", "시각화 해봐",
  "요소.*?(보여|찾아|시각|확인|표시|표현|분석)",
  "구조.*?(보여|찾아|시각|확인|표시)",
  "HTML.*?(보여|찾아|시각|확인|표시)",
  "레이아웃.*?(보여|찾아|시각|확인|표시)",
  "(보여|찾아|시각|확인|표시|분석).*?(요소|구조|HTML|레이아웃|버튼|링크)",
  "페이지.*?요소", "페이지 요소"
]
---

# ttj-skills-playwright

npm: `npm install -g ttj-skills-playwright` · skill: `/ttj-skills-playwright`

Launches a dedicated Chrome (CDP port 9227, fixed profile `~/.ttj-skills-playwright` — Windows: `%APPDATA%\ttj-skills-playwright`) and drives it with one-shot commands via a direct CDP connection (Playwright core). Login sessions persist in the profile.

> This skill responds to requests in **any language** (English, Korean, Japanese, …).

## 🌐 Always reply in the user's language

**Detect the language of the user's message and reply in that same language.** Korean → Korean, English → English, Japanese → Japanese, etc. Do not switch languages on the user. (CLI logs stay English; that does not change the reply language.)

## 🚨 Top rule: all browser actions go through THIS browser

**After the user opens the browser with this skill, every browser action MUST use the commands below only.**

## 🚨 Preserve the existing browser and tabs

- Treat the user's currently open browser windows and tabs as state that must be preserved.
- A subcommand (`tab`, `tabs`, `eval`, `click`, `type`, `goto`, `wait`, `--visualize`, `clear`, `screenshot`) means "operate on the existing skill browser." It does NOT authorize launching another browser or creating a new start tab.
- **Never run bare `ttj-skills-playwright` as a recovery step** when the user asked for a subcommand — the bare command may open an extra window / start tab.
- For a tab switch, run only `ttj-skills-playwright tab <n>`. If it seems to fail, do NOT relaunch; the commands now probe the CDP port and reuse the running browser automatically. Check `ttj-skills-playwright tabs` — the tab count must not increase.
- Use `--no-launch` (alias `--reuse-only`) when you must guarantee no new browser is opened: e.g. `ttj-skills-playwright tab 2 --no-launch`. It errors instead of launching if nothing is running.
- If the tool truly cannot reconnect without launching, stop and tell the user instead of silently adding windows/tabs.

**After the user opens the browser with this skill, every browser action MUST use the commands below only.**

| Goal | Command (instant, ~0.4s) |
|---|---|
| Run JS / read DOM / change styles | `ttj-skills-playwright eval "<js>"` |
| Navigate (waits for load) | `ttj-skills-playwright goto <url>` |
| Click (real trusted mouse event) | `ttj-skills-playwright click "<selector>"` |
| Type (human-like random delay) | `ttj-skills-playwright type "<selector>" "<text>"` |
| Wait for an element (SPA / lazy) | `ttj-skills-playwright wait "<selector>" [timeoutMs]` |
| List / switch tabs | `ttj-skills-playwright tabs` / `ttj-skills-playwright tab <n>` |
| Screenshot | `ttj-skills-playwright screenshot [path] [--full]` |
| Visualize / analyze elements (show HTML structure) | `ttj-skills-playwright --visualize` |
| Remove overlays (badges/boxes) | `ttj-skills-playwright clear` |

Every command auto-detects the running browser (process detection + CDP port probe), connects over CDP, and targets the **visible active tab**. It reuses an already-open browser without adding tabs; it launches a new one only when nothing is running (skip even that with `--no-launch`).

> 💡 **Prefer click/type over eval**: `eval`'s `el.click()` is an untrusted JS event (isTrusted=false) that login/checkout buttons may ignore. `click`/`type` dispatch real input events via CDP, and `type` applies a per-character 100–300ms random delay (bot-detection etiquette).

**Never do this:**
- ❌ Pre-flight checks (`curl :9227`, `ps aux`, `playwright-cli list`) — the commands find the browser themselves
- ❌ Open a playwright-cli session / write a config file / author a new CDP connection script
- ❌ Launch another browser with Puppeteer/Playwright (exception: an explicit "code deliverable" request)
- ❌ Ask the user whether the browser is closed — commands auto-relaunch and continue

## Invocation

**Auto**: phrases like "open the browser", "브라우저 열어줘", "work with the browser" trigger it.
**Explicit**: `/ttj-skills-playwright`
**Direct**: `ttj-skills-playwright` (visualization mode: `--visualize`)

## 🎯 Visualization intent (avoid false positives)

**Rule: run visualization only when a TARGET (element/structure/HTML/button/link) AND a REQUEST verb appear together.**

- Request verbs: show / find / visualize / highlight / check · 보여줘 / 찾아줘 / 시각화해줘 / 확인해줘
- ✅ Run: "show me the elements", "요소들 보여줘", "visualize the page structure", "버튼이나 링크 찾아줘"
- ❌ Skip (statements, not requests): "this page's elements are…", "버튼 요소가 있어", "there is a div"

## ⚡ One-shot command usage

### eval — run JS in the active tab (result printed as JSON to stdout)
```bash
ttj-skills-playwright eval "document.title"
ttj-skills-playwright eval "document.querySelector('#btn').style.background='yellow'"
ttj-skills-playwright eval "(() => [...document.querySelectorAll('a')].length)()"           # IIFE
ttj-skills-playwright eval "(async () => { await new Promise(r => setTimeout(r, 500)); return location.href; })()"
```

### goto — navigate (waits for load)
```bash
ttj-skills-playwright goto https://example.com
ttj-skills-playwright goto example.com        # https:// auto-prefixed
```

### click / type — real input events
```bash
ttj-skills-playwright click "#login-btn"
ttj-skills-playwright type "#query" "search text"
```

### wait — wait for an element to appear
```bash
ttj-skills-playwright wait ".search-result"        # default 10s timeout
ttj-skills-playwright wait ".lazy-content" 30000
```

### tabs / tab — list / switch tabs
```bash
ttj-skills-playwright tabs      # ▶ [1] Example — https://example.com ...
ttj-skills-playwright tab 2     # bring tab 2 to front (later commands target it)
```

### screenshot / clear — capture · remove overlays
```bash
ttj-skills-playwright screenshot                      # default path printed in logs (viewport)
ttj-skills-playwright screenshot /tmp/full.png --full # full page
ttj-skills-playwright clear                           # remove visualization badges+boxes (no reload)
```

## Element visualization / analysis (--visualize)

**Trigger**: "show me the elements", "visualize the page", "show the HTML structure", "analyze the elements", "요소 보여줘", "요소 분석해줘", "HTML 구조 보여줘", "페이지 시각화해줘", "要素を見せて".

`--visualize` shows two tiers, **each badge pinned exactly to its element's top-left corner**:
- 🔴 **Regions** (`R1, R2, …`, red) — the top-most parent blocks (big-picture sections: header, search, each content section, footer). Hovering a region badge fills it with a translucent red box so even large regions are clearly visible.
- 🔵 **Details** (`e1, e2, …`, blue) — the individual elements inside those regions (links, buttons, inputs, cards). Off-screen/clipped carousel items and empty layout wrappers are excluded, so badges only mark real visible content.

It auto-scrolls (to trigger lazy-load), then saves a full-page screenshot to a temp folder (**exact path is printed in the log line "📸 Screenshot saved:"** — Read that path). Hovering a badge shows its selector label; clicking copies a unique CSS selector to the clipboard.

**AI procedure:**
1. Run `ttj-skills-playwright --visualize`
2. Read the screenshot path from the "📸 Screenshot saved:" log line and show it to the user
3. Output a two-tier table — red regions (R) with the blue details (e) inside each:

| Region | Ref | Details inside |
|--------|-----|----------------|
| Header | R1 | e1~e8 — logo, nav, search |
| Deals section | R2 | e9~e20 — banners, cards |
| Footer | R3 | e21~e40 — links, copyright |

4. The user can copy a badge's ref (`R2`, `e7`) or click a badge to copy its selector, then ask you to act on it.

**Overlay rule**: each `--visualize` clears the previous overlay and shows only the new one. Badges/boxes stay on the page, so run `ttj-skills-playwright clear` for a clean screen/screenshot (no reload needed).

## Dev rules (ONLY for "code deliverable" requests — standalone scripts)

> For instant work in the open skill browser, use the one-shot commands above.

**Default libraries (when unspecified)**: browser automation = Puppeteer, HTTP crawling = Axios + Cheerio. Follow the user's choice if specified.

**Browser automation defaults to headless: false** — the user should see it run:
```javascript
const browser = await puppeteer.launch({ headless: false });   // true only if explicitly requested
```

**Structure code by feature = one function, one job** — split login / list-fetch / detail-parse / save into separate functions, composed by a flow function (no giant single script):
```javascript
const fetchListPage = (page) => { ... };      // fetch list only
const parseItem = (el) => ({ ... });          // parse only (pure)
const saveResults = (items) => { ... };       // save only (side effect)
const crawl = async () => saveResults((await fetchListPage(page)).map(parseItem));
```

**Automation humanization (bot-detection avoidance) — required:**
```javascript
const randomDelay = () => Math.random() * 200 + 100;   // typing: 100-300ms/char
await page.type(selector, text, { delay: randomDelay() });

const randomWait = () => Math.random() * 1500 + 500;   // element access: 500ms-2s
await page.waitForTimeout(randomWait());
```

**Procedure — do all 3 stages in order. None may be skipped.**

**① DOM verification (before writing code)**
1. Test selectors/extraction logic in the open tab with `eval`:
   ```bash
   ttj-skills-playwright eval "(() => [...document.querySelectorAll('.item')].map(el => el.textContent))()"
   ```
2. Confirm the expected data appears with no missing/duplicate/empty values
3. 🚫 **Never write code with unverified selectors** (DOM verification is mandatory)

**② Write code**
4. Use ONLY selectors/logic verified in ①, structured as functions

**③ Run test (after writing code)**
5. **The AI runs the code itself** (headless: false, printing step logs)
6. On error / empty result / selector miss, fix → rerun **until it works**
7. 🚫 **Do not report "done" before verifying results by running.** The final report MUST include the **run result (item count + sample data)**.

> ⚠️ Enforced summary: **No code without DOM verification · No "done" without a run test.**
> Both are mandatory gates for crawling/automation code deliverables.

## Troubleshooting (only when commands repeatedly fail)

```bash
command -v ttj-skills-playwright                 # installed? (if not: npm install -g ttj-skills-playwright@latest)
curl -s http://localhost:9227/json/version       # CDP responding?
```
- If CDP doesn't respond but a browser is up, the port may have fallen back — check the "🔌 CDP port XXXX open" log line for the real port
- Updates are auto-checked once per day on launch (continues on the current version if it fails)
