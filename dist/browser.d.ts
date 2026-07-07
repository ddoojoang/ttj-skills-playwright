/**
 * TTJ Browser - Browser manager (install, launch, update check)
 */
import type { BrowserConfig, VersionInfo } from './types.js';
/**
 * Install playwright-cli globally via npm.
 */
export declare const installPlaywrightCli: () => Promise<void>;
/**
 * Launch the browser through playwright-cli as a detached child process.
 */
export declare const launchBrowser: (config: BrowserConfig) => Promise<void>;
/**
 * Check for updates by comparing local vs npm-published versions.
 */
export declare const checkForUpdates: () => Promise<VersionInfo>;
//# sourceMappingURL=browser.d.ts.map