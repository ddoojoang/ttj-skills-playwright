#!/usr/bin/env node
/**
 * ttj-skills-browser - CLI entry point
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { log } from './logger.js';
import { getProfilePath, findAvailablePort } from './utils.js';
import { detectPlaywrightCli, detectChrome, ensureProfile, } from './detector.js';
import { installPlaywrightCli, launchBrowser, autoUpdateIfNeeded, verifyBrowserReady, visualizePageReferences, detectExistingBrowser, bringWindowToFront, } from './browser.js';
/**
 * Read the package version dynamically from package.json (ESM-safe).
 */
const getVersion = () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const packageJson = JSON.parse(readFileSync(path.join(currentDir, '../package.json'), 'utf-8'));
    return packageJson.version;
};
const HELP_MESSAGE = `
Usage: ttj-skills-browser [options]

Options:
  --version, -v    Show version
  --help, -h       Show this help message
  --visualize      Launch browser and visualize page references
  (no options)     Launch browser

Examples:
  $ ttj-skills-browser              # Start browser
  $ ttj-skills-browser --version    # Check version
  $ ttj-skills-browser --help       # Show help
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
const ensurePlaywrightCli = async () => {
    const detection = await detectPlaywrightCli();
    if (detection.found) {
        log('playwright-cli 확인 완료', 'success');
        return;
    }
    log('playwright-cli가 없어 설치를 진행합니다...', 'warning');
    await installPlaywrightCli();
    log('playwright-cli 설치 완료', 'success');
};
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
    await ensurePlaywrightCli();
    const chromeReady = await ensureChrome();
    if (!chromeReady)
        return;
    await ensureProfile(profilePath);
    log(`📁 브라우저 프로필 생성: ${profilePath}`, 'success');
    const port = await findAvailablePort(9227);
    log(`🔌 CDP 포트 ${port} 열림 (http://localhost:${port}/json/version)`, 'success');
    await launchBrowser({ port, profilePath });
    log('🚀 ttj-skills-browser가 열렸습니다, 작업할 페이지로 이동해서 명령해주세요.', 'success');
    // 시각화 요청 시: 현재 페이지의 모든 요소에 라벨 오버레이 + 스크린샷
    if (isVisualizeRequested()) {
        await visualizePageReferences({ port, profilePath });
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
const cliArgs = process.argv.slice(2);
if (handleInfoFlags(cliArgs)) {
    process.exit(0);
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    log(`실행 중 오류가 발생했습니다: ${message}`, 'error');
});
//# sourceMappingURL=cli.js.map