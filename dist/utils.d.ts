/**
 * ttj-skills-playwright - Utility functions (pure where possible)
 */
import type { OS } from './types.js';
/**
 * Detect the current operating system in a platform-agnostic way.
 */
export declare const getOsType: () => OS;
/**
 * Return the current user's home directory (never hardcode a username).
 */
export declare const getHomeDir: () => string;
/**
 * Resolve the ttj-skills-playwright profile path per platform:
 *  - Windows: %APPDATA%\ttj-skills-playwright
 *  - macOS / Linux: ~/.ttj-skills-playwright
 */
export declare const getProfilePath: () => string;
/**
 * Return the first path in `candidates` that exists on disk, or '' if none do.
 * Declarative recursion — no loops, no mutation.
 */
export declare const firstExistingPath: (candidates: string[]) => Promise<string>;
/**
 * Execute a shell command and return trimmed stdout.
 */
export declare const execCommand: (cmd: string) => Promise<string>;
/**
 * Read the current version from this package's package.json.
 */
export declare const getVersionFromPackageJson: () => Promise<string>;
/**
 * Query the npm registry for the latest published version.
 */
export declare const getLatestVersionFromNpm: () => Promise<string>;
/**
 * Check whether a TCP port is available for binding.
 */
export declare const checkPortAvailable: (port: number) => Promise<boolean>;
/**
 * Find the first available port starting at `startPort` (default 9227).
 */
export declare const findAvailablePort: (startPort?: number) => Promise<number>;
/**
 * Probe a local port for a live CDP endpoint (`/json/version` responds).
 * Resolves true only when a Chrome DevTools Protocol server answers there.
 */
export declare const isCdpResponding: (port: number) => Promise<boolean>;
/**
 * Find a running CDP browser by probing ports startPort..startPort+span.
 * Returns the first responding port, or undefined if none respond. This lets
 * subcommands reuse an already-open browser even when process detection fails,
 * WITHOUT launching a new instance or start tab.
 */
export declare const findRunningCdpPort: (startPort?: number, span?: number) => Promise<number | undefined>;
//# sourceMappingURL=utils.d.ts.map