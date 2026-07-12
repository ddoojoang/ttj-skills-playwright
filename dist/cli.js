#!/usr/bin/env node
/**
 * ttj-skills-browser - CLI entry point
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { tmpdir } from 'node:os';
import path from 'path';
import { log } from './logger.js';
import { getProfilePath, findAvailablePort, checkPortAvailable, } from './utils.js';
import { detectChrome, ensureProfile } from './detector.js';
import { launchBrowser, autoUpdateIfNeeded, verifyBrowserReady, visualizePageReferences, visualizeCrawlTargets, detectExistingBrowser, bringWindowToFront, } from './browser.js';
import { evalInActivePage, gotoInActivePage, screenshotActivePage, clickInActivePage, typeInActivePage, waitInActivePage, listTabs, activateTab, } from './cdp.js';
/**
 * Read the package version dynamically from package.json (ESM-safe).
 */
const getVersion = () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const packageJson = JSON.parse(readFileSync(path.join(currentDir, '../package.json'), 'utf-8'));
    return packageJson.version;
};
const HELP_MESSAGE = `
Usage: ttj-skills-browser [command] [options]

Commands:
  eval <js>                Run JS in the active tab and print the result
  goto <url>               Navigate the active tab and wait for load
  click <selector>         Click an element (real/trusted mouse event)
  type <selector> <text>   Type with human-like random keystroke delays
  wait <selector> [ms]     Wait for a selector to appear (default 10000ms)
  tabs                     List open tabs with indexes
  tab <n>                  Bring tab n to the front
  crawl                    Detect crawlable repeating structures (badges + JSON)
  screenshot [path] [--full]  Capture the active tab (default: <tmpdir>/ttj-screenshot.png)

Options:
  --version, -v    Show version
  --help, -h       Show this help message
  --visualize      Launch browser and visualize page references
  (no options)     Launch browser

Examples:
  $ ttj-skills-browser              # Start browser
  $ ttj-skills-browser eval "document.title"
  $ ttj-skills-browser goto https://www.naver.com
  $ ttj-skills-browser eval "document.querySelector('#btn').style.background='yellow'"
  $ ttj-skills-browser screenshot /tmp/shot.png --full
  $ ttj-skills-browser --visualize  # Overlay element badges + screenshot
`;
/**
 * Handle informational CLI flags (--version, --help).
 * Returns true if a flag was handled and the process should exit early.
 */
