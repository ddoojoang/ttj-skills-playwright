/**
 * TTJ Browser - Browser manager (install, launch, update check)
 */
import type { BrowserConfig, VersionInfo, ExistingBrowser } from './types.js';
/**
 * Install playwright-cli globally via npm.
 */
export declare const installPlaywrightCli: () => Promise<void>;
/**
 * Detect an already-running TTJ browser: a Chrome process that exposes a
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
/**
 * Auto-update to the latest version when one is available.
 * Best-effort: any failure is swallowed so the user keeps the current version.
 */
export declare const autoUpdateIfNeeded: () => Promise<void>;
/**
 * Verify that the browser is ready by polling three signals in parallel:
 *  - playwright-cli is resolvable
 *  - Chrome / Chromium is resolvable
 *  - the debugging port is occupied (browser is listening on it)
 * Each check retries at 100ms intervals for up to 10 attempts.
 */
export declare const verifyBrowserReady: (config: BrowserConfig) => Promise<boolean>;
/**
 * Visualize every element on the currently open page: inject numbered badges
 * (e1, e2, ...) + selector labels + click-to-copy, then take a full-page
 * screenshot. Best-effort — any failure is logged, never thrown.
 *
 * Requires an active `playwright-cli` session on the page you want to inspect.
 */
export declare const visualizePageReferences: (_config: BrowserConfig) => Promise<void>;
//# sourceMappingURL=browser.d.ts.map