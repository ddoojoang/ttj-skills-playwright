#!/usr/bin/env node
/**
 * ttj-skills-playwright - CLI entry point
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { tmpdir } from 'node:os';
import path from 'path';
import { log } from './logger.js';
import {
  getProfilePath,
  findAvailablePort,
  checkPortAvailable,
  findRunningCdpPort,
  getPidForPort,
} from './utils.js';
import { detectChrome, ensureProfile } from './detector.js';
import {
  launchBrowser,
  updateToLatestBeforeLaunch,
  verifyBrowserReady,
  visualizePageReferences,
  detectExistingBrowser,
  bringWindowToFront,
} from './browser.js';
import {
  evalInActivePage,
  gotoInActivePage,
  screenshotActivePage,
  clickInActivePage,
  typeInActivePage,
  waitInActivePage,
  fillInActivePage,
  pressInActivePage,
  listTabs,
  activateTab,
  clearOverlays,
  runBatchInActivePage,
} from './cdp.js';
import type { BatchStep, BatchStepResult } from './types.js';
import { analyzeActivePage } from './analyzer.js';
import { hasNativeWebSocket, isWsConnectError } from './cdp-ws.js';
import {
  parseActionTarget,
  clickInActiveTabWs,
  fillInActiveTabWs,
  pressInActiveTabWs,
  typeInActiveTabWs,
} from './input-ws.js';
import { snapshotActiveTab } from './snapshot.js';
import { runBatchOverWs } from './batch.js';
import { collectConsole } from './console-ws.js';

/**
 * Read the package version dynamically from package.json (ESM-safe).
 */
const getVersion = (): string => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const packageJson = JSON.parse(
    readFileSync(path.join(currentDir, '../package.json'), 'utf-8'),
  ) as { version: string };
  return packageJson.version;
};

const HELP_MESSAGE = `
Usage: ttj-skills-playwright [command] [options]

Commands:
  eval <js>                Run JS in the active tab and print the result
  goto <url>               Navigate the active tab and wait for load
  snapshot [--depth N]     ARIA snapshot → file (compact tree + refs e1, e2, …)
  click <ref|selector>     Click an element (real/trusted mouse event) — accepts e5 or CSS
  type <ref|selector> <text>  Type like a human (random 100–300ms/key) — DEFAULT for text entry
  fill <ref|selector> <text>  Set a field instantly (no key delay) — only when explicitly wanted
  press <key>              Press a key on the focused element (Enter, Tab, ArrowDown, …)
  wait <selector> [ms]     Wait for a selector to appear (default 10000ms)
  console [--watch N]      Print the tab's console messages (buffered replay + N live seconds)
  tabs                     List open tabs with indexes
  tab <n>                  Bring tab n to the front
  clear                    Remove visualization overlays from the page
  analyze [--full]         Overlay red boxes + print page structure JSON (crawl targets)
  batch '<json-steps>'     Run several actions in one process + one CDP connection
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
  $ ttj-skills-playwright snapshot     # Page → compact ref tree file (read it, then act by ref)
  $ ttj-skills-playwright type e5 "user@mail.com"   # Human-like typing by snapshot ref
  $ ttj-skills-playwright press Enter
  $ ttj-skills-playwright batch '[{"cmd":"goto","url":"https://site.com/login"},{"cmd":"snapshot"},{"cmd":"type","ref":"e5","text":"user"},{"cmd":"press","key":"Enter"}]'
`;

/**
 * Handle informational CLI flags (--version, --help).
 * Returns true if a flag was handled and the process should exit early.
 */