const handleInfoFlags = (args) => {
    const wantsVersion = args.includes('--version') || args.includes('-v');
    const wantsHelp = args.includes('--help') || args.includes('-h');
    return wantsVersion
        ? (console.log(`ttj-skills-browser v${getVersion()}`), true)
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
const ensureChrome = async () => {
    const detection = await detectChrome();
    if (!detection.found) {
        log('Chrome/Chromium을 찾을 수 없습니다. Chrome을 설치한 뒤 다시 실행해주세요.', 'warning');
        return false;
    }
    log(`Chrome 확인 완료: ${detection.path}`, 'success');
    return true;
};
const main = async () => {
    log('🚀 ttj-skills-browser를 초기화 중입니다...', 'info');
    // 0. 가장 먼저 업데이트 확인 (브라우저를 열기 전에 최신 버전 보장)
    await autoUpdateIfNeeded();
    const profilePath = getProfilePath();
    // 1. 기존 브라우저 감지 (가장 먼저 - 있으면 재사용해서 빠르게 종료)
    const existing = await detectExistingBrowser(profilePath);
    if (existing.found) {
        log('✅ 기존 브라우저 감지됨', 'success');
        if (existing.pid !== undefined) {
            await bringWindowToFront(existing.pid);
        }
        log('🔄 Chrome 윈도우를 맨 앞으로 가져왔습니다', 'success');
        log('💬 작업하고 싶은 것을 말씀해주세요', 'info');
        if (isVisualizeRequested() && existing.port !== undefined) {
            await visualizePageReferences({ port: existing.port, profilePath });
        }
        return;
    }
    // 2. 새 브라우저 실행 (기존 로직)
    const chromeReady = await ensureChrome();
    if (!chromeReady)
        return;
    await ensureProfile(profilePath);
    log(`📁 브라우저 프로필 생성: ${profilePath}`, 'success');
    const port = await findAvailablePort(9227);
    log(`🔌 CDP 포트 ${port} 열림 (http://localhost:${port}/json/version)`, 'success');
    await launchBrowser({ port, profilePath });
    log('🚀 ttj-skills-browser가 열렸습니다, 작업할 페이지로 이동해서 명령해주세요.', 'success');
    // 시각화 요청 시: CDP가 열릴 때까지 기다린 뒤 오버레이 + 스크린샷
    // (spawn 직후 바로 연결하면 ECONNREFUSED가 날 수 있음)
    if (isVisualizeRequested()) {
        const ready = await waitForCdpReady(port);
        if (ready) {
            await visualizePageReferences({ port, profilePath });
        }
        else {
            log('CDP 포트가 열리지 않아 시각화를 건너뜁니다', 'warning');
        }
    }
    // 백그라운드에서 브라우저 준비 상태 검증 (메인 플로우를 막지 않음)
    verifyBrowserReady({ port, profilePath })
        .then((ready) => {
        if (ready) {
            log('✅ 브라우저 준비 상태 검증 완료', 'success');
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
/**
 * Resolve the CDP port of the running browser. If the user closed it,
 * relaunch automatically and continue — commands must never dead-end.
 */
const resolveRunningPort = async () => {
    const profilePath = getProfilePath();
    const existing = await detectExistingBrowser(profilePath);
    if (existing.found && existing.port !== undefined)
        return existing.port;
    log('브라우저가 닫혀 있어 자동으로 다시 실행합니다...', 'info');
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
        log('브라우저 자동 실행에 실패했습니다. 다시 시도해주세요.', 'error');
        process.exitCode = 1;
        return undefined;
    }
    log(`✅ 브라우저 자동 실행 완료 (CDP 포트 ${port})`, 'success');
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
        usageError('실행할 JS 코드를 전달해주세요. 예: ttj-skills-browser eval "document.title"');
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
        usageError('이동할 URL을 전달해주세요. 예: ttj-skills-browser goto https://www.naver.com');
        return;
    }
    const port = await resolveRunningPort();
    if (port === undefined)
        return;
    const target = url.startsWith('http') ? url : `https://${url}`;
    const title = await gotoInActivePage(port, target);
    log(`✅ 이동 완료: ${target} (${title})`, 'success');
};
/**
 * `click <selector>` — click with a real (trusted) mouse event.
 */
const runClick = async (selector) => {
    if (!selector) {
        usageError('클릭할 셀렉터를 전달해주세요. 예: ttj-skills-browser click "#login-btn"');
        return;
    }
    const port = await resolveRunningPort();
    if (port === undefined)
        return;
    await clickInActivePage(port, selector);
    log(`✅ 클릭 완료: ${selector}`, 'success');
};
/**
 * `type <selector> <text>` — type with human-like random keystroke delays.
 */
const runType = async (selector, text) => {
    if (!selector || text === undefined) {
        usageError('셀렉터와 텍스트를 전달해주세요. 예: ttj-skills-browser type "#query" "검색어"');
        return;
    }
    const port = await resolveRunningPort();
    if (port === undefined)
        return;
    await typeInActivePage(port, selector, text);
    log(`✅ 입력 완료: ${selector} (${[...text].length}자)`, 'success');
};
const DEFAULT_WAIT_TIMEOUT_MS = 10000;
/**
 * `wait <selector> [ms]` — wait for a selector to appear in the active tab.
 */
const runWait = async (selector, timeoutArg) => {
    if (!selector) {
        usageError('기다릴 셀렉터를 전달해주세요. 예: ttj-skills-browser wait ".result" 5000');
        return;
    }
    const timeoutMs = Number(timeoutArg) || DEFAULT_WAIT_TIMEOUT_MS;
    const port = await resolveRunningPort();
    if (port === undefined)
        return;
    await waitInActivePage(port, selector, timeoutMs);
    log(`✅ 요소 등장 확인: ${selector}`, 'success');
};
/**
 * `tabs` — list open tabs with 1-based indexes.
 */
const runTabs = async () => {
    const port = await resolveRunningPort();
    if (port === undefined)
        return;
    const tabs = await listTabs(port);
    const lines = tabs.map((tab) => `${tab.active ? '▶' : ' '} [${tab.index}] ${tab.title || '(제목 없음)'} — ${tab.url}`);
    console.log(lines.join('\n') || '열린 탭이 없습니다.');
};
/**
 * `tab <n>` — bring the tab at index n to the front.
 */
const runTab = async (indexArg) => {
    const index = Number(indexArg);
    if (!Number.isInteger(index) || index < 1) {
        usageError('탭 번호를 전달해주세요. 예: ttj-skills-browser tab 2');
        return;
    }
    const port = await resolveRunningPort();
    if (port === undefined)
        return;
    const url = await activateTab(port, index);
    log(`✅ 탭 전환 완료: [${index}] ${url}`, 'success');
};
/**
 * `crawl` — detect crawlable repeating structures on the active tab.
 */
const runCrawl = async () => {
    const port = await resolveRunningPort();
    if (port === undefined)
        return;
    await visualizeCrawlTargets({ port, profilePath: getProfilePath() });
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
    log(`📸 스크린샷 저장: ${outputPath} (${url})`, 'success');
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
    crawl: () => runCrawl(),
    screenshot: () => runScreenshot(commandArgs),
};
const dispatch = () => (command !== undefined && SUBCOMMANDS[command]?.()) || main();
dispatch().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    log(`실행 중 오류가 발생했습니다: ${message}`, 'error');
    process.exitCode = 1;
});
//# sourceMappingURL=cli.js.map