/**
 * TTJ Browser - Utility functions (pure where possible)
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
 * Resolve the TTJ browser profile path per platform:
 *  - Windows: %APPDATA%\ttj-browser
 *  - macOS / Linux: ~/.ttj-browser
 */
export declare const getProfilePath: () => string;
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
//# sourceMappingURL=utils.d.ts.map