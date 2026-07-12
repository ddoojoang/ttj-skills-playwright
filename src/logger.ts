/**
 * ttj-skills-browser - Logging (side-effect isolated)
 */

import chalk from 'chalk';
import type { LogType } from './types.js';

const iconMap: Record<LogType, string> = {
  info: '🔧',
  success: '✅',
  warning: '⚠️',
  error: '🚫',
};

const colorMap: Record<LogType, (text: string) => string> = {
  info: chalk.cyan,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
};

const formatMessage = (message: string, type: LogType): string =>
  `${iconMap[type]}  ${colorMap[type](message)}`;

// Diagnostics go to stderr so stdout stays parseable data (e.g. crawl JSON).
export const log = (message: string, type: LogType = 'info'): void => {
  console.error(formatMessage(message, type));
};
