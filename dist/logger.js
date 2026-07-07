/**
 * TTJ Browser - Logging (side-effect isolated)
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
export const log = (message, type = 'info') => {
    console.log(formatMessage(message, type));
};
//# sourceMappingURL=logger.js.map