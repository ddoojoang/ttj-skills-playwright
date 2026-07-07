/**
 * TTJ Browser - Type definitions
 */

export type OS = 'macos' | 'linux' | 'windows';

export type LogType = 'info' | 'success' | 'warning' | 'error';

export interface BrowserConfig {
  port: number;
  profilePath: string;
}

export interface DetectionResult {
  found: boolean;
  path?: string;
}

export interface VersionInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
}
