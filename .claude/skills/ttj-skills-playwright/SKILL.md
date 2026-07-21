---
name: ttj-skills-playwright
description: Drive an existing Chrome over CDP (Playwright core) with one-shot commands — snapshot (ARIA tree + refs) / eval / goto / click / fill / press / type / wait / tabs / console / screenshot — plus page element visualization (--visualize) and structure analysis (analyze → red boxes + crawl-target JSON). After opening the browser with this skill, ALL browser actions must go through this skill's commands. Reply in the user's language (any language).
disable-model-invocation: false
allowed-tools: Bash, Read, Write
auto-invoke-keywords: [
  "visualize", "show elements", "show me the elements", "page structure",
  "find buttons", "find links", "what elements", "highlight elements",
  "analyze elements", "show the html", "show html structure",
  "analyze this page", "analyze the page", "what can I crawl", "what can i crawl",
  "crawl targets", "html 분석", "페이지 분석", "크롤링 뭐", "뭘 크롤링",
  "크롤링.*?(가능|할 수|뭐|대상)", "(html|페이지|요소).*?분석",
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

## 🚨 Skill start ritual: check 9227 first, then report tabs and ASK

When the skill is activated, always start with the bare command `ttj-skills-playwright` (no subcommand). **It first checks npm for the latest version and, when one exists, finishes updating itself BEFORE opening the browser** (you may see `⬆️ 새 버전 발견 … 업데이트 후 브라우저를 엽니다` — let it finish; it's bounded at 90s and continues on the current version if the update fails). Then it checks the dedicated ttj profile browser on CDP port 9227 (probing the port even when process detection misses): if none is running it launches one; if one is already running — e.g. left open by a previous session — it **reuses it and never opens a new tab**, brings the window to the front, and prints the open tabs to stdout (`▶ [n] title — url`), ending with `✅ Reused the existing browser — no new tab was opened`.

When you see that reuse output:

1. **Do NOT** run `goto` / open a new tab / launch anything on your own initiative.
2. **Report the tab situation in the user's language** — how many tabs are open and what each one is, e.g. "이전에 쓰시던 브라우저가 열려 있어서 앞으로 가져왔어요. 탭이 2개 열려 있습니다: [1] Hacker News, [2] 네이버 로그인".
3. **1 tab** → don't ask; continue the user's request on that tab right away. **2+ tabs** → ask which tab (by number) to work on — e.g. "몇 번 탭에서 어떤 작업을 할까요?", then switch with `ttj-skills-playwright tab <n>` and proceed on that tab only.

## 🚨 Preserve the existing browser and tabs

- Treat the user's currently open browser windows and tabs as state that must be preserved.
- A subcommand (`tab`, `tabs`, `snapshot`, `eval`, `click`, `fill`, `press`, `type`, `goto`, `wait`, `console`, `--visualize`, `clear`, `screenshot`) means "operate on the existing skill browser." It does NOT authorize launching another browser or creating a new start tab.
- **Never run bare `ttj-skills-playwright` as a recovery step** when the user asked for a subcommand — the bare command may open an extra window / start tab.
- For a tab switch, run only `ttj-skills-playwright tab <n>`. If it seems to fail, do NOT relaunch; the commands now probe the CDP port and reuse the running browser automatically. Check `ttj-skills-playwright tabs` — the tab count must not increase.
- Use `--no-launch` (alias `--reuse-only`) when you must guarantee no new browser is opened: e.g. `ttj-skills-playwright tab 2 --no-launch`. It errors instead of launching if nothing is running.
- If the tool truly cannot reconnect without launching, stop and tell the user instead of silently adding windows/tabs.

**After the user opens the browser with this skill, every browser action MUST use the commands below only.**

| Goal | Command (instant, ~0.1s) |
|---|---|
| Map the page (ARIA tree + refs → file) | `ttj-skills-playwright snapshot` |
| Run JS / read DOM / change styles | `ttj-skills-playwright eval "<js>"` |
| Navigate (waits for load) | `ttj-skills-playwright goto <url>` |
| Click (real trusted mouse event) | `ttj-skills-playwright click e5` or `click "<selector>"` |
| Type text (human-like, DEFAULT for input) | `ttj-skills-playwright type e5 "<text>"` or `type "<selector>" "<text>"` |
| Press a key (Enter, Tab, ArrowDown, …) | `ttj-skills-playwright press Enter` |
| Fill instantly (ONLY on explicit request) | `ttj-skills-playwright fill e5 "<text>"` |
| Wait for an element (SPA / lazy) | `ttj-skills-playwright wait "<selector>" [timeoutMs]` |
| Read console messages | `ttj-skills-playwright console [--watch <sec>]` |
| List / switch tabs | `ttj-skills-playwright tabs` / `ttj-skills-playwright tab <n>` |
| Multi-step sequence (1 connection) | `ttj-skills-playwright batch '<json-steps>'` |
| Screenshot | `ttj-skills-playwright screenshot [path] [--full]` |
| Visualize elements (show HTML structure) | `ttj-skills-playwright --visualize` |
| Analyze crawl targets (red boxes + JSON) | `ttj-skills-playwright analyze` |
| Remove overlays (badges/boxes) | `ttj-skills-playwright clear` |

Every command auto-detects the running browser (process detection + CDP port probe), connects over CDP, and targets the **visible active tab**. It reuses an already-open browser without adding tabs; it launches a new one only when nothing is running (skip even that with `--no-launch`).

## 🚨 ALWAYS know which site you're on BEFORE acting

The browser opens on google.com, but the user navigates away — never assume the active page. **Before any page action (visualize / analyze / eval / click / type / screenshot), run `ttj-skills-playwright tabs` first** (instant — plain HTTP, ~0.1s; `▶` marks the active tab = the user's most recent tab):

- **1 tab open** → do NOT ask anything. Proceed on that tab immediately (chain it: `ttj-skills-playwright tabs && ttj-skills-playwright --visualize`), just mentioning the site in your reply ("○○ 페이지에서 진행했습니다").
- **2+ tabs open** → list every tab to the user (`[1] title — url` …) and **ask which tab number to work on**. After the answer, `ttj-skills-playwright tab <n>`, then proceed.
- Only skip the 2+ tabs question when the user already named the tab/site in their request (e.g. "네이버 탭에서 요소 보여줘") — then switch to the matching tab yourself and say so.

> 💡 **Prefer click/fill/type over eval**: `eval`'s `el.click()` is an untrusted JS event (isTrusted=false) that login/checkout buttons may ignore. `click`/`fill`/`type` dispatch real input events via CDP.

## 🚨 Snapshot-first workflow (unfamiliar page → act by ref, token-efficient)

When you need to interact with a page whose structure you don't know (login forms, search boxes, buttons):

1. Run `ttj-skills-playwright snapshot` (~0.1s). stdout stays tiny — URL, title, and a **file path**. The page's ARIA tree (`- textbox "Password" [ref=e10]`) is in that file.
2. **Read the snapshot file** (or grep it for the element you need) — this is far cheaper than screenshots or DOM dumps.
3. Act directly by ref: `ttj-skills-playwright type e8 "user@mail.com"`, `click e12`, `press Enter`. No CSS selector guessing.
4. **Refs die on navigation** — after any `goto`/link click/form submit, run `snapshot` again before using refs. A stale ref fails with a clear "Run 'snapshot' again" error (never a wrong-element click).

**type vs fill — typing is ALWAYS human-like by default:**
- `type` = per-character 100–300ms random delay with real keydown/keyup events, like a human. **This is the DEFAULT for ALL text entry — logins, search boxes, forms.** Works with refs too: `type e8 "user@mail.com"`. Speed optimizations apply to LOGIC (snapshot, refs, detection, connection) — never to typing cadence.
- `fill` = instant (one trusted `input` event, no per-key events). Use ONLY when the user explicitly asks for instant input, or to clear a field (`fill e8 ""`). Never pick `fill` on your own for login/credential fields.

**Two ref systems, don't confuse them:** snapshot refs are `e1, e2, …` (machine contract — usable in `click`/`fill`). Visualization badges on screen are `v1, v2, …` (human-facing — the user clicks a badge to copy a CSS selector; `vN` is NOT a command argument).

## 🚨 Multi-step work = ONE tool call (never one call per action)

Running each action as a separate Bash tool call wastes seconds of round-trip per step. When you already know the next 2+ actions:

1. **Preferred — `batch`**: one process + ONE CDP connection for the whole sequence. Steps run in order; on the first failure the remaining steps are skipped and reported. stdout = JSON results array (parse it; non-zero exit = some step failed). The flagship login flow — navigate, map, type by ref (human-paced), submit — in ONE call:
```bash
ttj-skills-playwright batch '[
  {"cmd":"goto","url":"https://site.com/login"},
  {"cmd":"snapshot"},
  {"cmd":"type","ref":"e8","text":"myuser"},
  {"cmd":"type","ref":"e10","text":"mypass"},
  {"cmd":"press","key":"Enter"}
]'
```
Step fields: `goto{url}` · `snapshot{}` (refreshes refs mid-batch) · `click{selector|ref,timeout?}` · `type{selector|ref,text}` · `fill{selector|ref,text}` (explicit request only) · `press{key}` · `wait{selector,timeout?}` · `eval{code}` · `screenshot{path,full?}`. A `goto` step invalidates refs — put a `snapshot` step after it before any ref step. If the refs aren't known yet, run `snapshot` alone first, read the file, then batch the actions. `type` keeps its human keystroke cadence inside batch — batch saves the connection/process overhead, not the typing time.
2. **Fallback — `&&` chaining** for mixes batch can't express (e.g. `tab 2 && … --visualize`): `ttj-skills-playwright tab 2 && ttj-skills-playwright eval "document.title"`.

Use single one-shot commands only when the next action genuinely depends on output you must reason about first.

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
> **`goto` is for FIRST entry only** (opening the site, address-bar/bookmark case). To follow a link that already exists on the page, **`click` it — do NOT `goto` its href.** A human clicking a link produces a `referrer` (the origin page) and reveals whether it opens in the **same tab or a new tab**; `goto` produces an empty referrer (looks like address-bar entry) and hides the tab behaviour entirely. See "Link navigation" below.

### snapshot — ARIA tree + refs to a file (map the page before acting)
```bash
ttj-skills-playwright snapshot                # stdout: URL / Title / file path (lines, refs)
ttj-skills-playwright snapshot --depth 6      # cap tree depth on huge pages
grep -i "textbox\|button" ~/.ttj-skills-playwright/snapshots/<targetId>.txt
```

### click / type / press / fill — real input events
```bash
ttj-skills-playwright click e12               # by snapshot ref (exact element, no guessing)
ttj-skills-playwright click "#login-btn"      # or by CSS selector
ttj-skills-playwright type e8 "user@mail.com" # human-like typing (DEFAULT for all text entry)
ttj-skills-playwright type "#query" "search text"
ttj-skills-playwright press Enter             # submit without hunting for the button
ttj-skills-playwright fill e8 ""              # clear a field; instant fill ONLY on explicit request
```

### console — page console messages (debugging)
```bash
ttj-skills-playwright console                 # buffered recent messages (replay)
ttj-skills-playwright console --watch 5       # + 5s of live collection
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

### Link navigation — click links, don't `goto` their href (know same-tab vs new-tab)
To move deeper into a site, **`click` the link** — this is how a human navigates, and it reveals what the link actually does:
```bash
ttj-skills-playwright tabs                 # note the tab count BEFORE
ttj-skills-playwright click e7             # click the link (real trusted mouse)
ttj-skills-playwright tabs                 # compare the tab count AFTER
```
- **Tab count grew (e.g. 1→2)** → the link is `target="_blank"` → opened in a **NEW tab**, which becomes the active tab (`▶`). Every later command now targets the new tab automatically; use `tab <n>` to return. (verified empirically)
- **Tab count unchanged (1→1)** → **same-tab** navigation; `referrer` carries the previous page (real user trail). Run `snapshot` again to refresh refs.
- **Why it matters for generated code**: only a real click tells you the same-tab / new-tab behaviour, so the automation can target the right tab afterwards. `goto <href>` can't — empty referrer, no tab signal.

## Element visualization / analysis (--visualize)

**Trigger**: "show me the elements", "visualize the page", "show the HTML structure", "analyze the elements", "요소 보여줘", "요소 분석해줘", "HTML 구조 보여줘", "페이지 시각화해줘", "要素を見せて".

`--visualize` overlays a red numbered badge (`v1, v2, …`) **pinned exactly to each element's top-left corner** + a red outline on every visible content element (divs, links, buttons, inputs, cards). Empty layout wrappers and off-screen/clipped carousel items are excluded, so badges mark only real visible content.

**INSTANT by default** — boxes appear immediately on what is currently rendered: no auto-scroll, no screenshot, selectors computed lazily on hover/click. This is the mode to use when the user says "요소 보여줘 / show elements": the user looks at the browser, clicks a badge to copy its selector, and asks you to crawl just that part. Add `--full` only when the user explicitly wants the whole page (auto-scrolls to trigger lazy-load, then saves a full-page screenshot — path printed in the "📸 Screenshot saved:" log line).

Hover a badge to isolate that element — every other box dims and the hovered element fills with a translucent red box (unmistakable even for large elements) with its selector label. Click a badge to copy its unique CSS selector to the clipboard.

**AI procedure:**
1. Run `ttj-skills-playwright --visualize` (instant; add `--full` only if the user asks for the whole page / a screenshot)
2. Tell the user the boxes are on screen: hover a badge to inspect, click it to copy the selector
3. The user pastes a badge number (`v7`) or a copied selector and asks you to act on / crawl that part — do exactly that scope, nothing more. (A `v7` from the user is a visual badge, not a command ref — use the copied CSS selector, or run `snapshot` and act by `eN` ref.)

**Overlay rule**: each `--visualize` clears the previous overlay and shows only the new one. Badges/boxes stay on the page, so run `ttj-skills-playwright clear` for a clean screen/screenshot (no reload needed).

## Crawl-target requests → boxes FIRST, deep analysis only after asking

**Trigger**: "크롤링 뭐 할 수 있어", "크롤링할만한거 분석해줘", "크롤링 요소 분석해줘", "크롤링 대상 찾아줘", "페이지 분석" · "what can I crawl", "analyze this page".

**MANDATORY two-phase flow — NEVER run `analyze` as the first response to these requests:**

1. **Instantly** run `ttj-skills-playwright --visualize` (red boxes + badges appear in under a second). No deep analysis, no `analyze` subcommand, no long wait.
2. In the SAME reply, tell the user the boxes are ready and **softly offer** the deep analysis, then STOP and wait — e.g.: "배지와 박스 표시를 준비했습니다 ✅ 배지를 클릭하면 셀렉터가 복사돼요. 원하시면 시간이 조금 걸리더라도 페이지 구조(반복 목록·테이블·폼)를 자세히 분석해드릴까요?"
3. Run the `analyze` subcommand **only after the user says yes** (or when they explicitly asked for a structured/JSON breakdown up front, e.g. "구조를 JSON으로 뽑아줘", "리스트/테이블 자동으로 찾아줘").

Most of the time the user just clicks a badge, pastes the selector, and says "이 부분 크롤링해줘" — that conversation IS the analysis, so phase 2's question usually never needs a yes.

`analyze` (phase 3 only) additionally prints machine-readable page structure to stdout:

```jsonc
{
  "meta":  { "url", "title", "headings": [ "top h1~h2 text (≤5)" ] },
  "repeatingGroups": [   // scored desc, top 10 — the main crawl targets
    {
      "containerSelector", "itemSelector", "count",
      "fields":  { "title", "link", "image", "price", "date" },  // booleans
      "samples": [ { "text": "≤80 chars", "href?", "imgSrc?" } ], // first 3 items
      "score"
    }
  ],
  "tables": [ { "selector", "rows", "columns", "headers": [] } ],
  "forms":  [ { "selector", "inputs": [ { "type", "placeholder?", "name?" } ] } ]
}
```

**AI procedure (explicit JSON requests only):**
1. Run `ttj-skills-playwright analyze` (add `--full` only if the user wants below-the-fold/lazy-loaded content too).
2. Read the JSON from stdout and **judge** which entries are worth crawling. Present them to the user (in the user's language) as a numbered list. For each item state: what it is (e.g. "뉴스 기사 목록, 20건"), the extractable fields (title / link / image / price / date), and the `itemSelector` to use.
3. Note that the red badges (`v1, v2, …`) on the page correspond to these proposed targets so the user can cross-check visually (with `--full`, also show the screenshot path).
4. When the user picks an item, use its `itemSelector` to write the follow-up `eval` / crawling code (still going through the ① DOM verification → ② write → ③ run-test gates below).

Default for every "show/analyze/crawl" request is `--visualize` (instant boxes); `analyze` is the exception, reserved for explicit structured-output requests.

## Dev rules (ONLY for "code deliverable" requests — standalone scripts)

> For instant work in the open skill browser, use the one-shot commands above.

**Default libraries (when unspecified)**: browser automation = Puppeteer, HTTP crawling = Axios + Cheerio. Follow the user's choice if specified.

**Browser automation defaults to headless: false** — the user should see it run:
```javascript
const browser = await puppeteer.launch({ headless: false });   // true only if explicitly requested
```

**Window + viewport MUST fill the screen (required, every launch)** — Puppeteer's default viewport is a shrunken 800×600 box inside the window; always disable it and maximize the window so the viewport equals the full window:
```javascript
// Puppeteer
const browser = await puppeteer.launch({
  headless: false,
  defaultViewport: null,            // viewport = actual window size (never omit)
  args: ['--start-maximized'],      // window fills the screen
});

// Playwright (when the user chose it)
const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
const context = await browser.newContext({ viewport: null });  // no viewport emulation
```
🚫 Never ship launch code without `defaultViewport: null` (Puppeteer) / `viewport: null` (Playwright) + `--start-maximized`.

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

**Navigate by CLICKING links, not by `goto`-ing their href — and detect same-tab vs new-tab:**
Following an on-page link must be a real click, not navigation to its URL. A click carries a `referrer` (natural user trail) and reveals whether the link opens the **same tab** or a **new tab** (`target="_blank"`) — the generated code must know which, so it acts on the right page object afterwards. `goto <href>` sends an empty referrer and hides the tab behaviour. Detect by comparing page count before/after:
```javascript
// Puppeteer
const before = (await browser.pages()).length;
await link.click();                                   // real trusted click (NOT goto its href)
const pages = await browser.pages();
const target = pages.length > before ? pages[pages.length - 1] : page;  // new tab? use it. else same page.
// `target` is the page every subsequent step must act on.

// Playwright
const target = context.pages().length > before ? context.pages().at(-1) : page;
```
`goto` is legitimate ONLY for FIRST entry (opening the site fresh). Following an on-page link with `goto` is the smell.

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
