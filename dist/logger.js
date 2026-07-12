/**
 * ttj-skills-playwright - Logging (side-effect isolated)
 */
import chalk from 'chalk';
const iconMap = {
    info: '🔧',
    success: '✅',
    warning: '⚠️',
    error: '🚫',
};
const colorMap = {
    info: chalk.cyan,
    success: chalk.green,
    warning: chalk.yellow,
    error: chalk.red,
};
const formatMessage = (message, type) => `${iconMap[type]}  ${colorMap[type](message)}`;
// Diagnostics go to stderr so stdout stays parseable data (e.g. crawl JSON).
export const log = (message, type = 'info') => {
    console.error(formatMessage(message, type));
};
//# sourceMappingURL=logger.js.map