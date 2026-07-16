/**
 * ttj-skills-playwright - Utility functions (pure where possible)
 */

import os from 'os';
import path from 'path';
import net from 'net';
import http from 'http';
import https from 'https';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, access } from 'fs/promises';
import { fileURLToPath } from 'url';
import type { OS } from './types.js';

const execAsync = promisify(exec);

const PACKAGE_NAME = 'ttj-skills-playwright';
const NPM_REGISTRY = 'https://registry.npmjs.org';

/**
 * Detect the current operating system in a platform-agnostic way.
 */
export const getOsType = (): OS =>
  process.platform === 'win32'
    ? 'windows'
    : process.platform === 'darwin'
      ? 'macos'
      : 'linux';

/**
 * Return the current user's home directory (never hardcode a username).
 */
export const getHomeDir = (): string => os.homedir();

/**
 * Resolve the ttj-skills-playwright profile path per platform:
 *  - Windows: %APPDATA%\ttj-skills-playwright
 *  - macOS / Linux: ~/.ttj-skills-playwright
 */
export const getProfilePath = (): string => {
  const isWindows = getOsType() === 'windows';
  const appData = process.env.APPDATA;
  const base =
    isWindows && appData ? appData : getHomeDir();
  const folderName = isWindows ? 'ttj-skills-playwright' : '.ttj-skills-playwright';
  return path.join(base, folderName);
};

/**
 * Return the first path in `candidates` that exists on disk, or '' if none do.
 * Declarative recursion — no loops, no mutation.
 */
export const firstExistingPath = async (
  candidates: string[],
): Promise<string> => {
  const [head, ...rest] = candidates;
  if (!head) return '';
  try {
    await access(head);
    return head;
  } catch {
    return firstExistingPath(rest);
  }
};

/**
 * Execute a shell command and return trimmed stdout.
 */
export const execCommand = async (cmd: string): Promise<string> => {
  const { stdout } = await execAsync(cmd);
  return stdout.trim();
};

/**
 * Read the current version from this package's package.json.
 */
export const getVersionFromPackageJson = async (): Promise<string> => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.join(currentDir, '..', 'package.json');
  const raw = await readFile(pkgPath, 'utf-8');
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version ?? '0.0.0';
};

/**
 * Fetch a URL and resolve the parsed JSON body (pure HTTPS helper).
 * Hard timeout so a slow/unreachable registry can never stall the CLI.
 */
const fetchJson = (
  url: string,
  timeoutMs: number = 1500,
): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const req = https
      .get(url, { timeout: timeoutMs }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`fetchJson timeout after ${timeoutMs}ms: ${url}`));
    });
  });

/**
 * Query the npm registry for the latest published version.
 */
export const getLatestVersionFromNpm = async (): Promise<string> => {
  const data = await fetchJson(`${NPM_REGISTRY}/${PACKAGE_NAME}/latest`);
  const version = data.version;
  return typeof version === 'string' ? version : '0.0.0';
};

/**
 * Check whether a TCP port is available for binding.
 */
export const checkPortAvailable = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
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
export const findAvailablePort = async (
  startPort: number = 9227,
): Promise<number> => {
  const available = await checkPortAvailable(startPort);
  return available ? startPort : findAvailablePort(startPort + 1);
};

/**
 * Probe a local port for a live CDP endpoint (`/json/version` responds).
 * Resolves true only when a Chrome DevTools Protocol server answers there.
 */
export const isCdpResponding = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/json/version', timeout: 300 },
      (res) => {
        const ok = res.statusCode === 200;
        res.resume();
        resolve(ok);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });

/**
 * Find a running CDP browser by probing ports startPort..startPort+span.
 * Returns the lowest responding port, or undefined if none respond. This lets
 * subcommands reuse an already-open browser even when process detection fails,
 * WITHOUT launching a new instance or start tab.
 *
 * All ports are probed IN PARALLEL (localhost GETs are cheap), so the whole
 * scan is bounded by a single probe timeout instead of timeout × port count.
 */
export const findRunningCdpPort = async (
  startPort: number = 9227,
  span: number = 10,
): Promise<number | undefined> => {
  const ports = Array.from({ length: span + 1 }, (_, i) => startPort + i);
  const results = await Promise.all(
    ports.map(async (port) => ((await isCdpResponding(port)) ? port : undefined)),
  );
  return results.find((port) => port !== undefined);
};
