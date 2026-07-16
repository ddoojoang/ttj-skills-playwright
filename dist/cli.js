#!/usr/bin/env node
/**
 * ttj-skills-playwright - CLI entry point
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { tmpdir } from 'node:os';
import path from 'path';
import { log } from './logger.js';
import { getProfilePath, findAvailablePort, checkPortAvailable, findRunningCdpPort, } from './utils.js';
import { detectChrome, ensureProfile } from './detector.js';
import { launchBrowser, autoUpdateIfNeeded, verifyBrowserReady, visualizePageReferences, detectExistingBrowser, bringWindowToFront, } from './browser.js';
import { evalInActivePage, gotoInActivePage, screenshotActivePage, clickInActivePage, typeInActivePage, waitInActivePage, listTabs, activateTab, clearOverlays, } from './cdp.js';
import { analyzeActivePage } from './analyzer.js';
/**
 * Read the package version dynamically from package.json (ESM-safe).
 */
const getVersion = () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const packageJson = JSON.parse(readFileSync(path.join(currentDir, '../package.json'), 'utf-8'));
    return packageJson.version;
};
const HELP_MESSAGE = `
Usage: ttj-skills-playwright [command] [options]

Commands:
  eval <js>                Run JS in the active tab and print the result
  goto <url>               Navigate the active tab and wait for load
  click <selector>         Click an element (real/trusted mouse event)
  type <selector> <text>   Type with human-like random keystroke delays
  wait <selector> [ms]     Wait for a selector to appear (default 10000ms)
  tabs                     List open tabs with indexes
  tab <n>                  Bring tab n to the front
  clear                    Remove visualization overlays from the page
  analyze [--full]         Overlay red boxes + print page structure JSON (crawl targets)
  screenshot [path] [--full]  Capture the active tab (default: <tmpdir>/ttj-screenshot.png)

Options:
  --version, -v    Show version
  --help, -h       Show this help message
  --visualize      Launch browser and visualize page references (instant boxes)
  --full           With --visualize/analyze: auto-scroll first (lazy-load) + full-page shot
  (no options)     Launch browser

Examples:
  $ ttj-skills-playwright              # Start browser
  $ ttj-skills-playwright eval "document.title"
  $ ttj-skills-playwright goto https://www.naver.com
  $ ttj-skills-playwright eval "document.querySelector('#btn').style.background='yellow'"
  $ ttj-skills-playwright screenshot /tmp/shot.png --full
  $ ttj-skills-playwright --visualize  # Instant element boxes + screenshot
  $ ttj-skills-playwright analyze      # Red boxes + JSON of crawlable structure
  $ ttj-skills-playwright analyze --full  # Slower: auto-scroll whole page first
`;
/**
 * Handle informational CLI flags (--version, --help).
 * Returns true if a flag was handled and the process should exit early.
 */
const handleInfoFlags = (args) => {
    const wantsVersion = args.includes('--version') || args.includes('-v');
    const wantsHelp = args.includes('--help') || args.includes('-h');
    return wantsVersion
        ? (console.log(`ttj-skills-playwright v${getVersion()}`), true)
        : wantsHelp
            ? (console.log(HELP_MESSAGE), true)
            : false;
};
/**
 * Whether the user requested reference visualization.
 * Triggered by `VISUALIZE=true` env or a `--visualize` / `visualize` CLI arg.
 */
const isVisualizeRequested = () => process.env.VISUALIZE === 'true' ||
    process.argv.slice(2).some((arg) => arg === '--visualize' || arg === 'visualize');
/**
 * Whether the user requested the FULL (slow) scan: auto-scroll the whole page
 * first (triggers lazy-loading) + full-page screenshot. Without it, visualize/
 * analyze draw boxes instantly on what is currently rendered.
 */
const isFullScanRequested = () => process.argv.slice(2).includes('--full');
const ensureChrome = async () => {
    const detection = await detectChrome();
    if (!detection.found) {
        log('Chrome/Chromium을 찾을 수 없습니다. Chrome을 설치한 뒤 다시 실행해주세요.', 'warning');
        return false;
    }
    log(`Chrome found: ${detection.path}`, 'success');
    return true;
};
/**
 * Print the open tabs to stdout using the shared `▶ [n] title — url` format.
 * This stdout output is a contract: the AI reads it to tell the user which
 * pages are currently open (same output as the `tabs` subcommand).
 */
