/**
 * ttj-skills-playwright - WS batch runner.
 *
 * Runs a whole goto → snapshot → fill → press sequence over ONE process and
 * ONE per-tab CDP WebSocket (no playwright load, no attach to other tabs).
 * Ref lifecycle invariant: a `goto` step invalidates refs (document replaced
 * → backendNodeIds die); a `snapshot` step refreshes both the in-memory map
 * and the persisted files, so `[goto → snapshot → fill e5 → press Enter]` is
 * a valid single-call login flow.
 *
 * `type` steps (per-key human delay with real key events) stay on the
 * playwright runner — cli.ts routes any batch containing `type` there.
 */

import { writeFile } from 'fs/promises';
import { getActiveTarget } from './cdp.js';
import {
  withTargetWs,
  evaluateViaSend,
  type CdpSend,
  type CdpEvents,
} from './cdp-ws.js';
import type { BatchStep, BatchStepResult } from './types.js';
import { loadRefEntry, type RefMapEntry } from './refmap.js';
import {
  parseActionTarget,
  resolveNodeViaSend,
  clickNodeViaSend,
  fillNodeViaSend,
  pressKeyViaSend,
  waitForSelectorViaSend,
} from './input-ws.js';
import { captureSnapshotViaSend, persistSnapshot } from './snapshot.js';

const requireField = (value: string | undefined, name: string): string => {
  if (value === undefined || value === '') {
    throw new Error(`missing required field "${name}"`);
  }
  return value;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const GOTO_TIMEOUT_MS = 30_000;
const WAIT_TIMEOUT_MS = 10_000;

/**
 * Mutable run state: refs die on navigation, refresh on snapshot. Kept in a
 * single holder object reassigned per step (no external side effects).
 */
interface BatchRunState {
  refEntry: RefMapEntry | undefined;
}

const liveUrl = async (send: CdpSend): Promise<string> =>
  String(await evaluateViaSend(send, 'location.href'));

const liveTitle = async (send: CdpSend): Promise<string> =>
  String(await evaluateViaSend(send, 'document.title'));

const gotoStep = async (
  send: CdpSend,
  events: CdpEvents,
  state: BatchRunState,
  url: string,
): Promise<unknown> => {
  await send('Page.enable');
  const loaded = new Promise<void>((resolve) => {
    events.on('Page.loadEventFired', () => resolve());
  });
  await send('Page.navigate', { url });
  const timer = { id: undefined as ReturnType<typeof setTimeout> | undefined };
  await Promise.race([
    loaded,
    new Promise<never>((_, reject) => {
      timer.id = setTimeout(
        () => reject(new Error(`goto load timeout after ${GOTO_TIMEOUT_MS}ms`)),
        GOTO_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer.id));
  // Navigation replaces the document → every prior ref is dead.
  state.refEntry = undefined;
  return liveTitle(send);
};

const actionTargetOf = (step: BatchStep): string =>
  step.ref ?? requireField(step.selector, 'selector');

const runStep = async (
  send: CdpSend,
  events: CdpEvents,
  state: BatchRunState,
  step: BatchStep,
  targetId: string,
): Promise<unknown> => {
  if (step.cmd === 'goto') {
    return gotoStep(send, events, state, requireField(step.url, 'url'));
  }
  if (step.cmd === 'click') {
    const target = parseActionTarget(actionTargetOf(step));
    const handle = await resolveNodeViaSend(
      send,
      target,
      state.refEntry,
      await liveUrl(send),
    );
    await clickNodeViaSend(
      send,
      handle,
      target.kind === 'ref' ? target.ref : target.selector,
    );
    return 'clicked';
  }
  if (step.cmd === 'fill') {
    const target = parseActionTarget(actionTargetOf(step));
    const handle = await resolveNodeViaSend(
      send,
      target,
      state.refEntry,
      await liveUrl(send),
    );
    await fillNodeViaSend(send, handle, requireField(step.text, 'text'));
    return 'filled';
  }
  if (step.cmd === 'press') {
    await pressKeyViaSend(send, requireField(step.key, 'key'));
    return 'pressed';
  }
  if (step.cmd === 'wait') {
    await waitForSelectorViaSend(
      send,
      requireField(step.selector, 'selector'),
      step.timeout ?? WAIT_TIMEOUT_MS,
    );
    return 'found';
  }
  if (step.cmd === 'eval') {
    return evaluateViaSend(send, requireField(step.code, 'code'));
  }
  if (step.cmd === 'screenshot') {
    const outputPath = requireField(step.path, 'path');
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      ...(step.full === true ? { captureBeyondViewport: true } : {}),
    });
    await writeFile(outputPath, Buffer.from(String(shot.data), 'base64'));
    return outputPath;
  }
  if (step.cmd === 'snapshot') {
    const capture = await captureSnapshotViaSend(send);
    const url = await liveUrl(send);
    const title = await liveTitle(send);
    const filePath = await persistSnapshot(targetId, url, title, capture);
    state.refEntry = {
      url,
      title,
      createdAt: Date.now(),
      refs: capture.refs,
    };
    return { file: filePath, refs: capture.refCount, lines: capture.lineCount };
  }
  if (step.cmd === 'type') {
    throw new Error(
      'type steps run via the playwright runner — this should not happen (report a bug)',
    );
  }
  throw new Error(
    `unknown cmd "${String(step.cmd)}" (goto|click|type|wait|eval|screenshot|fill|press|snapshot)`,
  );
};

/**
 * Run batch steps over the active tab's own WebSocket. Same contract as the
 * playwright runner: steps run in order, first failure marks the run failed
 * and every remaining step reports as skipped.
 */
export const runBatchOverWs = async (
  port: number,
  steps: readonly BatchStep[],
): Promise<BatchStepResult[]> => {
  const target = await getActiveTarget(port);
  if (!target?.wsUrl) {
    throw new Error('No open page found. Open a page in the browser first.');
  }
  const initialRefEntry = await loadRefEntry(target.id);
  return withTargetWs(
    target.wsUrl,
    (send, events) => {
      const state: BatchRunState = { refEntry: initialRefEntry };
      return steps.reduce<Promise<BatchStepResult[]>>(
        async (accPromise, step, index) => {
          const acc = await accPromise;
          const base = { step: index + 1, cmd: String(step.cmd) };
          if (acc.some((r) => !r.ok)) {
            return [
              ...acc,
              { ...base, ok: false, error: 'skipped (previous step failed)' },
            ];
          }
          try {
            const result = await runStep(send, events, state, step, target.id);
            return [...acc, { ...base, ok: true, result }];
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            return [...acc, { ...base, ok: false, error: message }];
          }
        },
        Promise.resolve([]),
      );
    },
    GOTO_TIMEOUT_MS + 5_000,
  );
};
