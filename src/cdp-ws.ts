/**
 * ttj-skills-playwright - Raw CDP WebSocket helpers (no playwright).
 *
 * Evaluate-class work (visualize / analyze / eval / clear) targets EXACTLY
 * one tab — the most-recently-used content tab — over that tab's own
 * webSocketDebuggerUrl. Unlike playwright's connectOverCDP (which attaches to
 * every tab and can stall for its 180s protocol timeout when any tab hangs),
 * this path cannot touch the wrong tab and fails fast with a clear error.
 *
 * Requires Node's global WebSocket (Node 22+). Callers must check
 * `hasNativeWebSocket()` and fall back to the playwright path when absent.
 */

/** Minimal structural type for the WHATWG WebSocket we use (no DOM lib). */
interface WsLike {
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  addEventListener: (
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ) => void;
  removeEventListener: (
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ) => void;
  send: (data: string) => void;
  close: () => void;
}

type WsCtor = new (url: string) => WsLike;

const getWebSocketCtor = (): WsCtor | undefined =>
  (globalThis as Record<string, unknown>).WebSocket as WsCtor | undefined;

/** True when Node exposes a native WebSocket client (Node 22+). */
export const hasNativeWebSocket = (): boolean =>
  getWebSocketCtor() !== undefined;

const WS_CONNECT_ERROR_PREFIX = 'CDP WebSocket connect:';

/** True when `error` is a connection-level failure (safe to fall back). */
export const isWsConnectError = (error: unknown): boolean =>
  error instanceof Error && error.message.startsWith(WS_CONNECT_ERROR_PREFIX);

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  error?: { message?: string };
  result?: {
    exceptionDetails?: {
      text?: string;
      exception?: { description?: string };
    };
  } & Record<string, unknown>;
}

/** A bound sender: issues one CDP command and resolves with its result. */
export type CdpSend = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/** Subscribe to CDP events (id-less frames) on the same target socket. */
export interface CdpEvents {
  readonly on: (
    method: string,
    handler: (params: Record<string, unknown>) => void,
  ) => void;
}

const openWs = (wsUrl: string): Promise<WsLike> =>
  new Promise((resolve, reject) => {
    const Ctor = getWebSocketCtor();
    if (!Ctor) {
      reject(new Error(`${WS_CONNECT_ERROR_PREFIX} no native WebSocket`));
      return;
    }
    const ws = new Ctor(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`${WS_CONNECT_ERROR_PREFIX} open timeout (3s)`));
    }, 3000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`${WS_CONNECT_ERROR_PREFIX} connection failed`));
    };
  });

interface PendingCommand {
  readonly method: string;
  readonly resolve: (result: Record<string, unknown>) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Open a WebSocket to one CDP target, hand `fn` a command sender plus an
 * event subscriber, then close. Every command gets a hard `timeoutMs` so a
 * stuck page can never hold the CLI for minutes — it fails with a readable
 * error instead. One socket listener dispatches both command replies (frames
 * with an `id`) and protocol events (id-less frames) to their handlers.
 */
export const withTargetWs = async <T>(
  wsUrl: string,
  fn: (send: CdpSend, events: CdpEvents) => Promise<T>,
  timeoutMs: number = 30_000,
): Promise<T> => {
  const ws = await openWs(wsUrl);
  const nextId = { value: 0 };
  const pending = new Map<number, PendingCommand>();
  const eventHandlers = new Map<
    string,
    ReadonlyArray<(params: Record<string, unknown>) => void>
  >();

  const onMessage = (event: { data: unknown }): void => {
    const message = JSON.parse(String(event.data)) as CdpMessage;
    if (message.id !== undefined) {
      const command = pending.get(message.id);
      if (!command) return;
      pending.delete(message.id);
      clearTimeout(command.timer);
      if (message.error) {
        command.reject(
          new Error(`CDP ${command.method}: ${message.error.message ?? 'error'}`),
        );
        return;
      }
      const exception = message.result?.exceptionDetails;
      if (exception) {
        command.reject(
          new Error(
            exception.exception?.description ??
              exception.text ??
              'evaluate threw',
          ),
        );
        return;
      }
      command.resolve(message.result ?? {});
      return;
    }
    if (message.method !== undefined) {
      (eventHandlers.get(message.method) ?? []).forEach((handler) =>
        handler(message.params ?? {}),
      );
    }
  };
  ws.addEventListener('message', onMessage);

  const send: CdpSend = (method, params = {}) => {
    nextId.value += 1;
    const id = nextId.value;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP ${method} timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { method, resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  const events: CdpEvents = {
    on: (method, handler) => {
      eventHandlers.set(method, [
        ...(eventHandlers.get(method) ?? []),
        handler,
      ]);
    },
  };
  try {
    return await fn(send, events);
  } finally {
    ws.removeEventListener('message', onMessage);
    pending.forEach((command) => clearTimeout(command.timer));
    ws.close();
  }
};

interface EvaluateResult {
  result?: { type?: string; value?: unknown };
}

/**
 * Evaluate a JS expression through an already-open `send`. Playwright-parity:
 * when the expression evaluates to a function (a function-source string like
 * "() => ..."), it is invoked and the call's result is returned instead —
 * decided by the runtime type CDP reports, not by guessing at the source
 * text (IIFE-safe). Shared by one-shot evaluate and the batch runner.
 */
export const evaluateViaSend = async (
  send: CdpSend,
  expression: string,
): Promise<unknown> => {
  const first = (await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as EvaluateResult;
  if (first.result?.type !== 'function') return first.result?.value;
  const invoked = (await send('Runtime.evaluate', {
    expression: `(${expression})()`,
    returnByValue: true,
    awaitPromise: true,
  })) as EvaluateResult;
  return invoked.result?.value;
};

/**
 * Run a JS expression in the target's page (awaits promises) and return its
 * serialized value over the target's own WebSocket.
 */
export const evaluateOverWs = (
  wsUrl: string,
  expression: string,
  timeoutMs: number = 30_000,
): Promise<unknown> =>
  withTargetWs(wsUrl, (send) => evaluateViaSend(send, expression), timeoutMs);
