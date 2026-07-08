/**
 * TTJ Browser - Detection logic (playwright-cli, Chrome, profile)
 */

import path from 'path';
import { mkdir } from 'fs/promises';
import { getOsType, execCommand, firstExistingPath } from './utils.js';
import type { DetectionResult, OS } from './types.js';

/**
 * Attempt to resolve a command, swallowing failures into an empty string.
 */
const tryResolve = async (cmd: string): Promise<string> => {
  try {
    const result = await execCommand(cmd);
    return result.split('\n')[0]?.trim() ?? '';
  } catch {
    return '';
  }
};

/**
 * Build the OS-specific "locate a binary" command.
 */
const locateCommand = (osType: OS, binary: string): string =>
  osType === 'windows' ? `where ${binary}` : `which ${binary}`;

/**
 * Detect the globally installed playwright-cli binary.
 */
export const detectPlaywrightCli = async (): Promise<DetectionResult> => {
  const osType = getOsType();
  const detected = await tryResolve(locateCommand(osType, 'playwright-cli'));
  return detected
    ? { found: true, path: detected }
    : { found: false };
};

/**
 * macOS Chrome detection: spotlight first, then the default app path.
 */
const detectChromeMacos = async (): Promise<DetectionResult> => {
  const fallback =
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const spotlight = await tryResolve('mdfind -name "Google Chrome.app"');
  const spotlightBinary = spotlight
    ? path.join(spotlight, 'Contents', 'MacOS', 'Google Chrome')
    : '';
  const resolved = spotlightBinary || fallback;
  return { found: true, path: resolved };
};

/**
 * Linux Chrome detection: google-chrome, then chromium.
 */
const detectChromeLinux = async (): Promise<DetectionResult> => {
  const chrome = await tryResolve('which google-chrome');
  const chromium = chrome ? '' : await tryResolve('which chromium');
  const resolved = chrome || chromium;
  return resolved ? { found: true, path: resolved } : { found: false };
};

/**
 * Windows Chrome detection: chrome.exe, then chromium.exe.
 */
const detectChromeWindows = async (): Promise<DetectionResult> => {
  const chrome = await tryResolve('where chrome.exe');
  const chromium = chrome ? '' : await tryResolve('where chromium.exe');

  // Chrome 설치 폴더는 보통 PATH에 없어서 `where`가 놓침 — 표준 경로 폴백
  const fallback =
    chrome || chromium
      ? ''
      : await firstExistingPath([
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          path.join(
            process.env.LOCALAPPDATA ?? '',
            'Google',
            'Chrome',
            'Application',
            'chrome.exe',
          ),
        ]);

  const resolved = chrome || chromium || fallback;
  return resolved ? { found: true, path: resolved } : { found: false };
};

/**
 * Detect an installed Chrome / Chromium binary for the current platform.
 */
export const detectChrome = async (): Promise<DetectionResult> => {
  const osType = getOsType();
  return osType === 'macos'
    ? detectChromeMacos()
    : osType === 'windows'
      ? detectChromeWindows()
      : detectChromeLinux();
};

/**
 * Ensure the browser profile directory exists (idempotent).
 */
export const ensureProfile = async (profilePath: string): Promise<void> => {
  await mkdir(profilePath, { recursive: true });
};
