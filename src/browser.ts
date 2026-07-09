/**
 * TTJ Browser - Browser manager (install, launch, update check)
 */

import { spawn } from 'child_process';
import {
  execCommand,
  getVersionFromPackageJson,
  getLatestVersionFromNpm,
  checkPortAvailable,
} from './utils.js';
import { detectPlaywrightCli, detectChrome } from './detector.js';
import { log } from './logger.js';
import type { BrowserConfig, VersionInfo } from './types.js';

const START_URL = 'https://www.google.com';

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
