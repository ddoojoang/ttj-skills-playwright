/**
 * ttj-skills-playwright - Detection logic (Chrome, profile)
 */
import type { DetectionResult } from './types.js';
/**
 * Detect an installed Chrome / Chromium binary for the current platform.
 */
export declare const detectChrome: () => Promise<DetectionResult>;
/**
 * Ensure the browser profile directory exists (idempotent).
 */
export declare const ensureProfile: (profilePath: string) => Promise<void>;
//# sourceMappingURL=detector.d.ts.map