const printOpenTabs = async (port) => {
    const tabs = await listTabs(port);
    const lines = tabs.map((tab) => `${tab.active ? '▶' : ' '} [${tab.index}] ${tab.title || '(제목 없음)'} — ${tab.url}`);
    console.log(lines.join('\n') || 'No open tabs.');
};
/**
 * Reuse an already-running browser. Top invariant: NEVER launch a browser or
 * open a tab here. Brings the window to the front (pid may be undefined when
 * found via CDP probe), lists the open tabs to stdout, logs the reuse, and
 * runs visualization when requested.
 */
const reuseExistingBrowser = async (port, profilePath, pid) => {
    // Window focusing (osascript/powershell) and tab listing (CDP) are
    // independent — run them concurrently to shave startup latency.
    const frontPromise = bringWindowToFront(pid);
    log('✅ Reused the existing browser — no new tab was opened', 'success');
    log('📋 Currently open tabs:', 'info');
    await printOpenTabs(port);
    await frontPromise;
    log('🔄 Brought Chrome window to front', 'success');
    log('💬 AI: report these tabs to the user and ask which tab (n) to work on and what to do', 'info');
    if (isVisualizeRequested()) {
        await visualizePageReferences({ port, profilePath }, { full: isFullScanRequested() });
    }
};
const main = async () => {
    log('🚀 Initializing ttj-skills-playwright...', 'info');
    // 0. 업데이트 확인은 브라우저 감지와 '동시에' 시작하고 마지막에만 기다린다.
    //    실제 npm install은 detached 백그라운드로 돌아 실행을 절대 막지 않는다
    //    (새 버전은 다음 실행부터 적용).
    const updatePromise = autoUpdateIfNeeded();
    const profilePath = getProfilePath();
    // 1. 기존 브라우저 감지: 프로세스 매칭(ps/CIM)과 CDP 포트 프로브를 병렬
    //    실행 — 어느 쪽이든 찾으면 즉시 재사용. NEVER launch when one exists
    //    (top invariant: a running browser must never gain an extra tab).
    const [existing, probedPort] = await Promise.all([
        detectExistingBrowser(profilePath),
        findRunningCdpPort(9227),
    ]);
    const runningPort = existing.found && existing.port !== undefined ? existing.port : probedPort;
    if (runningPort !== undefined) {
        log('✅ Existing browser detected', 'success');
        await reuseExistingBrowser(runningPort, profilePath, existing.found ? existing.pid : undefined);
        await updatePromise;
        return;
    }
    // 2. 새 브라우저 실행 (기존 로직) — 실행 중인 브라우저가 전혀 없을 때만.
    const chromeReady = await ensureChrome();
    if (!chromeReady)
        return;
    await ensureProfile(profilePath);
    log(`📁 Browser profile: ${profilePath}`, 'success');
    const port = await findAvailablePort(9227);
    log(`🔌 CDP 포트 ${port} 열림 (http://localhost:${port}/json/version)`, 'success');
    await launchBrowser({ port, profilePath });
    log('🚀 ttj-skills-playwright가 열렸습니다, 작업할 페이지로 이동해서 명령해주세요.', 'success');
    // 시각화 요청 시: CDP가 열릴 때까지 기다린 뒤 오버레이 + 스크린샷
    // (spawn 직후 바로 연결하면 ECONNREFUSED가 날 수 있음)
    if (isVisualizeRequested()) {
        const ready = await waitForCdpReady(port);
        if (ready) {
            await visualizePageReferences({ port, profilePath }, { full: isFullScanRequested() });
        }
        else {
            log('CDP port did not open; skipping visualization', 'warning');
        }
    }
    // 백그라운드에서 브라우저 준비 상태 검증 (메인 플로우를 막지 않음)
    verifyBrowserReady({ port, profilePath })
        .then((ready) => {
        if (ready) {
            log('✅ Browser readiness verified', 'success');
        }
    })
        .catch(() => {
        // 조용히 실패 - 검증은 best-effort
    });
    await updatePromise;
};
const DEFAULT_SCREENSHOT_PATH = path.join(tmpdir(), 'ttj-screenshot.png');
/**
 * Poll until the CDP port starts accepting connections (max ~5s).
 */
