/**
 * TTJ Browser - Browser manager (install, launch, update check)
 */
import { spawn } from 'child_process';
import { execCommand, getVersionFromPackageJson, getLatestVersionFromNpm, } from './utils.js';
const START_URL = 'https://www.google.com';
/**
 * Install playwright-cli globally via npm.
 */
export const installPlaywrightCli = async () => {
    await execCommand('npm install -g playwright-cli');
};
/**
 * Build the argument list for launching playwright-cli.
 */
const buildLaunchArgs = (config) => [
    'open',
    '--headed',
    `--remote-debugging-port=${config.port}`,
    `--profile=${config.profilePath}`,
    START_URL,
];
/**
 * Launch the browser through playwright-cli as a detached child process.
 */
export const launchBrowser = (config) => new Promise((resolve, reject) => {
    const child = spawn('playwright-cli', buildLaunchArgs(config), {
        stdio: 'ignore',
        detached: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
        child.unref();
        resolve();
    });
});
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
//# sourceMappingURL=browser.js.map