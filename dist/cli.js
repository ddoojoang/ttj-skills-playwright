#!/usr/bin/env node
/**
 * TTJ Browser - CLI entry point
 */
import { log } from './logger.js';
import { getProfilePath, findAvailablePort } from './utils.js';
import { detectPlaywrightCli, detectChrome, ensureProfile, } from './detector.js';
import { installPlaywrightCli, launchBrowser, checkForUpdates, } from './browser.js';
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
const notifyUpdate = async () => {
    try {
        const versionInfo = await checkForUpdates();
        if (versionInfo.hasUpdate) {
            log(`새 버전 ${versionInfo.latest}이 있습니다. (현재: ${versionInfo.current}) "npm install -g ttj-browser"로 업데이트하세요.`, 'info');
        }
    }
    catch {
        // Update check is best-effort; ignore network failures gracefully.
    }
};
const main = async () => {
    log('🚀 TTJ 브라우저를 초기화 중입니다...', 'info');
    await ensurePlaywrightCli();
    const chromeReady = await ensureChrome();
    if (!chromeReady)
        return;
    const profilePath = getProfilePath();
    await ensureProfile(profilePath);
    log(`📁 브라우저 프로필 생성: ${profilePath}`, 'success');
    const port = await findAvailablePort(9227);
    log(`🔌 포트 ${port} 확인 완료`, 'success');
    await launchBrowser({ port, profilePath });
    log('🚀 TTJ 브라우저가 열렸습니다, 작업할 페이지로 이동해서 명령해주세요.', 'success');
    await notifyUpdate();
};
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    log(`실행 중 오류가 발생했습니다: ${message}`, 'error');
});
//# sourceMappingURL=cli.js.map