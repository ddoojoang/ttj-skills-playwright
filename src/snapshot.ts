/**
 * ttj-skills-playwright - ARIA accessibility snapshot (`snapshot` command).
 *
 * Token-efficiency core (adopted from playwright-cli's design): the page is
 * captured as a compact indented text tree — `- role "name" [ref=eN]` — via
 * CDP `Accessibility.getFullAXTree` over the active tab's own WebSocket. The
 * heavy tree goes to a FILE under the profile dir; stdout carries only the
 * URL/title/path/counts, so the agent reads the file selectively (grep /
 * partial reads) instead of pushing the whole page through its context.
 *
 * Every kept node with a backendDOMNodeId gets a ref (e1, e2, …) persisted
 * via refmap.ts, so later `click e5` / `fill e5` invocations act on the exact
 * element with no selector guessing.
 */

import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getProfilePath } from './utils.js';
import { getActiveTarget, withActivePage } from './cdp.js';
import {
  hasNativeWebSocket,
  isWsConnectError,
  withTargetWs,
  type CdpSend,
} from './cdp-ws.js';
import { saveRefEntry } from './refmap.js';

export interface SnapshotOptions {
  /** Limit rendered tree depth; deeper subtrees collapse to a count line. */
  readonly depth?: number;
}

export interface SnapshotSummary {
  readonly url: string;
  readonly title: string;
  readonly filePath: string;
  readonly refCount: number;
  readonly lineCount: number;
  readonly unexpandedIframes: number;
  /** True when the playwright fallback ran (no refs available). */
  readonly refless: boolean;
}

interface AXValueRaw {
  value?: unknown;
}

interface AXPropertyRaw {
  name?: string;
  value?: AXValueRaw;
}

interface AXNodeRaw {
  nodeId: string;
  ignored?: boolean;
  role?: AXValueRaw;
  name?: AXValueRaw;
  value?: AXValueRaw;
  properties?: AXPropertyRaw[];
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

/** Structural noise roles: never rendered, children hoisted in place. */
const HOIST_ROLES = new Set([
  'none',
  'generic',
  'InlineTextBox',
  'LineBreak',
]);

/** Boolean ARIA properties rendered as bare [name] when true. */
const FLAG_PROPS = new Set([
  'disabled',
  'expanded',
  'selected',
  'pressed',
  'required',
  'readonly',
  'multiline',
]);

const cleanText = (text: string, max: number): string => {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
};

const quote = (text: string): string =>
  `"${cleanText(text, 80).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const propSuffix = (node: AXNodeRaw): string => {
  const parts = (node.properties ?? []).flatMap((prop) => {
    const name = prop.name ?? '';
    const value = prop.value?.value;
    if (name === 'level' && typeof value === 'number') return [`level=${value}`];
    if (name === 'checked') {
      return value === true || value === 'true'
        ? ['checked']
        : value === 'mixed'
          ? ['checked=mixed']
          : [];
    }
    if (FLAG_PROPS.has(name) && (value === true || value === 'true')) {
      return [name];
    }
    return [];
  });
  const nodeValue = node.value?.value;
  const valuePart =
    typeof nodeValue === 'string' && nodeValue.length > 0
      ? [`value=${quote(nodeValue)}`]
      : [];
  return [...parts, ...valuePart].map((p) => ` [${p}]`).join('');
};

interface RenderState {
  readonly lines: readonly string[];
  readonly refs: Readonly<Record<string, number>>;
  readonly nextRef: number;
  readonly iframes: number;
}

const countDescendants = (
  node: AXNodeRaw,
  byId: ReadonlyMap<string, AXNodeRaw>,
): number =>
  (node.childIds ?? []).reduce((acc, childId) => {
    const child = byId.get(childId);
    return child ? acc + 1 + countDescendants(child, byId) : acc;
  }, 0);

const renderChildren = (
  node: AXNodeRaw,
  byId: ReadonlyMap<string, AXNodeRaw>,
  depth: number,
  maxDepth: number,
  parentName: string,
  state: RenderState,
): RenderState =>
  (node.childIds ?? []).reduce(
    (acc, childId) => {
      const child = byId.get(childId);
      return child
        ? renderNode(child, byId, depth, maxDepth, parentName, acc)
        : acc;
    },
    state,
  );

const renderNode = (
  node: AXNodeRaw,
  byId: ReadonlyMap<string, AXNodeRaw>,
  depth: number,
  maxDepth: number,
  parentName: string,
  state: RenderState,
): RenderState => {
  const role = String(node.role?.value ?? '');
  const name = cleanText(String(node.name?.value ?? ''), 80);

  // Noise nodes: hoist children in place (same depth, same parent name).
  if (node.ignored === true || HOIST_ROLES.has(role)) {
    return renderChildren(node, byId, depth, maxDepth, parentName, state);
  }

  const indent = '  '.repeat(depth);

  // Text leaves: render content unless it just repeats the parent's name.
  if (role === 'StaticText') {
    if (name.length === 0 || name === parentName) return state;
    return { ...state, lines: [...state.lines, `${indent}- text: ${name}`] };
  }

  const isCollapsedIframe =
    role === 'Iframe' && (node.childIds ?? []).length === 0;
  const hasBackendId = typeof node.backendDOMNodeId === 'number';
  const ref = hasBackendId ? `e${state.nextRef}` : undefined;
  const refPart = ref ? ` [ref=${ref}]` : '';
  const namePart = name.length > 0 ? ` ${quote(name)}` : '';

  const stateWithRef: RenderState = {
    ...state,
    refs: ref
      ? { ...state.refs, [ref]: node.backendDOMNodeId as number }
      : state.refs,
    nextRef: ref ? state.nextRef + 1 : state.nextRef,
    iframes: isCollapsedIframe ? state.iframes + 1 : state.iframes,
  };

  // Depth limit: render this node, collapse its subtree to a count.
  const descendantCount = countDescendants(node, byId);
  if (depth >= maxDepth && descendantCount > 0) {
    return {
      ...stateWithRef,
      lines: [
        ...stateWithRef.lines,
        `${indent}- ${role}${namePart}${refPart}${propSuffix(node)}: … (+${descendantCount} nodes)`,
      ],
    };
  }

  const childState = renderChildren(node, byId, depth + 1, maxDepth, name, {
    ...stateWithRef,
    lines: [],
  });
  const colon = childState.lines.length > 0 ? ':' : '';
  const line = `${indent}- ${role}${namePart}${refPart}${propSuffix(node)}${colon}`;
  return {
    ...childState,
    lines: [...stateWithRef.lines, line, ...childState.lines],
  };
};

export interface SnapshotCapture {
  readonly text: string;
  readonly refs: Readonly<Record<string, number>>;
  readonly refCount: number;
  readonly lineCount: number;
  readonly unexpandedIframes: number;
}

/**
 * Capture the accessibility tree through an already-open CDP `send` and
 * serialize it. Shared by the one-shot `snapshot` command and batch steps.
 */
export const captureSnapshotViaSend = async (
  send: CdpSend,
): Promise<SnapshotCapture> => {
  await send('Accessibility.enable');
  return captureAfterEnable(send);
};

const captureAfterEnable = async (send: CdpSend): Promise<SnapshotCapture> => {
  try {
    const response = await send('Accessibility.getFullAXTree');
    const nodes = (response.nodes ?? []) as AXNodeRaw[];
    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    const root =
      nodes.find((node) => node.parentId === undefined) ?? nodes[0];
    const depthArg = readDepthOption();
    const state = root
      ? renderNode(root, byId, 0, depthArg, '', {
          lines: [],
          refs: {},
          nextRef: 1,
          iframes: 0,
        })
      : { lines: [], refs: {}, nextRef: 1, iframes: 0 };
    return {
      text: state.lines.join('\n'),
      refs: state.refs,
      refCount: Object.keys(state.refs).length,
      lineCount: state.lines.length,
      unexpandedIframes: state.iframes,
    };
  } finally {
    send('Accessibility.disable').catch(() => undefined);
  }
};

/** --depth N from argv (snapshot render depth); Infinity when absent. */
const readDepthOption = (): number => {
  const args = process.argv.slice(2);
  const index = args.indexOf('--depth');
  const value = index >= 0 ? Number(args[index + 1]) : NaN;
  return Number.isInteger(value) && value > 0 ? value : Number.POSITIVE_INFINITY;
};

const snapshotDir = (): string => path.join(getProfilePath(), 'snapshots');

const snapshotFilePath = (targetId: string): string =>
  path.join(snapshotDir(), `${targetId}.txt`);

/**
 * Write the snapshot text + ref map for one tab. Shared by the one-shot
 * command and the batch `snapshot` step.
 */
export const persistSnapshot = async (
  targetId: string,
  url: string,
  title: string,
  capture: SnapshotCapture,
): Promise<string> => {
  await mkdir(snapshotDir(), { recursive: true });
  const filePath = snapshotFilePath(targetId);
  const header = `# URL: ${url}\n# Title: ${title}\n`;
  await writeFile(filePath, header + capture.text + '\n', 'utf-8');
  await saveRefEntry(targetId, {
    url,
    title,
    createdAt: Date.now(),
    refs: capture.refs,
  });
  return filePath;
};

