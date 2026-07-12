/**
 * ttj-skills-playwright - Browser manager (install, launch, update check)
 */
import type { BrowserConfig, VersionInfo, ExistingBrowser } from './types.js';
/**
 * Detect an already-running ttj-skills-playwright: a Chrome process that exposes a
 * remote-debugging port AND uses our expected profile directory.
 * Fast (single `ps`/CIM call) and best-effort — any error yields { found: false }.
 */
export declare const detectExistingBrowser: (expectedProfilePath: string) => Promise<ExistingBrowser>;
/**
 * Bring the running Chrome window to the foreground, per platform.
 * Best-effort — the browser is already alive, so any failure is ignored.
 */
export declare const bringWindowToFront: (pid: number) => Promise<void>;
/**
 * Launch Chrome directly as a detached child process.
 * Chrome natively supports --remote-debugging-port, so we skip playwright-cli.
 */
export declare const launchBrowser: (config: BrowserConfig) => Promise<void>;
/**
 * Check for updates by comparing local vs npm-published versions.
 */
export declare const checkForUpdates: () => Promise<VersionInfo>;
export declare const autoUpdateIfNeeded: () => Promise<void>;
/**
 * Verify that the browser is ready by polling two signals in parallel:
 *  - Chrome / Chromium is resolvable
 *  - the debugging port is occupied (browser is listening on it)
 * Each check retries at 100ms intervals for up to 10 attempts.
 */
export declare const verifyBrowserReady: (config: BrowserConfig) => Promise<boolean>;
/**
 * Visualize every element on the currently open page: connect directly over
 * CDP to the running browser, inject numbered badges (e1, e2, ...) + hover
 * selector labels + click-to-copy into the active tab, then take a full-page
 * screenshot. Best-effort — any failure is logged, never thrown.
 */
export declare const visualizePageReferences: (config: BrowserConfig) => Promise<void>;
/**
 * Detect crawlable repeating structures on the current page, badge each
 * top-level container (e1 ×N), print the analysis as JSON to stdout, and
 * save a full-page screenshot. Best-effort — failures are logged only.
 */
export declare const visualizeCrawlTargets: (config: BrowserConfig) => Promise<void>;
//# sourceMappingURL=browser.d.ts.map