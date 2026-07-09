#!/usr/bin/env node
/**
 * TTJ Browser - CLI entry point
 */

import { log } from './logger.js';
import { getProfilePath, findAvailablePort } from './utils.js';
import {
  detectPlaywrightCli,
  detectChrome,
  ensureProfile,
} from './detector.js';
import {
  installPlaywrightCli,
  launchBrowser,
  autoUpdateIfNeeded,
  verifyBrowserReady,
  visualizePageReferences,
  detectExistingBrowser,
  bringWindowToFront,
} from './browser.js';

/**
 * Whether the user requested reference visualization.
 * Triggered by `VISUALIZE=true` env or a `--visualize` / `visualize` CLI arg.
 */
const isVisualizeRequested = (): boolean =>
  process.env.VISUALIZE === 'true' ||
  process.argv.slice(2).some((arg) => arg === '--visualize' || arg === 'visualize');

const ensurePlaywrightCli = async (): Promise<void> => {
  const detection = await detectPlaywrightCli();
  if (detection.found) {
    log('playwright-cli 확인 완료', 'success');
    return;
  }
  log('playwright-cli가 없어 설치를 진행합니다...', 'warning');
  await installPlaywrightCli();
  log('playwright-cli 설치 완료', 'success');
};

const ensureChrome = async (): Promise<boolean> => {
  const detection = await detectChrome();
  if (!detection.found) {
    log(
      'Chrome/Chromium을 찾을 수 없습니다. Chrome을 설치한 뒤 다시 실행해주세요.',
      'warning',
    );
    return false;
  }
  log(`Chrome 확인 완료: ${detection.path}`, 'success');
  return true;
};

const main = async (): Promise<void> => {
  log('🚀 TTJ 브라우저를 초기화 중입니다...', 'info');

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
  if (!chromeReady) return;

  await ensureProfile(profilePath);
  log(`📁 브라우저 프로필 생성: ${profilePath}`, 'success');

  const port = await findAvailablePort(9227);
  log(
    `🔌 CDP 포트 ${port} 열림 (http://localhost:${port}/json/version)`,
    'success',
  );

  await launchBrowser({ port, profilePath });

  // 최신 버전이 있으면 자동으로 업데이트 (실패해도 현재 버전으로 진행)
  await autoUpdateIfNeeded();

  log(
    '🚀 TTJ 브라우저가 열렸습니다, 작업할 페이지로 이동해서 명령해주세요.',
    'success',
  );

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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  log(`실행 중 오류가 발생했습니다: ${message}`, 'error');
});