const waitForCdpReady = async (port) => {
    const attempts = Array.from({ length: 20 });
    return attempts.reduce(async (acc) => {
        const ready = await acc;
        if (ready)
            return true;
        await new Promise((resolve) => setTimeout(resolve, 250));
        return !(await checkPortAvailable(port));
    }, Promise.resolve(false));
};
/** True when the caller passed --no-launch / --reuse-only (never launch). */
const isReuseOnly = () => process.argv.slice(2).some((a) => a === '--no-launch' || a === '--reuse-only');
/**
 * Resolve the CDP port of the running browser, preserving existing tabs.
 *
 * Order: (1) process detection, (2) direct CDP port probe — reuse an already
 * open browser even when process detection fails, WITHOUT launching or adding
 * a tab. Only when nothing is listening do we launch a new browser (unless
 * --no-launch was passed).
 */
const resolveRunningPort = async () => {
    const profilePath = getProfilePath();
    // Process detection (ps/CIM) and the CDP port probe are independent —
    // run them in parallel; either one finding the browser means reuse.
    const [existing, probed] = await Promise.all([
        detectExistingBrowser(profilePath),
        findRunningCdpPort(9227),
    ]);
    if (existing.found && existing.port !== undefined)
        return existing.port;
    if (probed !== undefined)
        return probed;
    if (isReuseOnly()) {
        log('No running browser found and --no-launch was set. Open the browser first with `ttj-skills-playwright`.', 'error');
        process.exitCode = 1;
        return undefined;
    }
    log('No running browser found; launching a new one...', 'info');
    const chromeReady = await ensureChrome();
    if (!chromeReady) {
        process.exitCode = 1;
        return undefined;
    }
    await ensureProfile(profilePath);
    const port = await findAvailablePort(9227);
    await launchBrowser({ port, profilePath });
    const ready = await waitForCdpReady(port);
    if (!ready) {
        log('Failed to auto-launch the browser. Please try again.', 'error');
        process.exitCode = 1;
        return undefined;
    }
    log(`✅ Browser auto-launched (CDP port ${port})`, 'success');
    return port;
};
/** Report a usage (argument) error: message to stderr, exit code 2. */
const usageError = (message) => {
    log(message, 'error');
    process.exitCode = 2;
};
/**
 * `eval <js>` — run JS in the active tab over CDP and print the result.
 */
const runEval = async (code) => {
    if (!code) {
        usageError('Pass JS code to run. e.g. ttj-skills-playwright eval "document.title"');
        return;
    }
    const port = await resolveRunningPort();
    if (port === undefined)
        return;
    const result = await evalInActivePage(port, code);
    console.log(result === undefined ? 'undefined' : JSON.stringify(result, null, 2));
};
/**
 * `goto <url>` — navigate the active tab and wait for the load event.
 */
const runGoto = async (url) => {
    if (!url) {
        usageError('Pass a URL to navigate to. e.g. ttj-skills-playwright goto https://example.com');
        return;
    }
    const port = await resolveRunningPort();
    if (port === undefined)
        return;
    const target = url.startsWith('http') ? url : `https://${url}`;
    const title = await gotoInActivePage(port, target);
    log(`✅ Navigated: ${target} (${title})`, 'success');
};
/**
 * `click <selector>` — click with a real (trusted) mouse event.
 */
const runClick = async (selector) => {
    if (!selector) {
        usageError('Pass a selector to click. e.g. ttj-skills-playwright click "#login-btn"');
        return;
    }
    const port = await resolveRunningPort();
    if (port === undefined)
        return;
    await clickInActivePage(port, selector);
    log(`✅ Clicked: ${selector}`, 'success');
};
/**
 * `type <selector> <text>` — type with human-like random keystroke delays.
 */
