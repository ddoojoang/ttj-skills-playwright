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
  readonly shift: boolean;
  readonly text?: string;
}

/**
 * US-layout physical key table: printable char -> the exact event a real
 * keyboard produces for it. `type` and `press` share this one source of truth.
 *
 * Why it must exist: `char.charCodeAt(0)` is NOT a virtual key code. Deriving
 * keyCode that way emits impossible events — "." carried keyCode 46 (VK_DELETE)
 * and Chrome swallowed the character as a Delete keypress, "#" carried 35
 * (VK_END), "'" carried 39 (VK_RIGHT). Omitting `code` was equally impossible:
 * a hardware keystroke never reports code:"" (isTrusted stays true either way,
 * so code:"" is a pure automation signature). Shifted characters also need a
 * real Shift keydown/keyup around them, otherwise the page sees an uppercase
 * character arriving with shiftKey:false.
 */
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
/** Index = the digit key that produces this char with Shift held. */
const SHIFTED_DIGITS = ')!@#$%^&*(';

/** [unshifted, shifted, code, keyCode] for US-layout punctuation keys. */
const PUNCT_KEYS: ReadonlyArray<readonly [string, string, string, number]> = [
  [';', ':', 'Semicolon', 186],
  ['=', '+', 'Equal', 187],
  [',', '<', 'Comma', 188],
  ['-', '_', 'Minus', 189],
  ['.', '>', 'Period', 190],
  ['/', '?', 'Slash', 191],
  ['`', '~', 'Backquote', 192],
  ['[', '{', 'BracketLeft', 219],
  ['\\', '|', 'Backslash', 220],
  [']', '}', 'BracketRight', 221],
  ["'", '"', 'Quote', 222],
];

const charEntry = (
  char: string,
  code: string,
  keyCode: number,
  shift: boolean,
): readonly [string, KeyDef] => [
  char,
  { key: char, code, keyCode, shift, text: char },
];

/** Every printable ASCII character mapped to its physical key. */
const CHAR_KEYS: Readonly<Record<string, KeyDef>> = Object.fromEntries([
  ...[...LETTERS].map((c) =>
    charEntry(c, `Key${c.toUpperCase()}`, c.toUpperCase().charCodeAt(0), false),
  ),
  ...[...LETTERS].map((c) =>
    charEntry(
      c.toUpperCase(),
      `Key${c.toUpperCase()}`,
      c.toUpperCase().charCodeAt(0),
      true,
    ),
  ),
  ...[...DIGITS].map((d) => charEntry(d, `Digit${d}`, d.charCodeAt(0), false)),
  ...[...SHIFTED_DIGITS].map((c, i) =>
    charEntry(c, `Digit${DIGITS[i]}`, DIGITS[i].charCodeAt(0), true),
  ),
  ...PUNCT_KEYS.flatMap(([plain, shifted, code, keyCode]) => [
    charEntry(plain, code, keyCode, false),
    charEntry(shifted, code, keyCode, true),
  ]),
  charEntry(' ', 'Space', 32, false),
]);

const NAMED_KEYS: Readonly<Record<string, KeyDef>> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, shift: false, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9, shift: false },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27, shift: false },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8, shift: false },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46, shift: false },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, shift: false },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, shift: false },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, shift: false },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, shift: false },
  Home: { key: 'Home', code: 'Home', keyCode: 36, shift: false },
  End: { key: 'End', code: 'End', keyCode: 35, shift: false },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33, shift: false },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34, shift: false },
  Space: { key: ' ', code: 'Space', keyCode: 32, shift: false, text: ' ' },
};

const keyDefFor = (key: string): KeyDef | undefined =>
  NAMED_KEYS[key] ?? CHAR_KEYS[key];

/** CDP modifier bitmask bit for Shift. */
const SHIFT_MODIFIER = 8;
const SHIFT_EVENT = {
  key: 'Shift',
  code: 'ShiftLeft',
  windowsVirtualKeyCode: 16,
  nativeVirtualKeyCode: 16,
  location: 1,
};

/**
 * Dispatch one key as a human would: optional Shift down, the key itself
 * (keyDown carrying text so the character commits, rawKeyDown for non-text
 * keys), keyUp, then Shift up.
 */
const dispatchKeyDefViaSend = async (
  send: CdpSend,
  def: KeyDef,
): Promise<void> => {
  const modifiers = def.shift ? SHIFT_MODIFIER : 0;
  if (def.shift) {
    await send('Input.dispatchKeyEvent', {
      ...SHIFT_EVENT,
      type: 'rawKeyDown',
      modifiers: SHIFT_MODIFIER,
    });
  }
  const base = {
    key: def.key,
    code: def.code,
    windowsVirtualKeyCode: def.keyCode,
    nativeVirtualKeyCode: def.keyCode,
    modifiers,
  };
  await send('Input.dispatchKeyEvent', {
    ...base,
    type: def.text !== undefined ? 'keyDown' : 'rawKeyDown',
    ...(def.text !== undefined ? { text: def.text } : {}),
  });
  await send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
  if (def.shift) {
    await send('Input.dispatchKeyEvent', {
      ...SHIFT_EVENT,
      type: 'keyUp',
      modifiers: 0,
    });
  }
};

/**
 * Press a keyboard key (keyDown + keyUp) on the focused element.
 * Named keys (Enter, Tab, arrows, ...) or any single printable character.
 */
export const pressKeyViaSend = async (
  send: CdpSend,
  key: string,
): Promise<void> => {
  const def = keyDefFor(key);
  if (!def) {
    throw new Error(
      `Unsupported key "${key}". Supported: ${Object.keys(NAMED_KEYS).join(', ')}, or a single printable character.`,
    );
  }
  await dispatchKeyDefViaSend(send, def);
};

/** Human-like per-keystroke delay: 100-300ms (bot-detection etiquette). */
const humanTypeDelay = (): number => 100 + Math.random() * 200;

/**
 * Type ONE character with real key events (Shift + keyDown carrying text +
 * keyUp) so per-key listeners fire exactly as for a human keystroke. Characters
 * with no physical US key (한글, emoji, ...) go through `Input.insertText`,
 * which is what an IME commit produces: a trusted `input` event with no
 * impossible keydown attached.
 */
const typeCharViaSend = async (send: CdpSend, char: string): Promise<void> => {
  const def = CHAR_KEYS[char];
  if (!def) {
    await send('Input.insertText', { text: char });
    return;
  }
  await dispatchKeyDefViaSend(send, def);
};

/**
 * Type into a resolved node like a human: real click to focus, then one
 * character at a time with a randomized 100–300ms delay. This is the DEFAULT
 * for entering text — speed optimizations belong to logic (snapshot/refs/
 * detection), never to typing cadence.
 */
export const typeNodeViaSend = async (
  send: CdpSend,
  handle: NodeHandle,
  label: string,
  text: string,
): Promise<void> => {
  await clickNodeViaSend(send, handle, label);
  await [...text].reduce(async (prev, char) => {
    await prev;
    await typeCharViaSend(send, char);
    await sleep(humanTypeDelay());
  }, Promise.resolve());
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

/** One-shot WS human-like typing into a ref or CSS selector. */
export const typeInActiveTabWs = (
  port: number,
  target: ActionTarget,
  text: string,
): Promise<void> =>
  withActiveTabAction(port, async (send, refEntry, url) => {
    const handle = await resolveNodeViaSend(send, target, refEntry, url);
    await typeNodeViaSend(send, handle, describeTarget(target), text).catch(
      (error) => {
        throw translateNodeError(error, target);
      },
    );
  });