const handleInfoFlags = (args: readonly string[]): boolean => {
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
const isVisualizeRequested = (): boolean =>
  process.env.VISUALIZE === 'true' ||
  process.argv.slice(2).some((arg) => arg === '--visualize' || arg === 'visualize');

/**
 * Whether the user requested the FULL (slow) scan: auto-scroll the whole page
 * first (triggers lazy-loading) + full-page screenshot. Without it, visualize/
 * analyze draw boxes instantly on what is currently rendered.
 */
const isFullScanRequested = (): boolean =>
  process.argv.slice(2).includes('--full');

const ensureChrome = async (): Promise<boolean> => {
  const detection = await detectChrome();
  if (!detection.found) {
    log(
      'Chrome/Chromium을 찾을 수 없습니다. Chrome을 설치한 뒤 다시 실행해주세요.',
      'warning',
    );
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
const printOpenTabs = async (port: number): Promise<void> => {
  const tabs = await listTabs(port);
  const lines = tabs.map(
    (tab) =>
      `${tab.active ? '▶' : ' '} [${tab.index}] ${tab.title || '(제목 없음)'} — ${tab.url}`,
  );
  console.log(lines.join('\n') || 'No open tabs.');
};

/**
 * Reuse an already-running browser. Top invariant: NEVER launch a browser or
 * open a tab here. Brings the window to the front (pid may be undefined when
 * found via CDP probe), lists the open tabs to stdout, logs the reuse, and
 * runs visualization when requested.
 */
const reuseExistingBrowser = async (
  port: number,
  profilePath: string,
  pid?: number,
): Promise<void> => {
  // Focus the window without blocking: resolve the owning pid via the fast
  // port→pid lookup (netstat/lsof) when the probe path didn't supply one,
  // then fire the detached focus command. Runs concurrently with tab listing.
  const focusPromise = (
    pid !== undefined
      ? Promise.resolve<number | undefined>(pid)
      : getPidForPort(port)
  ).then((resolvedPid) => bringWindowToFront(resolvedPid));
  log('✅ Reused the existing browser — no new tab was opened', 'success');
  log('📋 Currently open tabs:', 'info');
  await printOpenTabs(port);
  await focusPromise;
  log('🔄 Brought Chrome window to front', 'success');
  log(
    '💬 AI: report these tabs to the user and ask which tab (n) to work on and what to do',
    'info',
  );

  if (isVisualizeRequested()) {
    await visualizePageReferences(
      { port, profilePath },
      { full: isFullScanRequested() },
    );
  }
};

const main = async (): Promise<void> => {
  log('🚀 Initializing ttj-skills-playwright...', 'info');

  // 0. 스킬 발동 계약: 브라우저를 열기 전에 항상 최신 버전을 확인하고,
  //    있으면 업데이트를 '끝낸 뒤' 진행한다 (레지스트리 확인 1.5s 하드
  //    타임아웃 + 설치 90s 상한, 실패 시 현재 버전으로 계속 — fail-open).
  await updateToLatestBeforeLaunch();

  const profilePath = getProfilePath();

  // 1. CDP 포트 프로브 먼저 (전 포트 병렬, ≤300ms 보장) — 켜진 브라우저를
  //    찾는 가장 빠른 경로. 여기서 찾으면 느린 프로세스 스캔(macOS ps는
  //    빠르지만 Windows CIM/PowerShell은 1~2.5초)을 아예 건너뛴다.
  const probedPort = await findRunningCdpPort(9227);
  if (probedPort !== undefined) {
    log('✅ Existing browser detected', 'success');
    await reuseExistingBrowser(probedPort, profilePath);
    return;
  }

  // 1b. Fallback: CDP 포트가 프로브 범위(9227~9237) 밖에 있을 수 있으니
  //     프로세스 매칭으로 한 번 더 확인. NEVER launch when one exists
  //     (top invariant: a running browser must never gain an extra tab).
  const existing = await detectExistingBrowser(profilePath);
  if (existing.found && existing.port !== undefined) {
    log('✅ Existing browser detected (process scan)', 'success');
    await reuseExistingBrowser(existing.port, profilePath, existing.pid);
    return;
  }

  // 2. 새 브라우저 실행 (기존 로직) — 실행 중인 브라우저가 전혀 없을 때만.
  const chromeReady = await ensureChrome();
  if (!chromeReady) return;

  await ensureProfile(profilePath);
  log(`📁 Browser profile: ${profilePath}`, 'success');

  const port = await findAvailablePort(9227);
  log(
    `🔌 CDP 포트 ${port} 열림 (http://localhost:${port}/json/version)`,
    'success',
  );

  await launchBrowser({ port, profilePath });

  log(
    '🚀 ttj-skills-playwright가 열렸습니다, 작업할 페이지로 이동해서 명령해주세요.',
    'success',
  );

  // 시각화 요청 시: CDP가 열릴 때까지 기다린 뒤 오버레이 + 스크린샷
  // (spawn 직후 바로 연결하면 ECONNREFUSED가 날 수 있음)
  if (isVisualizeRequested()) {
    const ready = await waitForCdpReady(port);
    if (ready) {
      await visualizePageReferences(
        { port, profilePath },
        { full: isFullScanRequested() },
      );
    } else {
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

};

const DEFAULT_SCREENSHOT_PATH = path.join(tmpdir(), 'ttj-screenshot.png');

/**
 * Poll until the CDP port starts accepting connections (max ~5s).
 */
const waitForCdpReady = async (port: number): Promise<boolean> => {
  const attempts = Array.from({ length: 20 });
  return attempts.reduce<Promise<boolean>>(async (acc) => {
    const ready = await acc;
    if (ready) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
    return !(await checkPortAvailable(port));
  }, Promise.resolve(false));
};

/** True when the caller passed --no-launch / --reuse-only (never launch). */
const isReuseOnly = (): boolean =>
  process.argv.slice(2).some((a) => a === '--no-launch' || a === '--reuse-only');

/**
 * Resolve the CDP port of the running browser, preserving existing tabs.
 *
 * Order: (1) process detection, (2) direct CDP port probe — reuse an already
 * open browser even when process detection fails, WITHOUT launching or adding
 * a tab. Only when nothing is listening do we launch a new browser (unless
 * --no-launch was passed).
 */
const resolveRunningPort = async (): Promise<number | undefined> => {
  const profilePath = getProfilePath();

  // CDP port probe first (parallel across ports, ≤300ms) — the fastest way
  // to find a live browser; skips the slow process scan (Windows PowerShell
  // CIM takes 1–2.5s). Process matching remains as a fallback for a CDP port
  // outside the probe range.
  const probed = await findRunningCdpPort(9227);
  if (probed !== undefined) return probed;

  const existing = await detectExistingBrowser(profilePath);
  if (existing.found && existing.port !== undefined) return existing.port;

  if (isReuseOnly()) {
    log(
      'No running browser found and --no-launch was set. Open the browser first with `ttj-skills-playwright`.',
      'error',
    );
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
const usageError = (message: string): void => {
  log(message, 'error');
  process.exitCode = 2;
};

/**
 * `eval <js>` — run JS in the active tab over CDP and print the result.
 */
const runEval = async (code: string | undefined): Promise<void> => {
  if (!code) {
    usageError('Pass JS code to run. e.g. ttj-skills-playwright eval "document.title"');
    return;
  }
  const port = await resolveRunningPort();
  if (port === undefined) return;
  const result = await evalInActivePage(port, code);
  console.log(
    result === undefined ? 'undefined' : JSON.stringify(result, null, 2),
  );
};

/**
 * `goto <url>` — navigate the active tab and wait for the load event.
 */
const runGoto = async (url: string | undefined): Promise<void> => {
  if (!url) {
    usageError('Pass a URL to navigate to. e.g. ttj-skills-playwright goto https://example.com');
    return;
  }
  const port = await resolveRunningPort();
  if (port === undefined) return;
  const target = url.startsWith('http') ? url : `https://${url}`;
  const title = await gotoInActivePage(port, target);
  log(`✅ Navigated: ${target} (${title})`, 'success');
};

/**
 * Ref actions (e5) are only possible over the WS pipeline (Node 22+): the
 * playwright path has no backendNodeId access. Returns true when the caller
 * must abort (error already reported).
 */
const rejectRefWithoutWs = (arg: string): boolean => {
  if (parseActionTarget(arg).kind === 'ref' && !hasNativeWebSocket()) {
    log(
      `Ref actions (${arg}) need Node 22+ (native WebSocket). Use a CSS selector or upgrade Node.`,
      'error',
    );
    process.exitCode = 1;
    return true;
  }
  return false;
};

/**
 * `click <ref|selector>` — click with a real (trusted) mouse event.
 * WS fast path (exact MRU tab, hard timeout); playwright fallback for CSS
 * selectors when the socket is unavailable.
 */
const runClick = async (selector: string | undefined): Promise<void> => {
  if (!selector) {
    usageError('Pass a ref or selector to click. e.g. ttj-skills-playwright click e5  |  click "#login-btn"');
    return;
  }
  const port = await resolveRunningPort();
  if (port === undefined) return;
  if (rejectRefWithoutWs(selector)) return;
  const target = parseActionTarget(selector);
  if (hasNativeWebSocket()) {
    try {
      await clickInActiveTabWs(port, target);
      log(`✅ Clicked: ${selector}`, 'success');
      return;
    } catch (error) {
      if (target.kind === 'ref' || !isWsConnectError(error)) throw error;
      // Socket-level failure on a CSS selector — retry via playwright.
    }
  }
  await clickInActivePage(port, selector);
  log(`✅ Clicked: ${selector}`, 'success');
};

/**
 * `fill <ref|selector> <text>` — set a field instantly (focus → select-all →
 * trusted insertText). No per-key delay: the fast default for login forms.
 */
const runFill = async (
  selector: string | undefined,
  text: string | undefined,
): Promise<void> => {
  if (!selector || text === undefined) {
    usageError('Pass a ref/selector and text. e.g. ttj-skills-playwright fill e5 "user@mail.com"');
    return;
  }
  const port = await resolveRunningPort();
  if (port === undefined) return;
  if (rejectRefWithoutWs(selector)) return;
  const target = parseActionTarget(selector);
  if (hasNativeWebSocket()) {
    try {
      await fillInActiveTabWs(port, target, text);
      log(`✅ Filled: ${selector} (${[...text].length} chars)`, 'success');
      return;
    } catch (error) {
      if (target.kind === 'ref' || !isWsConnectError(error)) throw error;
    }
  }
  await fillInActivePage(port, selector, text);
  log(`✅ Filled: ${selector} (${[...text].length} chars)`, 'success');
};

/**
 * `press <key>` — press a keyboard key on the focused element.
 */
const runPress = async (key: string | undefined): Promise<void> => {
  if (!key) {
    usageError('Pass a key to press. e.g. ttj-skills-playwright press Enter');
    return;
  }
  const port = await resolveRunningPort();
  if (port === undefined) return;
  if (hasNativeWebSocket()) {
    try {
      await pressInActiveTabWs(port, key);
      log(`✅ Pressed: ${key}`, 'success');
      return;
    } catch (error) {
      if (!isWsConnectError(error)) throw error;
    }
  }
  await pressInActivePage(port, key);
  log(`✅ Pressed: ${key}`, 'success');
};

/**
 * `snapshot [--depth N]` — ARIA accessibility snapshot of the active tab.
 * The tree goes to a file; stdout carries only URL/title/path/counts (the AI
 * reads the file selectively — that's the token-efficiency contract).
 */
const runSnapshot = async (): Promise<void> => {
  const port = await resolveRunningPort();
  if (port === undefined) return;
  const summary = await snapshotActiveTab(port);
  if (summary.refless) {
    log(
      'Node <22 fallback: snapshot saved WITHOUT refs — ref actions (click e5) unavailable. Use CSS selectors.',
      'warning',
    );
  }
  if (summary.unexpandedIframes > 0) {
    log(
      `${summary.unexpandedIframes} cross-origin iframe(s) not expanded (refs point at the <iframe> element)`,
      'warning',
    );
  }
  console.log(`URL: ${summary.url}`);
  console.log(`Title: ${summary.title}`);
  console.log(
    `Snapshot: ${summary.filePath} (${summary.lineCount} lines, ${summary.refCount} refs)`,
  );
};

/**
 * `console [--watch N]` — print the tab's console messages (buffered replay,
 * plus N seconds of live collection when --watch is passed).
 */
const runConsole = async (args: readonly string[]): Promise<void> => {
  const watchIndex = args.indexOf('--watch');
  const watchSeconds =
    watchIndex >= 0 ? Math.max(0, Number(args[watchIndex + 1]) || 0) : 0;
  const port = await resolveRunningPort();
  if (port === undefined) return;
  const lines = await collectConsole(port, watchSeconds);
  console.log(lines.join('\n') || '(no console messages)');
  log(`✅ Collected ${lines.length} console message(s)`, 'success');
};

/**
 * `type <ref|selector> <text>` — type with human-like random keystroke
 * delays (the DEFAULT for entering text). WS fast connection, human-paced
 * keystrokes; playwright fallback for CSS selectors.
 */
const runType = async (
  selector: string | undefined,
  text: string | undefined,
): Promise<void> => {
  if (!selector || text === undefined) {
    usageError('Pass a ref/selector and text. e.g. ttj-skills-playwright type e8 "hello"  |  type "#query" "hello"');
    return;
  }
  const port = await resolveRunningPort();
  if (port === undefined) return;
  if (rejectRefWithoutWs(selector)) return;
  const target = parseActionTarget(selector);
  if (hasNativeWebSocket()) {
    try {
      await typeInActiveTabWs(port, target, text);
      log(`✅ Typed: ${selector} (${[...text].length} chars)`, 'success');
      return;
    } catch (error) {
      if (target.kind === 'ref' || !isWsConnectError(error)) throw error;
    }
  }
  await typeInActivePage(port, selector, text);
  log(`✅ Typed: ${selector} (${[...text].length} chars)`, 'success');
};

const DEFAULT_WAIT_TIMEOUT_MS = 10_000;

/**
 * `wait <selector> [ms]` — wait for a selector to appear in the active tab.
 */
const runWait = async (
  selector: string | undefined,
  timeoutArg: string | undefined,
): Promise<void> => {
  if (!selector) {
    usageError('Pass a selector to wait for. e.g. ttj-skills-playwright wait ".result" 5000');
    return;
  }
  const timeoutMs = Number(timeoutArg) || DEFAULT_WAIT_TIMEOUT_MS;
  const port = await resolveRunningPort();
  if (port === undefined) return;
  await waitInActivePage(port, selector, timeoutMs);
  log(`✅ Element appeared: ${selector}`, 'success');
};

/**
 * `tabs` — list open tabs with 1-based indexes.
 */
const runTabs = async (): Promise<void> => {
  const port = await resolveRunningPort();
  if (port === undefined) return;
  await printOpenTabs(port);
};

/**
 * `tab <n>` — bring the tab at index n to the front.
 */
const runTab = async (indexArg: string | undefined): Promise<void> => {
  const index = Number(indexArg);
  if (!Number.isInteger(index) || index < 1) {
    usageError('Pass a tab number. e.g. ttj-skills-playwright tab 2');
    return;
  }
  const port = await resolveRunningPort();
  if (port === undefined) return;
  const url = await activateTab(port, index);
  log(`✅ Switched tab: [${index}] ${url}`, 'success');
};

/**
 * `clear` — remove visualization overlays from the active tab.
 */
const runClear = async (): Promise<void> => {
  const port = await resolveRunningPort();
  if (port === undefined) return;
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
const runAnalyze = async (): Promise<void> => {
  const port = await resolveRunningPort();
  if (port === undefined) return;

  // 1) Visualization: instant red boxes + badges (screenshot only on --full).
  await visualizePageReferences(
    { port, profilePath: getProfilePath() },
    { full: isFullScanRequested() },
  );

  // 2) Structure analysis → JSON (the final, machine-readable stdout output).
  log('Analyzing page structure for crawlable targets...', 'info');
  const result = await analyzeActivePage(port);
  log(
    'Page analysis JSON follows (repeating lists, tables, forms, meta):',
    'info',
  );
  console.log(JSON.stringify(result, null, 2));
};

/**
 * Parse the `batch` JSON argument into steps, or undefined when invalid.
 */
const parseBatchSteps = (json: string): BatchStep[] | undefined => {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) && parsed.length > 0
      ? (parsed as BatchStep[])
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Route a batch to the right runner. WS runner (one per-tab socket, refs,
 * hard timeouts) whenever possible; playwright runner on Node <22, with the
 * usual socket-failure fallback.
 */
const runBatchSmart = async (
  port: number,
  steps: readonly BatchStep[],
): Promise<BatchStepResult[]> => {
  if (hasNativeWebSocket()) {
    try {
      return await runBatchOverWs(port, steps);
    } catch (error) {
      if (!isWsConnectError(error)) throw error;
    }
  }
  return runBatchInActivePage(port, steps);
};

/**
 * `batch '<json-steps>'` — run several actions in ONE process + ONE CDP
 * connection. stdout is the JSON results array only (the AI parses it);
 * human notes go through log().
 */
const runBatch = async (json?: string): Promise<void> => {
  const steps = json === undefined ? undefined : parseBatchSteps(json);
  if (!steps) {
    log(
      'Usage: ttj-skills-playwright batch \'[{"cmd":"click","selector":"#btn"},{"cmd":"eval","code":"location.href"}]\' — non-empty JSON array required (cmds: goto|click|type|wait|eval|screenshot|fill|press|snapshot)',
      'error',
    );
    process.exitCode = 1;
    return;
  }
  const port = await resolveRunningPort();
  if (port === undefined) return;
  const results = await runBatchSmart(port, steps);
  console.log(JSON.stringify(results, null, 2));
  if (results.some((r) => !r.ok)) {
    process.exitCode = 1;
  }
};

/**
 * `screenshot [path] [--full]` — capture the active tab over CDP.
 */
const runScreenshot = async (args: readonly string[]): Promise<void> => {
  const fullPage = args.includes('--full');
  const outputPath =
    args.find((arg) => !arg.startsWith('--')) ?? DEFAULT_SCREENSHOT_PATH;
  const port = await resolveRunningPort();
  if (port === undefined) return;
  const url = await screenshotActivePage(port, outputPath, fullPage);
  log(`📸 Screenshot saved: ${outputPath} (${url})`, 'success');
};

const cliArgs = process.argv.slice(2);
const [command, ...commandArgs] = cliArgs;

if (handleInfoFlags(cliArgs)) {
  process.exit(0);
}

const SUBCOMMANDS: Record<string, (() => Promise<void>) | undefined> = {
  eval: () => runEval(commandArgs[0]),
  goto: () => runGoto(commandArgs[0]),
  click: () => runClick(commandArgs[0]),
  fill: () => runFill(commandArgs[0], commandArgs[1]),
  press: () => runPress(commandArgs[0]),
  snapshot: () => runSnapshot(),
  console: () => runConsole(commandArgs),
  type: () => runType(commandArgs[0], commandArgs[1]),
  wait: () => runWait(commandArgs[0], commandArgs[1]),
  tabs: () => runTabs(),
  tab: () => runTab(commandArgs[0]),
  clear: () => runClear(),
  analyze: () => runAnalyze(),
  screenshot: () => runScreenshot(commandArgs),
  batch: () => runBatch(commandArgs[0]),
};

const dispatch = (): Promise<void> =>
  (command !== undefined && SUBCOMMANDS[command]?.()) || main();

dispatch().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  log(`Error while running: ${message}`, 'error');
  process.exitCode = 1;
});