const runType = async (selector, text) => {
    if (!selector || text === undefined) {
        usageError('Pass a selector and text. e.g. ttj-skills-playwright type "#query" "hello"');
        return;
    }
    const port = await resolveRunningPort();
    if (port === undefined)
        return;
    await typeInActivePage(port, selector, text);
    log(`✅ Typed: ${selector} (${[...text].length} chars)`, 'success');
};
const DEFAULT_WAIT_TIMEOUT_MS = 10000;
/**
 * `wait <selector> [ms]` — wait for a selector to appear in the active tab.
 */
const runWait = async (selector, timeoutArg) => {
    if (!selector) {
        usageError('Pass a selector to wait for. e.g. ttj-skills-playwright wait ".result" 5000');
        return;
    }
    const timeoutMs = Number(timeoutArg) || DEFAULT_WAIT_TIMEOUT_MS;
    const port = await resolveRunningPort();
    if (port === undefined)
        return;
    await waitInActivePage(port, selector, timeoutMs);
    log(`✅ Element appeared: ${selector}`, 'success');
};
/**
 * `tabs` — list open tabs with 1-based indexes.
 */
const runTabs = async () => {
    const port = await resolveRunningPort();
    if (port === undefined)
        return;
    await printOpenTabs(port);
};
/**
 * `tab <n>` — bring the tab at index n to the front.
 */
const runTab = async (indexArg) => {
    const index = Number(indexArg);
    if (!Number.isInteger(index) || index < 1) {
        usageError('Pass a tab number. e.g. ttj-skills-playwright tab 2');
        return;
    }
    const port = await resolveRunningPort();
    if (port === undefined)
        return;
    const url = await activateTab(port, index);
    log(`✅ Switched tab: [${index}] ${url}`, 'success');
};
/**
 * `clear` — remove visualization overlays from the active tab.
 */
const runClear = async () => {
    const port = await resolveRunningPort();
    if (port === undefined)
        return;
    await clearOverlays(port);
    log('✅ Overlays cleared', 'success');
};
/**
 * `analyze [--full]` — visualize the page (instant red boxes; with --full also
 * auto-scroll + full-page screenshot) AND print a machine-readable JSON of the
 * page structure to stdout so an AI can propose crawlable targets.
 * Human-readable notes go through log() (stderr-style), so the last large
 * stdout payload is the JSON itself.
 */
const runAnalyze = async () => {
    const port = await resolveRunningPort();
    if (port === undefined)
        return;
    // 1) Visualization: instant red boxes + badges (screenshot only on --full).
    await visualizePageReferences({ port, profilePath: getProfilePath() }, { full: isFullScanRequested() });
    // 2) Structure analysis → JSON (the final, machine-readable stdout output).
    log('Analyzing page structure for crawlable targets...', 'info');
    const result = await analyzeActivePage(port);
    log('Page analysis JSON follows (repeating lists, tables, forms, meta):', 'info');
    console.log(JSON.stringify(result, null, 2));
};
/**
 * `screenshot [path] [--full]` — capture the active tab over CDP.
 */
const runScreenshot = async (args) => {
    const fullPage = args.includes('--full');
    const outputPath = args.find((arg) => !arg.startsWith('--')) ?? DEFAULT_SCREENSHOT_PATH;
    const port = await resolveRunningPort();
    if (port === undefined)
        return;
    const url = await screenshotActivePage(port, outputPath, fullPage);
    log(`📸 Screenshot saved: ${outputPath} (${url})`, 'success');
};
const cliArgs = process.argv.slice(2);
const [command, ...commandArgs] = cliArgs;
if (handleInfoFlags(cliArgs)) {
    process.exit(0);
}
const SUBCOMMANDS = {
    eval: () => runEval(commandArgs[0]),
    goto: () => runGoto(commandArgs[0]),
    click: () => runClick(commandArgs[0]),
    type: () => runType(commandArgs[0], commandArgs[1]),
    wait: () => runWait(commandArgs[0], commandArgs[1]),
    tabs: () => runTabs(),
    tab: () => runTab(commandArgs[0]),
    clear: () => runClear(),
    analyze: () => runAnalyze(),
    screenshot: () => runScreenshot(commandArgs),
};
const dispatch = () => (command !== undefined && SUBCOMMANDS[command]?.()) || main();
dispatch().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error while running: ${message}`, 'error');
    process.exitCode = 1;
});
//# sourceMappingURL=cli.js.map