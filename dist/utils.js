/**
 * TTJ Browser - Utility functions (pure where possible)
 */
import os from 'os';
import path from 'path';
import net from 'net';
import https from 'https';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
const execAsync = promisify(exec);
const PACKAGE_NAME = 'ttj-browser';
const NPM_REGISTRY = 'https://registry.npmjs.org';
/**
 * Detect the current operating system in a platform-agnostic way.
 */
export const getOsType = () => process.platform === 'win32'
    ? 'windows'
    : process.platform === 'darwin'
        ? 'macos'
        : 'linux';
/**
 * Return the current user's home directory (never hardcode a username).
 */
export const getHomeDir = () => os.homedir();
/**
 * Resolve the TTJ browser profile path per platform:
 *  - Windows: %APPDATA%\ttj-skills-browser
 *  - macOS / Linux: ~/.ttj-skills-browser
 */
export const getProfilePath = () => {
    const isWindows = getOsType() === 'windows';
    const appData = process.env.APPDATA;
    const base = isWindows && appData ? appData : getHomeDir();
    const folderName = isWindows ? 'ttj-skills-browser' : '.ttj-skills-browser';
    return path.join(base, folderName);
};
/**
 * Execute a shell command and return trimmed stdout.
 */
export const execCommand = async (cmd) => {
    const { stdout } = await execAsync(cmd);
    return stdout.trim();
};
/**
 * Read the current version from this package's package.json.
 */
export const getVersionFromPackageJson = async () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.join(currentDir, '..', 'package.json');
    const raw = await readFile(pkgPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed.version ?? '0.0.0';
};
/**
 * Fetch a URL and resolve the parsed JSON body (pure HTTPS helper).
 */
const fetchJson = (url) => new Promise((resolve, reject) => {
    https
        .get(url, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
            }
            catch (error) {
                reject(error);
            }
        });
    })
        .on('error', reject);
});
/**
 * Query the npm registry for the latest published version.
 */
export const getLatestVersionFromNpm = async () => {
    const data = await fetchJson(`${NPM_REGISTRY}/${PACKAGE_NAME}/latest`);
    const version = data.version;
    return typeof version === 'string' ? version : '0.0.0';
};
/**
 * Check whether a TCP port is available for binding.
 */
export const checkPortAvailable = (port) => new Promise((resolve) => {
    const tester = net
        .createServer()
        .once('error', () => resolve(false))
        .once('listening', () => {
        tester.close(() => resolve(true));
    })
        .listen(port, '127.0.0.1');
});
/**
 * Find the first available port starting at `startPort` (default 9227).
 */
export const findAvailablePort = async (startPort = 9227) => {
    const available = await checkPortAvailable(startPort);
    return available ? startPort : findAvailablePort(startPort + 1);
};
//# sourceMappingURL=utils.js.map