/**
 * Fallback snapshot via playwright's ariaSnapshot (Node <22 or WS failure):
 * same tree text but WITHOUT refs — ref actions won't work from it.
 */
const snapshotViaPlaywright = async (
  port: number,
): Promise<SnapshotSummary> =>
  withActivePage(port, async (page) => {
    const text = await page.locator('html').ariaSnapshot();
    const url = page.url();
    const title = await page.title();
    await mkdir(snapshotDir(), { recursive: true });
    const filePath = path.join(snapshotDir(), 'fallback.txt');
    await writeFile(
      filePath,
      `# URL: ${url}\n# Title: ${title}\n${text}\n`,
      'utf-8',
    );
    return {
      url,
      title,
      filePath,
      refCount: 0,
      lineCount: text.split('\n').length,
      unexpandedIframes: 0,
      refless: true,
    };
  });

/**
 * Snapshot the active tab: WS fast path (refs + ref-map persisted), falling
 * back to playwright's refless ariaSnapshot on Node <22 / socket failure.
 */
export const snapshotActiveTab = async (
  port: number,
): Promise<SnapshotSummary> => {
  const target = hasNativeWebSocket()
    ? await getActiveTarget(port)
    : undefined;
  if (target?.wsUrl) {
    try {
      const capture = await withTargetWs(
        target.wsUrl,
        (send) => captureSnapshotViaSend(send),
        30_000,
      );
      const filePath = await persistSnapshot(
        target.id,
        target.url,
        target.title,
        capture,
      );
      return {
        url: target.url,
        title: target.title,
        filePath,
        refCount: capture.refCount,
        lineCount: capture.lineCount,
        unexpandedIframes: capture.unexpandedIframes,
        refless: false,
      };
    } catch (error) {
      if (!isWsConnectError(error)) throw error;
      // Socket-level failure only — retry through playwright below.
    }
  }
  return snapshotViaPlaywright(port);
};
