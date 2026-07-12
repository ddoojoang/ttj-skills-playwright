/**
 * ttj-skills-playwright - Browser manager (install, launch, update check)
 */
import { spawn } from 'child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execCommand, getVersionFromPackageJson, getLatestVersionFromNpm, checkPortAvailable, getOsType, getProfilePath, } from './utils.js';
import { detectChrome } from './detector.js';
import { log } from './logger.js';
import { withActivePage } from './cdp.js';
const START_URL = 'https://www.google.com';
const VISUAL_SCREENSHOT_PATH = path.join(tmpdir(), 'ttj-refs-visual.png');
const RETRY_INTERVAL_MS = 100;
const RETRY_MAX_ATTEMPTS = 10;
/**
 * Parse the `--remote-debugging-port=NNNN` value from a process command line.
 */
const parseDebugPort = (cmdline) => {
    const match = cmdline.match(/--remote-debugging-port=(\d+)/);
    return match ? Number.parseInt(match[1], 10) : undefined;
};
/**
 * Turn one raw process entry (pid + command line) into an ExistingBrowser hit,
 * but only when it is a Chrome CDP process bound to our expected profile.
 */
const toBrowserHit = (pid, cmdline, expectedProfilePath) => {
    if (!cmdline.includes('--remote-debugging-port='))
        return undefined;
    if (!cmdline.includes(expectedProfilePath))
        return undefined;
    const port = parseDebugPort(cmdline);
    return port !== undefined ? { found: true, port, pid } : undefined;
};
/**
 * macOS / Linux: list processes as "PID<space>COMMAND" lines, then pick the
 * Chrome CDP process whose --user-data-dir is our profile.
 */
const detectExistingBrowserUnix = async (expectedProfilePath) => {
    const output = await execCommand('ps -ax -o pid=,command=');
    const hit = output
        .split('\n')
        .map((line) => line.trim())
        .map((line) => {
        const pidMatch = line.match(/^(\d+)\s+(.*)$/);
        return pidMatch
            ? toBrowserHit(Number.parseInt(pidMatch[1], 10), pidMatch[2], expectedProfilePath)
            : undefined;
    })
        .find((entry) => entry !== undefined);
    return hit ?? { found: false };
};
/**
 * Windows: enumerate chrome.exe processes via PowerShell/CIM, emitting
 * "PID|||COMMANDLINE" lines, then match our profile.
 */
