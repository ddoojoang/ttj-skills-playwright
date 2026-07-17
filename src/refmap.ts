/**
 * ttj-skills-playwright - Persistent snapshot ref map.
 *
 * `snapshot` assigns refs (e1, e2, …) to accessibility-tree nodes and records
 * each ref's CDP backendDOMNodeId here, keyed by targetId. backendDOMNodeIds
 * stay valid for the lifetime of that tab's document, so a LATER one-shot
 * process (`click e5`, `fill e5 "…"`) can act on the exact element without a
 * daemon. Any staleness (tab navigated, node removed, unknown ref) produces a
 * one-line error telling the agent to re-run `snapshot` — the errors are part
 * of the CLI contract, agents read them literally.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getProfilePath } from './utils.js';

/** One tab's snapshot refs: ref token → CDP backendDOMNodeId. */
export interface RefMapEntry {
  readonly url: string;
  readonly title: string;
  readonly createdAt: number;
  readonly refs: Readonly<Record<string, number>>;
}

interface RefMapFile {
  readonly version: 1;
  readonly targets: Readonly<Record<string, RefMapEntry>>;
}

const REF_MAP_VERSION = 1;
const MAX_TARGETS = 5;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const refMapPath = (): string => path.join(getProfilePath(), 'refs.json');

/** True when a CLI argument is a snapshot ref token (e1, e42, …). */
export const isRefToken = (arg: string): boolean => /^e\d+$/.test(arg);

const readRefMapFile = async (): Promise<RefMapFile> => {
  try {
    const raw = await readFile(refMapPath(), 'utf-8');
    const parsed = JSON.parse(raw) as RefMapFile;
    return parsed.version === REF_MAP_VERSION && parsed.targets
      ? parsed
      : { version: REF_MAP_VERSION, targets: {} };
  } catch {
    // Missing or corrupt file → treated as "no snapshots yet".
    return { version: REF_MAP_VERSION, targets: {} };
  }
};

/** Keep only the freshest MAX_TARGETS entries younger than MAX_AGE_MS. */
const pruneTargets = (
  targets: Readonly<Record<string, RefMapEntry>>,
  now: number,
): Readonly<Record<string, RefMapEntry>> =>
  Object.fromEntries(
    Object.entries(targets)
      .filter(([, entry]) => now - entry.createdAt < MAX_AGE_MS)
      .sort(([, a], [, b]) => b.createdAt - a.createdAt)
      .slice(0, MAX_TARGETS),
  );

/**
 * Persist one tab's ref map (read → merge → prune → write).
 */
export const saveRefEntry = async (
  targetId: string,
  entry: RefMapEntry,
): Promise<void> => {
  const existing = await readRefMapFile();
  const merged: RefMapFile = {
    version: REF_MAP_VERSION,
    targets: pruneTargets(
      { ...existing.targets, [targetId]: entry },
      entry.createdAt,
    ),
  };
  await mkdir(getProfilePath(), { recursive: true });
  await writeFile(refMapPath(), JSON.stringify(merged, null, 2), 'utf-8');
};

/** Load the ref map for one tab, or undefined when no snapshot exists. */
export const loadRefEntry = async (
  targetId: string,
): Promise<RefMapEntry | undefined> =>
  (await readRefMapFile()).targets[targetId];

const highestRef = (refs: Readonly<Record<string, number>>): string => {
  const max = Object.keys(refs).reduce(
    (acc, key) => Math.max(acc, Number(key.slice(1))),
    0,
  );
  return `e${max}`;
};

/**
 * Resolve a ref token to its backendDOMNodeId, enforcing staleness rules.
 * Throws agent-readable errors (part of the CLI contract):
 *  - no snapshot for the tab → run `snapshot` first
 *  - tab navigated since the snapshot → re-run `snapshot`
 *  - ref not in the snapshot → re-run `snapshot` or check the ref
 */
export const resolveRefToBackendId = (
  entry: RefMapEntry | undefined,
  ref: string,
  currentUrl: string,
): number => {
  if (!entry) {
    throw new Error(
      "No snapshot for this tab. Run 'ttj-skills-playwright snapshot' first, then use refs like e5.",
    );
  }
  if (entry.url !== currentUrl) {
    throw new Error(
      `Snapshot is stale: the tab navigated (${entry.url} → ${currentUrl}). Run 'snapshot' again for fresh refs.`,
    );
  }
  const backendId = entry.refs[ref];
  if (backendId === undefined) {
    throw new Error(
      `Ref ${ref} not in the latest snapshot (has e1–${highestRef(entry.refs)}). Re-run 'snapshot' or check the ref.`,
    );
  }
  return backendId;
};

/** Agent-readable error for a ref whose node no longer exists in the page. */
export const staleRefError = (ref: string): Error =>
  new Error(
    `Ref ${ref} is stale (element removed or page re-rendered). Re-run 'snapshot'.`,
  );
