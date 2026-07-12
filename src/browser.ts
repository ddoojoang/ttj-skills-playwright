/**
 * ttj-skills-playwright - Browser manager (install, launch, update check)
 */

import { spawn } from 'child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  execCommand,
  getVersionFromPackageJson,
  getLatestVersionFromNpm,
  checkPortAvailable,
  getOsType,
  getProfilePath,
} from './utils.js';
import { detectChrome } from './detector.js';
import { log } from './logger.js';
import { withActivePage } from './cdp.js';
import type { BrowserConfig, VersionInfo, ExistingBrowser } from './types.js';

const START_URL = 'https://www.google.com';

const VISUAL_SCREENSHOT_PATH = path.join(tmpdir(), 'ttj-refs-visual.png');

const RETRY_INTERVAL_MS = 100;
const RETRY_MAX_ATTEMPTS = 10;

/**
 * Parse the `--remote-debugging-port=NNNN` value from a process command line.
 */
const parseDebugPort = (cmdline: string): number | undefined => {
  const match = cmdline.match(/--remote-debugging-port=(\d+)/);
  return match ? Number.parseInt(match[1], 10) : undefined;
};

/**
 * Turn one raw process entry (pid + command line) into an ExistingBrowser hit,
 * but only when it is a Chrome CDP process bound to our expected profile.
 */
const toBrowserHit = (
  pid: number,
  cmdline: string,
  expectedProfilePath: string,
): ExistingBrowser | undefined => {
  if (!cmdline.includes('--remote-debugging-port=')) return undefined;
  if (!cmdline.includes(expectedProfilePath)) return undefined;
  const port = parseDebugPort(cmdline);
  return port !== undefined ? { found: true, port, pid } : undefined;
};

/**
 * macOS / Linux: list processes as "PID<space>COMMAND" lines, then pick the
 * Chrome CDP process whose --user-data-dir is our profile.
 */
const detectExistingBrowserUnix = async (
  expectedProfilePath: string,
): Promise<ExistingBrowser> => {
  const output = await execCommand('ps -ax -o pid=,command=');
  const hit = output
    .split('\n')
    .map((line) => line.trim())
    .map((line) => {
      const pidMatch = line.match(/^(\d+)\s+(.*)$/);
      return pidMatch
        ? toBrowserHit(
            Number.parseInt(pidMatch[1], 10),
            pidMatch[2],
            expectedProfilePath,
          )
        : undefined;
    })
    .find((entry) => entry !== undefined);
  return hit ?? { found: false };
};

/**
 * Windows: enumerate chrome.exe processes via PowerShell/CIM, emitting
 * "PID|||COMMANDLINE" lines, then match our profile.
 */
const detectExistingBrowserWindows = async (
  expectedProfilePath: string,
): Promise<ExistingBrowser> => {
  const output = await execCommand(
    'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name=\'chrome.exe\'\\" | ForEach-Object { \\"$($_.ProcessId)|||$($_.CommandLine)\\" }"',
  );
  const hit = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('|||'))
    .map((line) => {
      const [pidPart, ...rest] = line.split('|||');
      const pid = Number.parseInt(pidPart, 10);
      return Number.isNaN(pid)
        ? undefined
        : toBrowserHit(pid, rest.join('|||'), expectedProfilePath);
    })
    .find((entry) => entry !== undefined);
  return hit ?? { found: false };
};

/**
 * Detect an already-running ttj-skills-playwright: a Chrome process that exposes a
 * remote-debugging port AND uses our expected profile directory.
 * Fast (single `ps`/CIM call) and best-effort — any error yields { found: false }.
 */
export const detectExistingBrowser = async (
  expectedProfilePath: string,
): Promise<ExistingBrowser> => {
  try {
    return getOsType() === 'windows'
      ? await detectExistingBrowserWindows(expectedProfilePath)
      : await detectExistingBrowserUnix(expectedProfilePath);
  } catch {
    return { found: false };
  }
};