const detectExistingBrowserWindows = async (expectedProfilePath) => {
    const output = await execCommand('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name=\'chrome.exe\'\\" | ForEach-Object { \\"$($_.ProcessId)|||$($_.CommandLine)\\" }"');
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
export const detectExistingBrowser = async (expectedProfilePath) => {
    try {
        return getOsType() === 'windows'
            ? await detectExistingBrowserWindows(expectedProfilePath)
            : await detectExistingBrowserUnix(expectedProfilePath);
    }
    catch {
        return { found: false };
    }
};
/**
 * Bring the running Chrome window to the foreground, per platform.
 * Best-effort — the browser is already alive, so any failure is ignored.
 */
export const bringWindowToFront = async (pid) => {
    const osType = getOsType();
    try {
        if (osType === 'macos') {
            await execCommand('osascript -e \'tell application "Google Chrome" to activate\'');
            return;
        }
        if (osType === 'windows') {
            await execCommand(`powershell -NoProfile -Command "$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne 0) { Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class TtjWin { [DllImport(\\"user32.dll\\")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport(\\"user32.dll\\")] public static extern bool ShowWindow(IntPtr h, int c); }'; [TtjWin]::ShowWindow($p.MainWindowHandle, 9) | Out-Null; [TtjWin]::SetForegroundWindow($p.MainWindowHandle) | Out-Null }"`);
            return;
        }
        await execCommand(`wmctrl -i -a $(xdotool search --pid ${pid} | head -1)`);
    }
    catch {
        // Window focusing failure is ignored; the browser is already running.
    }
};
/**
 * Build the argument list for launching Chrome directly (native flags).
 */
const buildLaunchArgs = (config) => [
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
export const launchBrowser = async (config) => {
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
const isNewer = (latest, current) => {
    const toParts = (v) => v.split('.').map((part) => Number.parseInt(part, 10) || 0);
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
export const checkForUpdates = async () => {
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
const readLastUpdateCheck = async (stampPath) => {
    try {
        const raw = await readFile(stampPath, 'utf-8');
        const parsed = Number(raw.trim());
        return Number.isFinite(parsed) ? parsed : 0;
    }
    catch {
        return 0;
    }
};
export const autoUpdateIfNeeded = async () => {
    try {
        // Throttle: hit the npm registry at most once a day so every other
        // launch starts instantly.
        const profilePath = getProfilePath();
        const stampPath = path.join(profilePath, '.last-update-check');
        const lastChecked = await readLastUpdateCheck(stampPath);
        if (Date.now() - lastChecked < UPDATE_CHECK_INTERVAL_MS)
            return;
        await mkdir(profilePath, { recursive: true });
        await writeFile(stampPath, String(Date.now()), 'utf-8');
        const versionInfo = await checkForUpdates();
        if (versionInfo.hasUpdate) {
            log(`업데이트 중... (${versionInfo.current} → ${versionInfo.latest})`, 'info');
            await execCommand('npm install -g ttj-skills-playwright@latest');
            log(`✅ 최신버전이 있어서 업데이트했습니다 (${versionInfo.current} → ${versionInfo.latest})`, 'success');
        }
    }
    catch {
        // Update failure is ignored; the user continues on the current version.
    }
};
/**
 * Pause execution for `ms` milliseconds (non-blocking).
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Retry an async boolean check by polling: run `check`, and on a falsy result
 * wait `RETRY_INTERVAL_MS` and try again, up to `RETRY_MAX_ATTEMPTS` times.
 * Declarative recursion — no loops, no mutation.
 */
const retryCheck = async (check, attemptsLeft = RETRY_MAX_ATTEMPTS) => {
    const passed = await check();
    if (passed)
        return true;
    if (attemptsLeft <= 1)
        return false;
    await sleep(RETRY_INTERVAL_MS);
    return retryCheck(check, attemptsLeft - 1);
};
/**
 * Verify that the browser is ready by polling two signals in parallel:
 *  - Chrome / Chromium is resolvable
 *  - the debugging port is occupied (browser is listening on it)
 * Each check retries at 100ms intervals for up to 10 attempts.
 */
export const verifyBrowserReady = async (config) => {
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
        position:absolute;min-width:18px;height:18px;padding:0 3px;border-radius:9px;
        background:rgba(37,99,235,0.95);color:#fff;font-size:9px;font-weight:bold;
        display:flex;align-items:center;justify-content:center;
        z-index:999999;pointer-events:auto;cursor:pointer;font-family:monospace;
        box-shadow:0 1px 3px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.5);
        line-height:1;transition:transform 0.1s;
      }
      .pw-ref-badge.pw-ref-region {
        background:rgba(220,38,38,0.97);border-radius:4px;height:20px;font-size:10px;
        z-index:1000000;
      }
      .pw-ref-badge:hover { transform:scale(1.25); }
      .pw-ref-badge.pw-copied { background:rgba(22,163,74,0.95)!important; }
      .pw-ref-overlay {
        position:absolute;background:rgba(37,99,235,0.95);color:#fff;
        font-size:10px;font-weight:bold;padding:2px 5px;border-radius:4px;
        z-index:1000002;pointer-events:none;
        font-family:monospace;line-height:14px;white-space:nowrap;
        box-shadow:0 2px 6px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.3);
        max-width:none;overflow:visible;text-overflow:unset;
        user-select:none;display:none;
      }
      .pw-ref-overlay.pw-ref-region { background:rgba(220,38,38,0.97); }
      /* Detail elements: thin blue outline */
      .pw-ref-highlight {
        outline:1.5px solid rgba(37,99,235,0.45)!important;outline-offset:1px;
      }
      .pw-ref-highlight.pw-ref-focused {
        outline:3px solid rgba(37,99,235,0.95)!important;outline-offset:2px;
      }
      /* Region elements: bolder red outline */
      .pw-ref-region-outline {
        outline:2px solid rgba(220,38,38,0.55)!important;outline-offset:-1px;
      }
      .pw-ref-highlight.pw-ref-dimmed, .pw-ref-region-outline.pw-ref-dimmed {
        outline-color:transparent!important;
      }
      .pw-ref-badge.pw-ref-dimmed {
        opacity:0!important;pointer-events:none!important;
      }
      /* Filled translucent box shown when hovering a region badge — always
         visible even for very large regions (fixes hard-to-see red box). */
      .pw-ref-region-fill {
        position:absolute;z-index:999998;pointer-events:none;display:none;
        background:rgba(220,38,38,0.14);
        border:3px solid rgba(220,38,38,0.95);
        box-shadow:0 0 0 2px rgba(255,255,255,0.5) inset;
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

    const INTERACTIVE = new Set(['a', 'button', 'input', 'select', 'textarea']);
    const REGION_TAGS = new Set(['section','header','footer','nav','main','aside','article','form','ul','ol']);
    const hasDirectText = (node) =>
      Array.from(node.childNodes).some(
        c => c.nodeType === 3 && c.textContent.trim().length > 0,
      );
    const isVisibleBox = (node, style) =>
      hasDirectText(node) ||
      node.querySelector('img,svg,video,canvas,picture') !== null ||
      (style.backgroundImage && style.backgroundImage !== 'none') ||
      (style.borderTopWidth !== '0px' && style.borderStyle !== 'none') ||
      (style.boxShadow && style.boxShadow !== 'none');
    const docW = document.documentElement.clientWidth;
    // True if the element is scrolled/clipped out of an overflow ancestor
    // (e.g. off-screen items of a horizontal carousel).
    const isClipped = (el, r) => {
      let p = el.parentElement;
      while (p && p !== document.body) {
        const ps = window.getComputedStyle(p);
        if (/(hidden|scroll|auto|clip)/.test(ps.overflow + ps.overflowX + ps.overflowY)) {
          const pr = p.getBoundingClientRect();
          if (r.right <= pr.left + 1 || r.left >= pr.right - 1 ||
              r.bottom <= pr.top + 1 || r.top >= pr.bottom - 1) return true;
        }
        p = p.parentElement;
      }
      return false;
    };
    const onScreenVisible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return false;
      if (r.right <= 0 || r.bottom <= 0 || r.left < -1000) return false;
      if (r.left >= docW) return false;                 // off to the right of the layout
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      if (cs.clipPath && cs.clipPath.includes('inset(50%)')) return false;
      if (cs.clip === 'rect(0px, 0px, 0px, 0px)') return false;
      if (isClipped(el, r)) return false;
      return true;
    };

    const pageArea = Math.max(1, document.documentElement.scrollWidth * document.documentElement.scrollHeight);

    // ---- Tier 1: top-most parent REGIONS (red) — the big-picture blocks ----
    const regionCandidates = Array.from(document.querySelectorAll('body *')).filter(el => {
      if (!onScreenVisible(el)) return false;
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area < 45000) return false;              // too small to be a section
      if (area / pageArea > 0.55) return false;    // page-wide wrapper, not a region
      const childEls = el.children.length;
      return REGION_TAGS.has(el.tagName.toLowerCase()) || childEls >= 4;
    });
    // Keep only top-most (a region nested inside another region is dropped).
    const regions = regionCandidates
      .filter(el => !regionCandidates.some(o => o !== el && o.contains(el)))
      .sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return (rb.width * rb.height) - (ra.width * ra.height);
      })
      .slice(0, 16);
    const regionSet = new Set(regions);

    let ridx = 1;
    let didx = 1;

    // Shared marker builder. kind = 'region' | 'detail'.
    const mark = (el, kind) => {
      const rect = el.getBoundingClientRect();
      const isRegion = kind === 'region';
      const ref = (isRegion ? 'R' : 'e') + (isRegion ? ridx : didx);
      const refId = 'pw-ref-' + ref;
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
      const labelText = ref + ' ' + getShortUniqueSelector(el) + extra + ariaStr;
      const copyStr = getUniqueSelector(el);

      const badge = document.createElement('div');
      badge.className = 'pw-ref-badge' + (isRegion ? ' pw-ref-region' : '');
      badge.textContent = ref;
      badge.dataset.refId = refId;
      badge.style.left = (rect.left + window.scrollX) + 'px';
      badge.style.top = (rect.top + window.scrollY) + 'px';
      document.body.appendChild(badge);

      el.classList.add(isRegion ? 'pw-ref-region-outline' : 'pw-ref-highlight');

      const label = document.createElement('div');
      label.className = 'pw-ref-overlay' + (isRegion ? ' pw-ref-region' : '');
      label.textContent = labelText;
      label.style.left = (rect.left + window.scrollX) + 'px';
      label.style.top = ((rect.top + window.scrollY - 22 < window.scrollY)
        ? rect.top + window.scrollY + 20
        : rect.top + window.scrollY - 20) + 'px';
      document.body.appendChild(label);

      // Region hover: show a filled translucent box so even huge regions are
      // clearly visible (thin outlines on big regions are easy to miss).
      let fill = null;
      if (isRegion) {
        fill = document.createElement('div');
        fill.className = 'pw-ref-region-fill';
        fill.style.left = (rect.left + window.scrollX) + 'px';
        fill.style.top = (rect.top + window.scrollY) + 'px';
        fill.style.width = rect.width + 'px';
        fill.style.height = rect.height + 'px';
        document.body.appendChild(fill);
      }

      badge.addEventListener('mouseenter', () => {
        document.querySelectorAll('.pw-ref-highlight,.pw-ref-region-outline').forEach(e => e.classList.add('pw-ref-dimmed'));
        el.classList.remove('pw-ref-dimmed');
        el.classList.add('pw-ref-focused');
        document.querySelectorAll('.pw-ref-badge').forEach(b => b.classList.add('pw-ref-dimmed'));
        badge.classList.remove('pw-ref-dimmed');
        label.style.display = 'block';
        if (fill) fill.style.display = 'block';
      });
      badge.addEventListener('mouseleave', () => {
        document.querySelectorAll('.pw-ref-dimmed').forEach(e => e.classList.remove('pw-ref-dimmed'));
        el.classList.remove('pw-ref-focused');
        label.style.display = 'none';
        if (fill) fill.style.display = 'none';
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

      if (isRegion) ridx++; else didx++;
    };

    // Region rectangles (document coords) — a detail must sit inside one of
    // these, so carousel items scrolled out into the margin are excluded.
    const regionRects = regions.map(el => {
      const r = el.getBoundingClientRect();
      return { left: r.left + window.scrollX, top: r.top + window.scrollY,
               right: r.right + window.scrollX, bottom: r.bottom + window.scrollY };
    });
    const centerInsideRegion = (r) => {
      const cx = r.left + window.scrollX + r.width / 2;
      const cy = r.top + window.scrollY + r.height / 2;
      return regionRects.some(q => cx >= q.left && cx <= q.right && cy >= q.top && cy <= q.bottom);
    };

    regions.forEach(el => mark(el, 'region'));

    // ---- Tier 2: DETAIL elements inside the regions (blue) ----
    const sels = 'div,span,a[href],button,input,select,textarea,[role=button],[role=link],[role=tab],[role=menuitem]';
    document.querySelectorAll(sels).forEach(el => {
      if (regionSet.has(el)) return;              // regions are tier 1
      if (!onScreenVisible(el)) return;
      if (regionRects.length && !centerInsideRegion(el.getBoundingClientRect())) return;
      const tag = el.tagName.toLowerCase();
      const cs = window.getComputedStyle(el);
      const interactive = INTERACTIVE.has(tag) || el.hasAttribute('role');
      if (!interactive && !isVisibleBox(el, cs)) return;
      mark(el, 'detail');
    });

    return { regions: ridx - 1, details: didx - 1 };
  }`;
/**
 * Visualize every element on the currently open page: connect directly over
 * CDP to the running browser, inject numbered badges (e1, e2, ...) + hover
 * selector labels + click-to-copy into the active tab, then take a full-page
 * screenshot. Best-effort — any failure is logged, never thrown.
 */
export const visualizePageReferences = async (config) => {
    try {
        log('Connecting to the running browser over CDP...', 'info');
        await withActivePage(config.port, async (page) => {
            log('페이지 요소를 시각화 중입니다 (자동 스크롤 + 라벨 오버레이)...', 'info');
            // evaluate(string) runs an expression — wrap as IIFE so the function
            // strings are actually invoked (and their promises awaited).
            await page.evaluate(`(${AUTO_SCROLL_JS})()`);
            await page.evaluate(`(${OVERLAY_JS})()`);
            log('Capturing full-page screenshot...', 'info');
            await page.screenshot({ path: VISUAL_SCREENSHOT_PATH, fullPage: true });
        });
        log(`📸 Screenshot saved: ${VISUAL_SCREENSHOT_PATH}`, 'success');
        log('Click a badge (e1, e2, e3...) to copy its CSS selector to the clipboard', 'info');
        log('✅ Visualization complete', 'success');
    }
    catch (error) {
        log(`Visualization error: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
};
//# sourceMappingURL=browser.js.map