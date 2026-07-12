---
name: ttj-skills-playwright
description: Drive an existing Chrome over CDP (Playwright core) with one-shot commands — eval / goto / click / type / wait / tabs / screenshot — plus page element visualization and crawl-target analysis. After opening the browser with this skill, ALL browser actions must go through this skill's commands. Works for English and Korean requests.
disable-model-invocation: false
allowed-tools: Bash, Read, Write
auto-invoke-keywords: [
  "visualize", "show elements", "show me the elements", "page structure",
  "find buttons", "find links", "what elements", "highlight elements",
  "crawl", "scrape", "what can I crawl", "crawlable",
  "시각화해줘", "시각화해봐", "시각화 해줘", "시각화 해봐",
  "요소.*?(보여|찾아|시각|확인|표시|표현)",
  "구조.*?(보여|찾아|시각|확인|표시)",
  "HTML.*?(보여|찾아|시각|확인|표시)",
  "레이아웃.*?(보여|찾아|시각|확인|표시)",
  "(보여|찾아|시각|확인|표시).*?(요소|구조|HTML|레이아웃|버튼|링크)",
  "페이지.*?요소", "페이지 요소",
  "크롤링.*?(할만|하고싶|있어|가능|해줘|해볼)",
  "(수집|스크래핑).*?(할만|하고싶|있어|가능|해줘)"
]
---

# ttj-skills-playwright

npm: `npm install -g ttj-skills-playwright` · skill: `/ttj-skills-playwright`

Launches a dedicated Chrome (CDP port 9227, fixed profile `~/.ttj-skills-playwright` — Windows: `%APPDATA%\ttj-skills-playwright`) and drives it with one-shot commands via a direct CDP connection (Playwright core). Login sessions persist in the profile.

> This skill responds to both **English and Korean** requests. (한국어 요청도 모두 인식합니다.)

## 🚨 Top rule: all browser actions go through THIS browser

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
| Visualize every element | `ttj-skills-playwright --visualize` |
| Analyze crawl targets | `ttj-skills-playwright crawl` |
| Remove overlays (badges/boxes) | `ttj-skills-playwright clear` |

Every command auto-detects the running browser, connects over CDP, targets the **visible active tab**, and **auto-relaunches the browser if it was closed** and continues.

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
ttj-skills-playwright clear                           # remove visualize/crawl badges+boxes (no reload)
```

## Visualization (Reference Visualization)

`--visualize`: auto-scrolls (to trigger lazy-load), overlays red badges (e1, e2, …) + outlines on every visible element (div/button/link/input…), and saves a full-page screenshot to a temp folder (**exact path is printed in the log line "📸 Screenshot saved:"** — Read that path). Hovering a badge shows its selector label; clicking copies a unique CSS selector to the clipboard.

**AI procedure:**
1. Run `ttj-skills-playwright --visualize`
2. Read the screenshot path from the "📸 Screenshot saved:" log line and show it to the user
3. Output a classification table:

| Area | Refs | Elements |
|------|------|----------|
| Header | e1~e5 | logo, nav, search |
| Main | e6~e15 | product cards ×3, buttons |
| Footer | e16~e20 | links, copyright |

## 🕷 Crawl-target analysis (crawl)

**Trigger**: with the browser open, requests like "what can I crawl?", "I want to scrape this", "크롤링할만한거 있어?", "크롤링하고싶어" run this mode.

`ttj-skills-playwright crawl` shows two kinds of targets together:
- 🔴 **Layout regions** (`type: section`, red box) — page areas (header/sidebar/main…)
- 🔵 **Repeating lists** (`type: list`, blue box 🕷) — containers where the same structure repeats 3+ times
  (product cards, article lists, review rows — **the highest-value crawl targets**)

Behavior:
- Each region gets a badge (`e1 🕷 ×6` = 6 repeated items) and a bold outline
- **Hovering a badge isolates that box** (all others hidden) and shows its selector label
- Clicking a badge copies the container selector
- Analysis JSON is printed to stdout (logs go to stderr — parse stdout for clean JSON).
  Each item has `type`, `count`, `crawlScore` (value score, sorted high→low), `looksLikeNav`, `fields` (links/images/hasPrice/hasDate/avgItemChars), `sample`
- A full-page screenshot is saved to a temp folder (path in the "📸 Screenshot saved:" log line)

**AI procedure:**
1. Run `ttj-skills-playwright crawl`
2. Read the "📸 Screenshot saved:" path and show it to the user
3. List targets sorted by `crawlScore` (interpret via `type` + `sample`):

| Ref | Type | Description (from sample) | Items | Fields | Container selector |
|-----|------|---------------------------|-------|--------|--------------------|
| e1 | 🔵list | hotel card list | 30 | title, link, image, price | `div#hotel-list` |
| e2 | 🔵list | review list | 12 | text, date | `ul.reviews` |
| e3 | 🔴section | sidebar widget | 5 | links | `aside.rank` |

4. **The AI judges crawl value carefully and proposes first** — don't read `crawlScore` blindly; review each candidate:

   **✅ Real data (recommend)** — each item repeats multiple fields:
   - `sample` shows title + extras (date/source/price/description)
   - large `fields.avgItemChars` (≈30+), has `images` or `hasDate`/`hasPrice`
   - e.g. article lists, product cards, reviews, search results, post lists

   **❌ Not data (exclude or deprioritize)** — repeats but holds no value:
   - `looksLikeNav: true` or tiny `avgItemChars` (<12) → **navigation/menu/tabs** (bare link text)
   - pagination, category chips, social buttons, ad banners
   - `type: section` (🔴 layout) is an area, not data — look at the 🔵 lists inside it

   Then propose with **recommendation + reason + what can be extracted**. e.g.:
   > "The high-value targets here are **e1 article list (20 items — title, publisher, time)** and
   >  **e3 ranking news (10 items — title, views)**. I excluded e2 (category menu, not data).
   >  What would you like to crawl?"

   If unsure, run `eval` on the candidate selector to inspect actual item text before judging.

5. When the user picks a ref (e.g. `e1`) or item, verify extraction via `eval` against that container selector, then proceed (for code deliverables apply the dev rules below).

**Overlay rule**: `crawl` and `--visualize` each clear previous overlays and show only the new set (shared badge classes — never stacked). Badges/boxes stay on the page, so run `ttj-skills-playwright clear` for a clean screen/screenshot (no reload needed).

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
