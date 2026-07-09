/**
 * TTJ Browser - Browser manager (install, launch, update check)
 */

import { spawn } from 'child_process';
import {
  execCommand,
  execFileCommand,
  getVersionFromPackageJson,
  getLatestVersionFromNpm,
  checkPortAvailable,
} from './utils.js';
import { detectPlaywrightCli, detectChrome } from './detector.js';
import { log } from './logger.js';
import type { BrowserConfig, VersionInfo } from './types.js';

const START_URL = 'https://www.google.com';

const VISUAL_SCREENSHOT_PATH = '/tmp/ttj-refs-visual.png';

const RETRY_INTERVAL_MS = 100;
const RETRY_MAX_ATTEMPTS = 10;

/**
 * Install playwright-cli globally via npm.
 */
export const installPlaywrightCli = async (): Promise<void> => {
  await execCommand('npm install -g @playwright/cli');
};

/**
 * Build the argument list for launching Chrome directly (native flags).
 */
const buildLaunchArgs = (config: BrowserConfig): string[] => [
  `--remote-debugging-port=${config.port}`,
  `--user-data-dir=${config.profilePath}`,
  '--no-first-run',
  '--no-default-browser-check',
  START_URL,
];

/**
 * Launch Chrome directly as a detached child process.
 * Chrome natively supports --remote-debugging-port, so we skip playwright-cli.
 */
