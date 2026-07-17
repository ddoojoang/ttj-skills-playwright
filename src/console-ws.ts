/**
 * ttj-skills-playwright - Console message collection (`console` command).
 *
 * One-shot constraint: CDP only delivers console events from enable-time
 * forward, BUT Chrome buffers recent console messages and REPLAYS them as
 * `Runtime.consoleAPICalled` / `Log.entryAdded` events right after
 * `Runtime.enable` / `Log.enable`. So the default run connects, enables both
 * domains, collects the replay burst (short grace window), and prints.
 * `--watch N` keeps the socket open N more seconds for live messages.
 */

import { getActiveTarget } from './cdp.js';
import { hasNativeWebSocket, withTargetWs } from './cdp-ws.js';

const REPLAY_GRACE_MS = 600;
const MAX_LINES = 200;

interface RemoteValue {
  type?: string;
  value?: unknown;
  description?: string;
}

interface ConsoleEventParams {
  type?: string;
  args?: RemoteValue[];
  stackTrace?: { callFrames?: Array<{ url?: string; lineNumber?: number }> };
  exceptionDetails?: {
    text?: string;
    exception?: { description?: string };
    url?: string;
    lineNumber?: number;
  };
  entry?: {
    level?: string;
    text?: string;
    url?: string;
    lineNumber?: number;
  };
}

const previewArg = (arg: RemoteValue): string =>
  arg.type === 'string'
    ? String(arg.value)
    : arg.value !== undefined
      ? JSON.stringify(arg.value)
      : (arg.description ?? String(arg.type ?? ''));

const sourceSuffix = (url?: string, line?: number): string =>
  url ? `  (${url}:${(line ?? 0) + 1})` : '';

const formatConsoleCall = (params: ConsoleEventParams): string => {
  const frame = params.stackTrace?.callFrames?.[0];
  const message = (params.args ?? []).map(previewArg).join(' ');
  return `[${params.type ?? 'log'}] ${message}${sourceSuffix(frame?.url, frame?.lineNumber)}`;
};

const formatException = (params: ConsoleEventParams): string => {
  const details = params.exceptionDetails;
  const message =
    details?.exception?.description ?? details?.text ?? 'uncaught exception';
  return `[error] ${message}${sourceSuffix(details?.url, details?.lineNumber)}`;
};

const formatLogEntry = (params: ConsoleEventParams): string => {
  const entry = params.entry;
  return `[${entry?.level ?? 'log'}] ${entry?.text ?? ''}${sourceSuffix(entry?.url, entry?.lineNumber)}`;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Collect console messages from the active tab: the buffered replay burst,
 * plus `watchSeconds` of live messages when requested. Returns formatted
 * lines, capped to the last MAX_LINES.
 */
export const collectConsole = async (
  port: number,
  watchSeconds: number,
): Promise<readonly string[]> => {
  if (!hasNativeWebSocket()) {
    throw new Error(
      'The console command needs Node 22+ (native WebSocket). Upgrade Node to use it.',
    );
  }
  const target = await getActiveTarget(port);
  if (!target?.wsUrl) {
    throw new Error('No open page found. Open a page in the browser first.');
  }
  const watchMs = Math.max(0, watchSeconds) * 1000;
  return withTargetWs(
    target.wsUrl,
    async (send, events) => {
      // Collector state: rebuilt immutably by event handlers while we sleep.
      const state = { collected: [] as readonly string[] };
      const push = (line: string): void => {
        state.collected = [...state.collected, line];
      };
      // Runtime.consoleAPICalled and Log.entryAdded overlap for console.*
      // calls — Log delivers them as duplicated entries. Prefer Runtime for
      // console calls; keep Log for network/browser-source messages only.
      events.on('Runtime.consoleAPICalled', (params) =>
        push(formatConsoleCall(params as ConsoleEventParams)),
      );
      events.on('Runtime.exceptionThrown', (params) =>
        push(formatException(params as ConsoleEventParams)),
      );
      events.on('Log.entryAdded', (params) => {
        const entry = (params as ConsoleEventParams).entry;
        if (entry && entry.url !== undefined) {
          push(formatLogEntry(params as ConsoleEventParams));
        }
      });
      await send('Runtime.enable');
      await send('Log.enable').catch(() => undefined);
      await sleep(REPLAY_GRACE_MS + watchMs);
      return state.collected.slice(-MAX_LINES);
    },
    REPLAY_GRACE_MS + watchMs + 10_000,
  );
};
