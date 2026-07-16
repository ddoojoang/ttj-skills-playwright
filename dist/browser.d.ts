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
 * NON-BLOCKING: the focus command runs detached in the background so browser
 * detection/reuse never waits on osascript/PowerShell startup (~0.3–1.5s).
 * `pid` is optional: macOS activates by app name (no pid needed);
 * Windows/Linux need a pid, so without one we skip silently.
 */
export declare const bringWindowToFront: (pid?: number) => void;
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
 * selector labels + click-to-copy into the active tab, then take a
 * screenshot. Best-effort — any failure is logged, never thrown.
 *
 * FAST by default: boxes render immediately — no auto-scroll and NO
 * screenshot (speed is the point; the user reads the boxes on screen, clicks
 * a badge to copy its selector, and asks to crawl just that part). Pass
 * `options.full` to auto-scroll first (triggers lazy-loaded content) and
 * capture a full-page screenshot — the old, slower behavior.
 */
export declare const visualizePageReferences: (config: BrowserConfig, options?: {
    readonly full?: boolean;
}) => Promise<void>;
//# sourceMappingURL=browser.d.ts.map