export const launchBrowser = async (config: BrowserConfig): Promise<void> => {
  const chrome = await detectChrome();
  if (!chrome.found || !chrome.path) {
    throw new Error('Chrome/Chromium binary not found');
  }

  const chromePath = chrome.path;
  return new Promise((resolve, reject) => {
    const child = spawn(chromePath, buildLaunchArgs(config), {
      stdio: 'ignore',
      detached: true,
    });

    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
};

/**
 * Compare semantic-ish version strings without mutating inputs.
 */
const isNewer = (latest: string, current: string): boolean => {
  const toParts = (v: string): number[] =>
    v.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const latestParts = toParts(latest);
  const currentParts = toParts(current);
  const length = Math.max(latestParts.length, currentParts.length);
  const indices = Array.from({ length }, (_, i) => i);
  const diff = indices
    .map((i) => (latestParts[i] ?? 0) - (currentParts[i] ?? 0))
    .find((d) => d !== 0);
  return (diff ?? 0) > 0;
};

/**
 * Check for updates by comparing local vs npm-published versions.
 */
export const checkForUpdates = async (): Promise<VersionInfo> => {
  const [current, latest] = await Promise.all([
    getVersionFromPackageJson(),
    getLatestVersionFromNpm(),
  ]);
  return { current, latest, hasUpdate: isNewer(latest, current) };
};

/**
 * Auto-update to the latest version when one is available.
 * Best-effort: any failure is swallowed so the user keeps the current version.
 */
export const autoUpdateIfNeeded = async (): Promise<void> => {
  try {
    const versionInfo = await checkForUpdates();
    if (versionInfo.hasUpdate) {
      log(
        `업데이트 중... (${versionInfo.current} → ${versionInfo.latest})`,
        'info',
      );
      await execCommand('npm install -g ttj-skills-browser@latest');
      log(
        `✅ 최신버전이 있어서 업데이트했습니다 (${versionInfo.current} → ${versionInfo.latest})`,
        'success',
      );
    }
  } catch {
    // Update failure is ignored; the user continues on the current version.
  }
};

/**
 * Pause execution for `ms` milliseconds (non-blocking).
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry an async boolean check by polling: run `check`, and on a falsy result
 * wait `RETRY_INTERVAL_MS` and try again, up to `RETRY_MAX_ATTEMPTS` times.
 * Declarative recursion — no loops, no mutation.
 */
const retryCheck = async (
  check: () => Promise<boolean>,
  attemptsLeft: number = RETRY_MAX_ATTEMPTS,
): Promise<boolean> => {
  const passed = await check();
  if (passed) return true;
  if (attemptsLeft <= 1) return false;
  await sleep(RETRY_INTERVAL_MS);
  return retryCheck(check, attemptsLeft - 1);
};

/**
 * Verify that the browser is ready by polling three signals in parallel:
 *  - playwright-cli is resolvable
 *  - Chrome / Chromium is resolvable
 *  - the debugging port is occupied (browser is listening on it)
 * Each check retries at 100ms intervals for up to 10 attempts.
 */
export const verifyBrowserReady = async (
  config: BrowserConfig,
): Promise<boolean> => {
  const [playwrightReady, chromeReady, portOccupied] = await Promise.all([
    retryCheck(async () => (await detectPlaywrightCli()).found === true),
    retryCheck(async () => (await detectChrome()).found === true),
    retryCheck(async () => (await checkPortAvailable(config.port)) === false),
  ]);
  return playwrightReady && chromeReady && portOccupied;
};

/**
 * Injected page-side script (ported from the `bb 2` reference visualizer).
 * Runs inside `page.evaluate` via `playwright-cli run-code`, so it is authored
 * in browser JavaScript (not project FP TypeScript). It:
 *  1. auto-scrolls to trigger lazy-loaded content,
 *  2. overlays numbered badges (e1, e2, ...) + selector labels on every visible
 *     div / interactive element,
 *  3. wires click-to-copy of a unique CSS selector to the clipboard.
 */
const REFERENCE_OVERLAY_CODE = `async page => {
  await page.evaluate(async () => {
    const distance = window.innerHeight;
    let currentPosition = 0;
    const maxScroll = document.body.scrollHeight;
    while (currentPosition < maxScroll) {
      window.scrollTo(0, currentPosition);
      currentPosition += distance;
      await new Promise(r => setTimeout(r, 200));
    }
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 300));
  });

  await page.evaluate(() => {
    document.querySelectorAll('.pw-ref-overlay,.pw-ref-style,.pw-ref-svg,.pw-ref-badge').forEach(e => e.remove());
    document.querySelectorAll('.pw-ref-highlight').forEach(e => e.classList.remove('pw-ref-highlight'));

    const style = document.createElement('style');
    style.className = 'pw-ref-style';
    style.textContent = \`
      .pw-ref-badge {
        position:absolute;width:18px;height:18px;border-radius:50%;
        background:rgba(220,38,38,0.92);color:#fff;font-size:9px;font-weight:bold;
        display:flex;align-items:center;justify-content:center;
        z-index:999999;pointer-events:auto;cursor:pointer;font-family:monospace;
        box-shadow:0 1px 3px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.5);
        line-height:1;transition:transform 0.1s;
      }
      .pw-ref-badge:hover {
        transform:scale(1.2);background:rgba(30,64,175,0.95);
      }
      .pw-ref-badge.pw-copied {
        background:rgba(22,163,74,0.95);
      }
      .pw-ref-overlay {
        position:absolute;background:rgba(220,38,38,0.92);color:#fff;
        font-size:10px;font-weight:bold;padding:2px 5px;border-radius:4px;
        z-index:999999;pointer-events:none;
        font-family:monospace;line-height:14px;white-space:nowrap;
        box-shadow:0 2px 6px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.3);
        max-width:none;overflow:visible;text-overflow:unset;
        user-select:none;display:none;
      }
      .pw-ref-highlight {
        outline:1.5px solid rgba(220,38,38,0.5)!important;outline-offset:1px;
      }
      .pw-ref-highlight.pw-ref-focused {
        outline:3px solid rgba(220,38,38,0.9)!important;outline-offset:2px;
      }
      .pw-ref-highlight.pw-ref-dimmed {
        outline-color:transparent!important;
      }
      .pw-ref-badge.pw-ref-dimmed {
        opacity:0!important;pointer-events:none!important;
      }
      .pw-ref-tooltip {
        position:fixed;top:10px;left:50%;transform:translateX(-50%);
        background:rgba(22,163,74,0.95);color:#fff;padding:8px 16px;
        border-radius:8px;font-family:monospace;font-size:13px;font-weight:bold;
        z-index:1000001;pointer-events:none;
        box-shadow:0 4px 12px rgba(0,0,0,0.3);
        animation: pw-fade 1.5s ease-out forwards;
      }
      @keyframes pw-fade {
        0%{opacity:1;transform:translateX(-50%) translateY(0)}
        70%{opacity:1}
        100%{opacity:0;transform:translateX(-50%) translateY(-10px)}
      }
    \`;
    document.head.appendChild(style);

    const getUniqueSelector = (el) => {
      if (el.id) return el.tagName.toLowerCase() + '#' + el.id;

      const path = [];
      let current = el;
      while (current && current !== document.body && current !== document.documentElement) {
        const tag = current.tagName.toLowerCase();

        if (current.id) {
          path.unshift(tag + '#' + current.id);
          break;
        }

        const parent = current.parentElement;
        if (!parent) break;

        const cls = Array.from(current.classList)
          .filter(c => !c.startsWith('pw-ref-'))
          .slice(0, 2).map(c => '.' + c).join('');

        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        const part = siblings.length > 1
          ? tag + cls + ':nth-of-type(' + (Array.from(parent.children).filter(c => c.tagName === current.tagName).indexOf(current) + 1) + ')'
          : tag + cls;

        path.unshift(part);

        const testSelector = path.join(' > ');
        try {
          if (document.querySelectorAll(testSelector).length === 1) return testSelector;
        } catch(e) {}

        current = parent;
      }
      return path.join(' > ');
    };

    const getShortUniqueSelector = (el) => {
      const tag = el.tagName.toLowerCase();
      const cls = Array.from(el.classList)
        .filter(c => !c.startsWith('pw-ref-'))
        .slice(0, 2).map(c => '.' + c).join('');

      if (el.id) return tag + '#' + el.id;

      const base = tag + cls;
      try {
        if (document.querySelectorAll(base).length === 1) return base;
      } catch(e) {}

      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
        const nthIdx = siblings.indexOf(el) + 1;
        const withNth = siblings.length > 1 ? base + ':nth-of-type(' + nthIdx + ')' : base;
        try {
          if (document.querySelectorAll(withNth).length === 1) return withNth;
        } catch(e) {}

        const pTag = parent.tagName.toLowerCase();
        const pId = parent.id ? '#' + parent.id : '';
        const pCls = pId ? '' : Array.from(parent.classList)
          .filter(c => !c.startsWith('pw-ref-'))
          .slice(0, 2).map(c => '.' + c).join('');
        const parentSel = pTag + pId + pCls;

        const grandParent = parent.parentElement;
        const parentWithNth = grandParent
          ? (() => {
              const pSiblings = Array.from(grandParent.children).filter(c => c.tagName === parent.tagName);
              return pSiblings.length > 1
                ? parentSel + ':nth-of-type(' + (pSiblings.indexOf(parent) + 1) + ')'
                : parentSel;
            })()
          : parentSel;

        return parentWithNth + ' > ' + withNth;
      }

      return base;
    };

    const sels = 'div,a[href],button,input,select,textarea,[role=button],[role=link],[role=tab],[role=menuitem]';
    let idx = 1;

    document.querySelectorAll(sels).forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;

      const tag = el.tagName.toLowerCase();

      let extra = '';
      if (tag === 'a') {
        const href = el.getAttribute('href') || '';
        extra = href ? ' → ' + href : '';
      } else if (tag === 'input') {
        const t = el.type || 'text';
        const ph = el.placeholder ? ' "' + el.placeholder + '"' : '';
        extra = ' [' + t + ph + ']';
      } else if (tag === 'textarea') {
        const ph = el.placeholder ? ' "' + el.placeholder + '"' : '';
        extra = ' [textarea' + ph + ']';
      }

      const aria = el.getAttribute('aria-label');
      const ariaStr = aria ? ' @"' + aria + '"' : '';

      const shortUniqueSelector = getShortUniqueSelector(el);
      const labelText = 'e' + idx + ' ' + shortUniqueSelector + extra + ariaStr;
      const copyStr = getUniqueSelector(el);
      const refId = 'pw-ref-' + idx;

      const badge = document.createElement('div');
      badge.className = 'pw-ref-badge';
      badge.textContent = 'e' + idx;
      badge.dataset.refId = refId;
      badge.style.left = (rect.left + window.scrollX - 8) + 'px';
      badge.style.top = (rect.top + window.scrollY - 8) + 'px';
      document.body.appendChild(badge);

      el.classList.add('pw-ref-highlight');

      const labelLeft = rect.left + window.scrollX - 8;
      const labelTop = (rect.top + window.scrollY - 28 < window.scrollY)
        ? rect.top + window.scrollY + 14
        : rect.top + window.scrollY - 28;

      const label = document.createElement('div');
      label.className = 'pw-ref-overlay';
      label.textContent = labelText;
      label.style.left = labelLeft + 'px';
      label.style.top = labelTop + 'px';
      label.dataset.refId = refId;
      label.dataset.selector = copyStr;
      document.body.appendChild(label);

      badge.addEventListener('mouseenter', () => {
        document.querySelectorAll('.pw-ref-highlight').forEach(e => e.classList.add('pw-ref-dimmed'));
        el.classList.remove('pw-ref-dimmed');
        el.classList.add('pw-ref-focused');
        document.querySelectorAll('.pw-ref-badge').forEach(b => b.classList.add('pw-ref-dimmed'));
        badge.classList.remove('pw-ref-dimmed');
        label.style.display = 'block';
      });

      badge.addEventListener('mouseleave', () => {
        document.querySelectorAll('.pw-ref-dimmed').forEach(e => e.classList.remove('pw-ref-dimmed'));
        el.classList.remove('pw-ref-focused');
        label.style.display = 'none';
      });

      badge.addEventListener('click', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        navigator.clipboard.writeText(copyStr).then(() => {
          badge.classList.add('pw-copied');
          const old = document.querySelector('.pw-ref-tooltip');
          if (old) old.remove();
          const toast = document.createElement('div');
          toast.className = 'pw-ref-tooltip';
          toast.textContent = 'Copied: ' + copyStr;
          document.body.appendChild(toast);
          setTimeout(() => { badge.classList.remove('pw-copied'); }, 800);
          setTimeout(() => { toast.remove(); }, 1500);
        });
      });

      idx++;
    });
    return idx - 1;
  });
}`;

/**
 * Playwright snippet that captures a full-page screenshot of the visualized page.
 */
const REFERENCE_SCREENSHOT_CODE = `async page => {
  await page.screenshot({ path: '${VISUAL_SCREENSHOT_PATH}', fullPage: true });
}`;

/**
 * Visualize every element on the currently open page: inject numbered badges
 * (e1, e2, ...) + selector labels + click-to-copy, then take a full-page
 * screenshot. Best-effort — any failure is logged, never thrown.
 *
 * Requires an active `playwright-cli` session on the page you want to inspect.
 */
export const visualizePageReferences = async (
  _config: BrowserConfig,
): Promise<void> => {
  try {
    const chrome = await detectChrome();
    if (!chrome.found || !chrome.path) {
      log('Chrome을 찾을 수 없습니다', 'error');
      return;
    }

    log('페이지 요소를 시각화 중입니다 (자동 스크롤 + 라벨 오버레이)...', 'info');
    await execFileCommand('playwright-cli', ['run-code', REFERENCE_OVERLAY_CODE]);

    log('전체 페이지 스크린샷을 촬영 중입니다...', 'info');
    await execFileCommand('playwright-cli', [
      'run-code',
      REFERENCE_SCREENSHOT_CODE,
    ]);

    log(`📸 스크린샷 저장: ${VISUAL_SCREENSHOT_PATH}`, 'success');
    log(
      '라벨(e1, e2, e3...)을 클릭하면 CSS 셀렉터가 클립보드에 복사됩니다',
      'info',
    );
    log('✅ 시각화 완료', 'success');
  } catch (error) {
    log(
      `시각화 중 오류: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  }
};
