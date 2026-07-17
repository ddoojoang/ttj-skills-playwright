/**
 * ttj-skills-playwright - WS-direct input actions (click / fill / press).
 *
 * Acts on the active tab over its own CDP WebSocket — no playwright load, no
 * attach to other tabs, hard timeouts. Targets are either a snapshot ref
 * (e5 → backendDOMNodeId from refmap.ts) or a CSS selector (DOM.querySelector
 * with a 10s existence poll, parity with the playwright path).
 *
 * click = real trusted mouse events at the element's center coordinates
 * (topmost element at that point receives it, same as a human click).
 * fill  = focus → select-all → Input.insertText: instant, fires a trusted
 * `input` event (React-safe), but NO per-key keydown/keyup — keystroke-
 * sensitive sites should use `type` (human-delay path) instead.
 */

import { getActiveTarget } from './cdp.js';
import { withTargetWs, type CdpSend } from './cdp-ws.js';
import {
  isRefToken,
  loadRefEntry,
  resolveRefToBackendId,
  staleRefError,
  type RefMapEntry,
} from './refmap.js';

export type ActionTarget =
  | { readonly kind: 'ref'; readonly ref: string }
  | { readonly kind: 'selector'; readonly selector: string };

/** `e5` → ref target; anything else → CSS selector target. */
export const parseActionTarget = (arg: string): ActionTarget =>
  isRefToken(arg) ? { kind: 'ref', ref: arg } : { kind: 'selector', selector: arg };

const describeTarget = (target: ActionTarget): string =>
  target.kind === 'ref' ? target.ref : target.selector;

/** CDP node handle: snapshot refs carry backendNodeId, selectors nodeId. */
type NodeHandle =
  | { readonly backendNodeId: number }
  | { readonly nodeId: number };

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const SELECTOR_WAIT_MS = 10_000;
const SELECTOR_POLL_MS = 100;

const pollSelector = async (
  send: CdpSend,
  selector: string,
  deadline: number,
  totalMs: number,
): Promise<NodeHandle> => {
  // Re-fetch the document root each poll — navigation replaces it.
  const doc = await send('DOM.getDocument', { depth: 0 });
  const rootId = (doc.root as { nodeId: number }).nodeId;
  const found = await send('DOM.querySelector', { nodeId: rootId, selector });
  const nodeId = Number(found.nodeId ?? 0);
  if (nodeId > 0) return { nodeId };
  if (Date.now() >= deadline) {
    throw new Error(
      `Element not found: ${selector} (waited ${totalMs / 1000}s)`,
    );
  }
  await sleep(SELECTOR_POLL_MS);
  return pollSelector(send, selector, deadline, totalMs);
};

/**
 * Resolve an action target to a CDP node handle through an open `send`.
 * Refs enforce refmap staleness rules against the tab's current URL.
 */
export const resolveNodeViaSend = async (
  send: CdpSend,
  target: ActionTarget,
  refEntry: RefMapEntry | undefined,
  currentUrl: string,
): Promise<NodeHandle> => {
  if (target.kind === 'ref') {
    // DOM.getDocument initializes the DOM agent so backendNodeId ops work.
    await send('DOM.getDocument', { depth: 0 });
    return {
      backendNodeId: resolveRefToBackendId(refEntry, target.ref, currentUrl),
    };
  }
  return pollSelector(
    send,
    target.selector,
    Date.now() + SELECTOR_WAIT_MS,
    SELECTOR_WAIT_MS,
  );
};

/** Map CDP "node gone" errors on ref actions to the agent-readable message. */
const translateNodeError = (error: unknown, target: ActionTarget): Error => {
  const message = error instanceof Error ? error.message : String(error);
  return target.kind === 'ref' &&
    /no node|could not find node|node with given id|not.*valid node/i.test(
      message,
    )
    ? staleRefError(target.ref)
    : error instanceof Error
      ? error
      : new Error(message);
};

const quadCenter = (
  quad: readonly number[],
): { readonly x: number; readonly y: number } => ({
  x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
  y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4,
});

const nodeCenter = async (
  send: CdpSend,
  handle: NodeHandle,
  label: string,
): Promise<{ readonly x: number; readonly y: number }> => {
  const quadsResult: Record<string, unknown> = await send(
    'DOM.getContentQuads',
    handle,
  ).catch(() => ({}));
  const quad = (quadsResult.quads as number[][] | undefined)?.[0];
  if (quad && quad.length === 8) return quadCenter(quad);
  const boxResult: Record<string, unknown> = await send(
    'DOM.getBoxModel',
    handle,
  ).catch(() => ({}));
  const content = (boxResult.model as { content?: number[] } | undefined)
    ?.content;
  if (content && content.length === 8) return quadCenter(content);
  throw new Error(`Element is not visible (zero-size or hidden): ${label}`);
};

/**
 * Click a resolved node: scroll it into view, then dispatch real trusted
 * mouse events (moved → pressed → released) at its center.
 */
