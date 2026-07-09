/**
 * TTJ Browser - Browser manager (install, launch, update check)
 */
import type { BrowserConfig, VersionInfo } from './types.js';
/**
 * Install playwright-cli globally via npm.
 */
export declare const installPlaywrightCli: () => Promise<void>;
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
//# sourceMappingURL=browser.d.ts.map