/**
 * Bring the running Chrome window to the foreground, per platform.
 * Best-effort — the browser is already alive, so any failure is ignored.
 */
export const bringWindowToFront = async (pid: number): Promise<void> => {
  const osType = getOsType();
  try {
    if (osType === 'macos') {
      await execCommand(
        'osascript -e \'tell application "Google Chrome" to activate\'',
      );
      return;
    }
    if (osType === 'windows') {
      await execCommand(
        `powershell -NoProfile -Command "$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne 0) { Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class TtjWin { [DllImport(\\"user32.dll\\")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport(\\"user32.dll\\")] public static extern bool ShowWindow(IntPtr h, int c); }'; [TtjWin]::ShowWindow($p.MainWindowHandle, 9) | Out-Null; [TtjWin]::SetForegroundWindow($p.MainWindowHandle) | Out-Null }"`,
      );
      return;
    }
    await execCommand(
      `wmctrl -i -a $(xdotool search --pid ${pid} | head -1)`,
    );
  } catch {
    // Window focusing failure is ignored; the browser is already running.
  }
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
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Side effect: read the epoch-ms timestamp of the last update check
 * (0 when the stamp file is missing or unreadable).
 */
const readLastUpdateCheck = async (stampPath: string): Promise<number> => {
  try {
    const raw = await readFile(stampPath, 'utf-8');
    const parsed = Number(raw.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
};

export const autoUpdateIfNeeded = async (): Promise<void> => {
  try {
    // Throttle: hit the npm registry at most once a day so every other
    // launch starts instantly.
    const profilePath = getProfilePath();
    const stampPath = path.join(profilePath, '.last-update-check');
    const lastChecked = await readLastUpdateCheck(stampPath);
    if (Date.now() - lastChecked < UPDATE_CHECK_INTERVAL_MS) return;

    await mkdir(profilePath, { recursive: true });
    await writeFile(stampPath, String(Date.now()), 'utf-8');

    const versionInfo = await checkForUpdates();
    if (versionInfo.hasUpdate) {
      log(
        `업데이트 중... (${versionInfo.current} → ${versionInfo.latest})`,
        'info',
      );
      await execCommand('npm install -g ttj-skills-playwright@latest');
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
 * Verify that the browser is ready by polling two signals in parallel:
 *  - Chrome / Chromium is resolvable
 *  - the debugging port is occupied (browser is listening on it)
 * Each check retries at 100ms intervals for up to 10 attempts.
 */
export const verifyBrowserReady = async (
  config: BrowserConfig,
): Promise<boolean> => {
  const [chromeReady, portOccupied] = await Promise.all([
    retryCheck(async () => (await detectChrome()).found === true),
    retryCheck(async () => (await checkPortAvailable(config.port)) === false),
  ]);
  return chromeReady && portOccupied;
};

/**
 * Injected page-side script (ported from the `bb 2` reference visualizer).
 * Runs inside `page.evaluate` over a direct CDP connection, so it is authored
 * in browser JavaScript (not project FP TypeScript). It:
 *  1. auto-scrolls to trigger lazy-loaded content,
 *  2. overlays numbered badges (e1, e2, ...) + selector labels on every visible
 *     div / interactive element,
 *  3. wires click-to-copy of a unique CSS selector to the clipboard.
 */
const AUTO_SCROLL_JS = `async () => {
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
  }`;

/**
 * Browser-context JS (injected as a string) that overlays numbered badges
 * (e1, e2, ...) + hover selector labels + click-to-copy on every visible
 * div / interactive element. Ported from the `bb 2` reference visualizer.
 */
const OVERLAY_JS = `() => {
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
      if (el.id) return el.tagName.toLowerCase() + '#' + CSS.escape(el.id);

      const path = [];
      let current = el;
      while (current && current !== document.body && current !== document.documentElement) {
        const tag = current.tagName.toLowerCase();

        if (current.id) {
          path.unshift(tag + '#' + CSS.escape(current.id));
          break;
        }

        const parent = current.parentElement;
        if (!parent) break;

        const cls = Array.from(current.classList)
          .filter(c => !c.startsWith('pw-ref-'))
          .slice(0, 2).map(c => '.' + CSS.escape(c)).join('');

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
        .slice(0, 2).map(c => '.' + CSS.escape(c)).join('');

      if (el.id) return tag + '#' + CSS.escape(el.id);

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
        const pId = parent.id ? '#' + CSS.escape(parent.id) : '';
        const pCls = pId ? '' : Array.from(parent.classList)
          .filter(c => !c.startsWith('pw-ref-'))
          .slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
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
  }`;

/**
 * Visualize every element on the currently open page: connect directly over
 * CDP to the running browser, inject numbered badges (e1, e2, ...) + hover
 * selector labels + click-to-copy into the active tab, then take a full-page
 * screenshot. Best-effort — any failure is logged, never thrown.
 */
export const visualizePageReferences = async (
  config: BrowserConfig,
): Promise<void> => {
  try {
    log('Connecting to the running browser over CDP...', 'info');
    await withActivePage(config.port, async (page) => {
      log(
        '페이지 요소를 시각화 중입니다 (자동 스크롤 + 라벨 오버레이)...',
        'info',
      );
      // evaluate(string) runs an expression — wrap as IIFE so the function
      // strings are actually invoked (and their promises awaited).
      await page.evaluate(`(${AUTO_SCROLL_JS})()`);
      await page.evaluate(`(${OVERLAY_JS})()`);

      log('Capturing full-page screenshot...', 'info');
      await page.screenshot({ path: VISUAL_SCREENSHOT_PATH, fullPage: true });
    });

    log(`📸 Screenshot saved: ${VISUAL_SCREENSHOT_PATH}`, 'success');
    log(
      '라벨(e1, e2, e3...)을 클릭하면 CSS 셀렉터가 클립보드에 복사됩니다',
      'info',
    );
    log('✅ Visualization complete', 'success');
  } catch (error) {
    log(
      `Visualization error: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  }
};

const CRAWL_SCREENSHOT_PATH = path.join(tmpdir(), 'ttj-crawl-visual.png');

/**
 * Injected page-side script that detects crawlable repeating structures
 * (lists of similar sibling elements) at their top-most container level,
 * badges each container (e1 ×N), and returns an analysis array. Reuses the
 * same .pw-ref-* classes as OVERLAY_JS so each visualization always clears
 * the previous one. Browser JavaScript, not project FP TypeScript.
 */
const CRAWL_SCAN_JS = `() => {
  document.querySelectorAll('.pw-ref-overlay,.pw-ref-style,.pw-ref-svg,.pw-ref-badge,.pw-ref-tooltip').forEach(e => e.remove());
  document.querySelectorAll('.pw-ref-highlight').forEach(e => e.classList.remove('pw-ref-highlight', 'pw-ref-focused', 'pw-ref-dimmed'));

  const style = document.createElement('style');
  style.className = 'pw-ref-style';
  style.textContent = \`
    .pw-ref-badge {
      position:absolute;background:rgba(220,38,38,0.95);color:#fff;
      font-family:monospace;font-size:12px;font-weight:bold;
      padding:3px 8px;border-radius:6px;z-index:999999;cursor:pointer;
      box-shadow:0 2px 6px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.5);
      transition:transform 0.1s;
    }
    .pw-ref-badge:hover { transform:scale(1.15);background:rgba(30,64,175,0.95); }
    .pw-ref-badge.pw-copied { background:rgba(22,163,74,0.95); }
    .pw-ref-badge.pw-ref-dimmed { opacity:0!important;pointer-events:none!important; }
    .pw-ref-badge-list { background:rgba(37,99,235,0.97); }
    .pw-ref-list { outline-color:rgba(37,99,235,0.9)!important; }
    .pw-ref-list.pw-ref-focused { outline-color:rgba(37,99,235,1)!important; }
    .pw-ref-overlay {
      position:absolute;background:rgba(220,38,38,0.92);color:#fff;
      font-size:10px;font-weight:bold;padding:2px 5px;border-radius:4px;
      z-index:999999;pointer-events:none;font-family:monospace;line-height:14px;
      white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.4);
      border:1px solid rgba(255,255,255,0.3);user-select:none;display:none;
    }
    .pw-ref-highlight { outline:3px solid rgba(220,38,38,0.9)!important;outline-offset:2px; }
    .pw-ref-highlight.pw-ref-focused { outline:4px solid rgba(220,38,38,1)!important;outline-offset:2px; }
    .pw-ref-highlight.pw-ref-dimmed { outline-color:transparent!important; }
    .pw-ref-tooltip {
      position:fixed;top:10px;left:50%;transform:translateX(-50%);
      background:rgba(22,163,74,0.95);color:#fff;padding:8px 16px;
      border-radius:8px;font-family:monospace;font-size:13px;font-weight:bold;
      z-index:1000001;pointer-events:none;
    }
  \`;
  document.head.appendChild(style);

  const cleanClasses = (el) => Array.from(el.classList).filter(c => !c.startsWith('pw-ref-'));

  const getUniqueSelector = (el) => {
    if (el.id) return el.tagName.toLowerCase() + '#' + CSS.escape(el.id);
    const path = [];
    let current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      const tag = current.tagName.toLowerCase();
      if (current.id) { path.unshift(tag + '#' + CSS.escape(current.id)); break; }
      const parent = current.parentElement;
      if (!parent) break;
      const cls = cleanClasses(current).slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
      const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
      const part = siblings.length > 1
        ? tag + cls + ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')'
        : tag + cls;
      path.unshift(part);
      try { if (document.querySelectorAll(path.join(' > ')).length === 1) return path.join(' > '); } catch (e) {}
      current = parent;
    }
    return path.join(' > ');
  };

  // Same eligibility as the detailed visualization (OVERLAY_JS)
  const sels = 'div,a[href],button,input,select,textarea,[role=button],[role=link],[role=tab],[role=menuitem]';
  const isEligible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return false;
    const cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  };

  // Collect the PARENT of every element the detailed visualization would badge
  const parents = [];
  const childCounts = new Map();
  document.querySelectorAll(sels).forEach(el => {
    if (!isEligible(el)) return;
    const parent = el.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) return;
    if (!childCounts.has(parent)) { parents.push(parent); childCounts.set(parent, 0); }
    childCounts.set(parent, childCounts.get(parent) + 1);
  });

  // A "region" = parent with 2+ eligible children, itself visible
  const candidates = parents.filter(p => childCounts.get(p) >= 2 && isEligible(p));

  // Drop page-wide wrappers (>60% of the document) — they are layout shells,
  // not crawlable sections.
  const docArea = Math.max(1, document.body.scrollWidth * document.body.scrollHeight);
  const sized = candidates.filter(p => {
    const r = p.getBoundingClientRect();
    return (r.width * r.height) / docArea <= 0.6;
  });

  // Top-most regions (layout columns), then peel ONE layer inside each to get
  // section-level areas. The final set is mutually non-nested, so boxes never
  // overlap and badges never stack at shared parent/child corners.
  const outermostWithin = (container) =>
    sized.filter(p => p !== container && container.contains(p) &&
      !sized.some(o => o !== p && o !== container && container.contains(o) && o.contains(p)));

  const sectionsOf = (container, depth) => {
    const subs = outermostWithin(container);
    if (subs.length === 0 || depth <= 0) return [container];
    if (subs.length === 1) return sectionsOf(subs[0], depth - 1);
    return subs;
  };

  const level1 = sized.filter(p => !sized.some(other => other !== p && other.contains(p)));
  const layoutRegions = level1.flatMap(l1 => sectionsOf(l1, 4));

  // AI-judged crawl targets: containers whose children repeat the same
  // tag+class signature (product cards, article lists, review rows...). These
  // are the highest-value crawl structures even if they are nested inside a
  // layout section, so detect them independently.
  const sigOf = (el) => el.tagName.toLowerCase() + cleanClasses(el).slice(0, 1).map(c => '.' + c).join('');
  const listRegions = [];
  document.querySelectorAll('body *').forEach(parent => {
    if (parent.children.length < 3 || parent.closest('svg')) return;
    if (!isEligible(parent)) return;
    const r = parent.getBoundingClientRect();
    if ((r.width * r.height) / docArea > 0.6) return;
    const groups = {};
    Array.from(parent.children).forEach(child => {
      const s = sigOf(child);
      (groups[s] = groups[s] || []).push(child);
    });
    const biggest = Object.values(groups).sort((a, b) => b.length - a.length)[0];
    if (biggest && biggest.filter(isEligible).length >= 3) listRegions.push(parent);
  });
  // Keep only the outermost repeating container per nest (a card's inner
  // repeating row shouldn't also be listed).
  const topLists = listRegions.filter(p => !listRegions.some(o => o !== p && o.contains(p)));

  // Merge: layout sections + list regions, de-duplicated (a list already
  // covered by an identical layout region is not added twice).
  const tagRegion = (el, type) => ({ el, type });
  const merged = [
    ...layoutRegions.map(el => tagRegion(el, 'section')),
    ...topLists.filter(l => !layoutRegions.includes(l)).map(el => tagRegion(el, 'list')),
  ];
  // Drop a section if a list region is its equal-or-outer duplicate area.
  const regionsTyped = merged.filter((m, _i, arr) =>
    !(m.type === 'section' && arr.some(o => o.type === 'list' && o.el === m.el)));

  return regionsTyped.map((entry, i) => {
    const region = entry.el;
    const isList = entry.type === 'list';
    const ref = 'e' + (i + 1);
    const rect = region.getBoundingClientRect();
    const count = childCounts.get(region) ?? region.children.length;
    const selector = getUniqueSelector(region);
    region.classList.add('pw-ref-highlight');
    if (isList) region.classList.add('pw-ref-list');

    const badge = document.createElement('div');
    badge.className = isList ? 'pw-ref-badge pw-ref-badge-list' : 'pw-ref-badge';
    badge.textContent = ref + (isList ? ' \\ud83d\\udd76 \\u00d7' : ' \\u00d7') + count;
    badge.style.left = Math.max(0, rect.left + window.scrollX) + 'px';
    badge.style.top = Math.max(0, rect.top + window.scrollY - 14) + 'px';
    document.body.appendChild(badge);

    const label = document.createElement('div');
    label.className = 'pw-ref-overlay';
    label.textContent = ref + ' ' + selector + ' (\\uc790\\uc2dd ' + count + '\\uac1c)';
    label.style.left = Math.max(0, rect.left + window.scrollX) + 'px';
    label.style.top = Math.max(0, rect.top + window.scrollY - 34) + 'px';
    document.body.appendChild(label);

    // Hover isolation: show only this box, dim every other box/badge
    badge.addEventListener('mouseenter', () => {
      document.querySelectorAll('.pw-ref-highlight').forEach(e => e.classList.add('pw-ref-dimmed'));
      region.classList.remove('pw-ref-dimmed');
      region.classList.add('pw-ref-focused');
      document.querySelectorAll('.pw-ref-badge').forEach(b => b.classList.add('pw-ref-dimmed'));
      badge.classList.remove('pw-ref-dimmed');
      label.style.display = 'block';
    });
    badge.addEventListener('mouseleave', () => {
      document.querySelectorAll('.pw-ref-dimmed').forEach(e => e.classList.remove('pw-ref-dimmed'));
      region.classList.remove('pw-ref-focused');
      label.style.display = 'none';
    });

    badge.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      navigator.clipboard.writeText(selector).then(() => {
        badge.classList.add('pw-copied');
        const old = document.querySelector('.pw-ref-tooltip');
        if (old) old.remove();
        const toast = document.createElement('div');
        toast.className = 'pw-ref-tooltip';
        toast.textContent = 'Copied: ' + selector;
        document.body.appendChild(toast);
        setTimeout(() => { badge.classList.remove('pw-copied'); }, 800);
        setTimeout(() => { toast.remove(); }, 1500);
      });
    });

    const text = (region.innerText || region.textContent || '').trim().replace(/\\s+/g, ' ');
    const links = region.querySelectorAll('a[href]').length;
    const images = region.querySelectorAll('img').length;
    const paras = region.querySelectorAll('p,h1,h2,h3,h4,time,span').length;
    const hasPrice = /[\\d,]+\\s*\\uc6d0|\\$\\s?[\\d,.]+|\\u20a9\\s?[\\d,]+/.test(text);
    const hasDate = /\\d{4}[.\\-\\/]\\s?\\d{1,2}[.\\-\\/]\\s?\\d{1,2}|\\d{1,2}:\\d{2}/.test(text);
    // Chars of text per repeated item: nav/menu items are short (~<12),
    // real content items (articles, cards) are long.
    const avgItemChars = Math.round(text.length / Math.max(1, count));
    // Nav/menu heuristic: every item is basically a short bare link, no media,
    // no date/price. These repeat a lot but hold no crawlable data.
    const looksLikeNav =
      isList && avgItemChars < 12 && images === 0 && !hasPrice && !hasDate;
    // Heuristic crawl-value score: repeating content lists with rich fields
    // rank highest; navigation menus are pushed to the bottom.
    const score =
      (isList ? 5 : 0) +
      Math.min(count, 6) +
      (images >= 2 ? 2 : 0) +
      (hasPrice ? 3 : 0) +
      (hasDate ? 2 : 0) +
      (avgItemChars >= 30 ? 2 : 0) +
      (paras >= count * 2 ? 1 : 0) +
      (looksLikeNav ? -10 : 0);
    return {
      ref,
      type: isList ? 'list' : 'section',
      container: selector,
      count,
      crawlScore: score,
      looksLikeNav,
      fields: { links, images, hasPrice, hasDate, avgItemChars },
      sample: text.slice(0, 80),
    };
  }).sort((a, b) => b.crawlScore - a.crawlScore);
}`;

/**
 * Detect crawlable repeating structures on the current page, badge each
 * top-level container (e1 ×N), print the analysis as JSON to stdout, and
 * save a full-page screenshot. Best-effort — failures are logged only.
 */
export const visualizeCrawlTargets = async (
  config: BrowserConfig,
): Promise<void> => {
  try {
    log('Connecting to the running browser over CDP...', 'info');
    const targets = await withActivePage(config.port, async (page) => {
      log(
        '크롤링 대상을 분석 중입니다 (자동 스크롤 + 반복 구조 탐지)...',
        'info',
      );
      await page.evaluate(`(${AUTO_SCROLL_JS})()`);
      const result = await page.evaluate(`(${CRAWL_SCAN_JS})()`);

      log('Capturing full-page screenshot...', 'info');
      await page.screenshot({ path: CRAWL_SCREENSHOT_PATH, fullPage: true });
      return result;
    });

    console.log(JSON.stringify(targets, null, 2));
    log(`📸 Screenshot saved: ${CRAWL_SCREENSHOT_PATH}`, 'success');
    log(
      '🔵 파란 배지(🕷)=반복 목록(크롤링 추천), 🔴 빨간 배지=레이아웃 영역. crawlScore 높은 순 정렬됨',
      'info',
    );
    log('Click a badge to copy its container selector', 'info');
    log('✅ Crawl-target analysis complete', 'success');
  } catch (error) {
    log(
      `Crawl-analysis error: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  }
};