export const clickNodeViaSend = async (
  send: CdpSend,
  handle: NodeHandle,
  label: string,
): Promise<void> => {
  await send('DOM.scrollIntoViewIfNeeded', handle).catch(() => undefined);
  const { x, y } = await nodeCenter(send, handle, label);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1,
    pointerType: 'mouse',
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
    pointerType: 'mouse',
  });
};

/** Select-all inside the focused element (input/textarea or contenteditable). */
const SELECT_ALL_FN = `function() {
  if (typeof this.select === 'function') { this.select(); return; }
  const range = document.createRange();
  range.selectNodeContents(this);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}`;

/**
 * Fill a resolved node instantly (playwright-parity): focus → select-all →
 * `Input.insertText` (trusted input event, React controlled-input safe).
 * Empty text clears the field via a Delete key press.
 */
export const fillNodeViaSend = async (
  send: CdpSend,
  handle: NodeHandle,
  text: string,
): Promise<void> => {
  await send('DOM.scrollIntoViewIfNeeded', handle).catch(() => undefined);
  await send('DOM.focus', handle);
  const resolved = await send('DOM.resolveNode', handle);
  const objectId = (resolved.object as { objectId?: string } | undefined)
    ?.objectId;
  if (objectId) {
    await send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: SELECT_ALL_FN,
    });
  }
  if (text === '') {
    await pressKeyViaSend(send, 'Delete');
    return;
  }
  await send('Input.insertText', { text });
};

interface KeyDef {
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly text?: string;
}

const KEY_DEFS: Readonly<Record<string, KeyDef>> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
};

const keyDefFor = (key: string): KeyDef | undefined =>
  KEY_DEFS[key] ??
  (key.length === 1
    ? {
        key,
        code: `Key${key.toUpperCase()}`,
        keyCode: key.toUpperCase().charCodeAt(0),
        text: key,
      }
    : undefined);

/**
 * Press a keyboard key (keyDown + keyUp) on the focused element.
 * Named keys (Enter, Tab, arrows, …) or any single printable character.
 */
export const pressKeyViaSend = async (
  send: CdpSend,
  key: string,
): Promise<void> => {
  const def = keyDefFor(key);
  if (!def) {
    throw new Error(
      `Unsupported key "${key}". Supported: ${Object.keys(KEY_DEFS).join(', ')}, or a single character.`,
    );
  }
  const base = {
    key: def.key,
    code: def.code,
    windowsVirtualKeyCode: def.keyCode,
    nativeVirtualKeyCode: def.keyCode,
  };
  await send('Input.dispatchKeyEvent', {
    ...base,
    type: def.text !== undefined ? 'keyDown' : 'rawKeyDown',
    ...(def.text !== undefined ? { text: def.text } : {}),
  });
  await send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
};

/** Poll until a selector exists in the document (batch `wait` step). */
export const waitForSelectorViaSend = async (
  send: CdpSend,
  selector: string,
  timeoutMs: number,
): Promise<void> => {
  await pollSelector(send, selector, Date.now() + timeoutMs, timeoutMs);
};

const ACTION_WS_TIMEOUT_MS = 15_000;

/**
 * Open the active tab's WS, load its ref map, hand `fn` the pieces.
 */
const withActiveTabAction = async <T>(
  port: number,
  fn: (
    send: CdpSend,
    refEntry: RefMapEntry | undefined,
    currentUrl: string,
  ) => Promise<T>,
): Promise<T> => {
  const target = await getActiveTarget(port);
  if (!target?.wsUrl) {
    throw new Error('No open page found. Open a page in the browser first.');
  }
  const refEntry = await loadRefEntry(target.id);
  return withTargetWs(
    target.wsUrl,
    (send) => fn(send, refEntry, target.url),
    ACTION_WS_TIMEOUT_MS,
  );
};

/** One-shot WS click on a ref or CSS selector in the active tab. */
export const clickInActiveTabWs = (
  port: number,
  target: ActionTarget,
): Promise<void> =>
  withActiveTabAction(port, async (send, refEntry, url) => {
    const handle = await resolveNodeViaSend(send, target, refEntry, url);
    await clickNodeViaSend(send, handle, describeTarget(target)).catch(
      (error) => {
        throw translateNodeError(error, target);
      },
    );
  });

/** One-shot WS fill (instant, trusted input) on a ref or CSS selector. */
export const fillInActiveTabWs = (
  port: number,
  target: ActionTarget,
  text: string,
): Promise<void> =>
  withActiveTabAction(port, async (send, refEntry, url) => {
    const handle = await resolveNodeViaSend(send, target, refEntry, url);
    await fillNodeViaSend(send, handle, text).catch((error) => {
      throw translateNodeError(error, target);
    });
  });

/** One-shot WS key press on the active tab's focused element. */
export const pressInActiveTabWs = (port: number, key: string): Promise<void> =>
  withActiveTabAction(port, (send) => pressKeyViaSend(send, key));
