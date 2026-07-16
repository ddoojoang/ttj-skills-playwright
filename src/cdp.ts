/**
 * ttj-skills-playwright - Direct CDP connection helpers (playwright-core).
 *
 * Connects to the already-running Chrome (launched by this tool with
 * `--remote-debugging-port`) over CDP. No playwright-cli session, no temp
 * config file, no side-effect tabs — measured ~2x faster than shelling out
 * to playwright-cli per command.
 */

import http from 'node:http';
import type { Browser, Page } from 'playwright-core';

/**
 * Minimal GET against Chrome's local CDP HTTP endpoints (/json/list,
 * /json/activate/…). The port is fixed and local, so this answers in ~10ms —
 * no playwright involved. Rejects on network error/timeout/bad status.
 */
const cdpHttpGet = (port: number, urlPath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: urlPath, timeout: 1000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          return res.statusCode === 200
            ? resolve(body)
            : reject(new Error(`CDP ${urlPath} → HTTP ${res.statusCode}: ${body}`));
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`CDP ${urlPath} timeout`));
    });
  });

interface CdpTarget {
  id: string;
  type?: string;
  url?: string;
  title?: string;
}

/**
 * Content-page targets straight from /json/list (most-recently-used first).
 * Pure HTTP — the fast path for "which site / which tabs are open".
 */
const listContentTargets = async (port: number): Promise<CdpTarget[]> => {
  const body = await cdpHttpGet(port, '/json/list');
  const targets = JSON.parse(body) as CdpTarget[];
  return targets.filter(
    (t) => t.type === 'page' && isContentUrl(t.url ?? ''),
  );
};

/**
 * A real content URL (excludes about:blank, chrome:// and devtools pages).
 */
const isContentUrl = (url: string): boolean =>
  !url.startsWith('about:') &&
  !url.startsWith('chrome') &&
  !url.startsWith('devtools');

/**
 * A real content tab (excludes about:blank, chrome:// and devtools pages).
 */
const isContentPage = (page: Page): boolean => isContentUrl(page.url());

/**
 * URL of the most-recently-activated content tab — Chrome orders /json/list
 * targets most-recently-used first. Used as the active-tab signal when
 * focus/visibility can't decide (e.g. the window is minimized, so every tab
 * reports hidden). Best-effort: undefined on failure.
 */
const fetchMruContentUrl = (port: number): Promise<string | undefined> =>
  listContentTargets(port)
    .then((targets) => targets[0]?.url)
    .catch(() => undefined);

/**
 * All content pages across every context, in stable order.
 */
const contentPages = (browser: Browser): Page[] =>
  browser
    .contexts()
    .flatMap((context) => context.pages())
    .filter(isContentPage);

interface TabState {
  visible: boolean;
  focused: boolean;
}

const readTabState = (page: Page): Promise<TabState> =>
  page
    .evaluate(
      '({ visible: document.visibilityState === "visible", focused: document.hasFocus() })',
    )
    .then((state) => state as TabState)
    .catch(() => ({ visible: false, focused: false }));

/**
 * Pick the user's active tab. PRIMARY signal: Chrome's /json/list MRU order —
 * the first content target is the tab the user activated last. This is the
 * only reliable signal: per-page focus/visibility lies (every window's front
 * tab reports visible+focused, and a minimized window reports all hidden),
 * which used to make commands grab the original start tab (google.com)
 * instead of the tab the user was actually working in. Focus/visibility and
 * first-page are kept only as fallbacks when the HTTP lookup fails.
 */
const pickActivePage = async (
  browser: Browser,
  port: number,
): Promise<Page | undefined> => {
  const pages = contentPages(browser);
  const mruUrl = await fetchMruContentUrl(port);
  const mruPage = pages.find((page) => page.url() === mruUrl);
  if (mruPage) return mruPage;

  const states = await Promise.all(pages.map(readTabState));
  return (
    pages.find((_, index) => states[index]?.focused) ??
    pages.find((_, index) => states[index]?.visible) ??
    pages[0]
  );
};

/**
 * Side effect: connect over CDP, run `fn` against the browser, then
 * disconnect. Disconnecting never closes the user's browser — CDP
 * connections detach without terminating Chrome.
 *
 * playwright-core is imported LAZILY here (~200ms load) so commands that can
 * answer over plain CDP HTTP (tabs / tab / current-site checks) never pay it.
 */
const withBrowser = async <T>(
  port: number,
  fn: (browser: Browser) => Promise<T>,
): Promise<T> => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
};

/**
 * Connect over CDP and run `fn` against the user's active tab.
 */
export const withActivePage = <T>(
  port: number,
  fn: (page: Page) => Promise<T>,
): Promise<T> =>
  withBrowser(port, async (browser) => {
    const page = await pickActivePage(browser, port);
    if (!page) {
      throw new Error(
        'No open page found. Open a page in the browser first.',
      );
    }
    return fn(page);
  });

/**
 * Run arbitrary JS (expression or function string) in the active tab and
 * return its serializable result.
 */
export const evalInActivePage = (
  port: number,
  code: string,
): Promise<unknown> => withActivePage(port, (page) => page.evaluate(code));

/** Remove all visualization overlays (badges, boxes, labels) from the tab. */
const CLEAR_OVERLAY_JS = `() => {
  document.querySelectorAll('.pw-ref-overlay,.pw-ref-style,.pw-ref-svg,.pw-ref-badge,.pw-ref-tooltip,.pw-ref-region-fill').forEach(e => e.remove());
  document.querySelectorAll('.pw-ref-highlight,.pw-ref-region-outline').forEach(e => e.classList.remove('pw-ref-highlight','pw-ref-region-outline','pw-ref-focused','pw-ref-dimmed'));
  return true;
}`;

export const clearOverlays = (port: number): Promise<void> =>
  withActivePage(port, async (page) => {
    await page.evaluate(`(${CLEAR_OVERLAY_JS})()`);
  });

/**
 * Navigate the active tab and wait for the load event. Returns the title.
 */
export const gotoInActivePage = (port: number, url: string): Promise<string> =>
  withActivePage(port, async (page) => {
    await page.goto(url, { waitUntil: 'load' });
    return page.title();
  });

/**
 * Capture a screenshot of the active tab. Returns the tab's URL.
 */
export const screenshotActivePage = (
  port: number,
  outputPath: string,
  fullPage: boolean,
): Promise<string> =>
  withActivePage(port, async (page) => {
    await page.screenshot({ path: outputPath, fullPage });
    return page.url();
  });

const ACTION_TIMEOUT_MS = 10_000;

/**
 * Click an element with a real (trusted) mouse event.
 */
export const clickInActivePage = (
  port: number,
  selector: string,
): Promise<void> =>
  withActivePage(port, (page) =>
    page.click(selector, { timeout: ACTION_TIMEOUT_MS }),
  );

/** Human-like per-keystroke delay: 100–300ms (bot-detection etiquette). */
const humanTypeDelay = (): number => 100 + Math.random() * 200;

/**
 * Type text into a page element with real (trusted) keyboard events, one
 * character at a time with a randomized human-like delay.
 */
const typeIntoPage = async (
  page: Page,
  selector: string,
  text: string,
): Promise<void> => {
  await page.click(selector, { timeout: ACTION_TIMEOUT_MS });
  await [...text].reduce(async (prev, char) => {
    await prev;
    await page.keyboard.type(char);
    await new Promise((resolve) => setTimeout(resolve, humanTypeDelay()));
  }, Promise.resolve());
};

/**
 * Type text into an element with real (trusted) keyboard events, one
 * character at a time with a randomized human-like delay.
 */
export const typeInActivePage = (
  port: number,
  selector: string,
  text: string,
): Promise<void> =>
  withActivePage(port, (page) => typeIntoPage(page, selector, text));

/**
 * Wait until a selector appears in the active tab.
 */
export const waitInActivePage = (
  port: number,
  selector: string,
  timeoutMs: number,
): Promise<void> =>
  withActivePage(port, async (page) => {
    await page.waitForSelector(selector, { timeout: timeoutMs });
  });

/**
 * One step of a `batch` run. `cmd` picks the action; the other fields are
 * that action's arguments (validated at execution time).
 */
export interface BatchStep {
  readonly cmd: 'goto' | 'click' | 'type' | 'wait' | 'eval' | 'screenshot';
  readonly url?: string;
  readonly selector?: string;
  readonly text?: string;
  readonly code?: string;
  readonly path?: string;
  readonly timeout?: number;
  readonly full?: boolean;
}

export interface BatchStepResult {
  readonly step: number;
  readonly cmd: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

const requireField = (value: string | undefined, name: string): string => {
  if (value === undefined || value === '') {
    throw new Error(`missing required field "${name}"`);
  }
  return value;
};

const WAIT_TIMEOUT_MS = 10_000;

const BATCH_HANDLERS: Record<
  BatchStep['cmd'],
  (page: Page, step: BatchStep) => Promise<unknown>
> = {
  goto: async (page, step) => {
    await page.goto(requireField(step.url, 'url'), { waitUntil: 'load' });
    return page.title();
  },
  click: (page, step) =>
    page
      .click(requireField(step.selector, 'selector'), {
        timeout: step.timeout ?? ACTION_TIMEOUT_MS,
      })
      .then(() => 'clicked'),
  type: (page, step) =>
    typeIntoPage(
      page,
      requireField(step.selector, 'selector'),
      requireField(step.text, 'text'),
    ).then(() => 'typed'),
  wait: (page, step) =>
    page
      .waitForSelector(requireField(step.selector, 'selector'), {
        timeout: step.timeout ?? WAIT_TIMEOUT_MS,
      })
      .then(() => 'found'),
  eval: (page, step) => page.evaluate(requireField(step.code, 'code')),
  screenshot: async (page, step) => {
    const outputPath = requireField(step.path, 'path');
    await page.screenshot({ path: outputPath, fullPage: step.full === true });
    return outputPath;
  },
};

/**
 * Run a sequence of actions against the active tab over ONE process and ONE
 * CDP connection (instead of one process + reconnect per action). Steps run
 * in order; the first failure marks the run failed and every remaining step
 * is reported as skipped.
 */
export const runBatchInActivePage = (
  port: number,
  steps: readonly BatchStep[],
): Promise<BatchStepResult[]> =>
  withActivePage(port, (page) =>
    steps.reduce<Promise<BatchStepResult[]>>(async (accPromise, step, index) => {
      const acc = await accPromise;
      const base = { step: index + 1, cmd: String(step.cmd) };
      if (acc.some((r) => !r.ok)) {
        return [...acc, { ...base, ok: false, error: 'skipped (previous step failed)' }];
      }
      const handler = BATCH_HANDLERS[step.cmd];
      if (!handler) {
        return [...acc, { ...base, ok: false, error: `unknown cmd "${String(step.cmd)}" (goto|click|type|wait|eval|screenshot)` }];
      }
      try {
        const result = await handler(page, step);
        return [...acc, { ...base, ok: true, result }];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [...acc, { ...base, ok: false, error: message }];
      }
    }, Promise.resolve([])),
  );

export interface TabInfo {
  index: number;
  url: string;
  title: string;
  active: boolean;
}

/**
 * List every content tab with its 1-based index and active flag.
 *
 * Pure CDP HTTP (/json/list) — ~10ms on the fixed local port, no playwright
 * load. Chrome returns targets most-recently-used first, so index 1 is the
 * tab the user last worked in (that's also the `active` one).
 */
export const listTabs = async (port: number): Promise<TabInfo[]> => {
  const targets = await listContentTargets(port);
  return targets.map((t, index) => ({
    index: index + 1,
    url: t.url ?? '',
    title: t.title ?? '',
    active: index === 0,
  }));
};

/**
 * Bring the tab at the given 1-based index (per `listTabs` order) to the
 * front so subsequent commands target it. Pure CDP HTTP (/json/activate).
 * Returns its URL.
 */
export const activateTab = async (
  port: number,
  index: number,
): Promise<string> => {
  const targets = await listContentTargets(port);
  const target = targets[index - 1];
  if (!target) {
    throw new Error(`Tab ${index} not found (open tabs: ${targets.length})`);
  }
  await cdpHttpGet(port, `/json/activate/${target.id}`);
  return target.url ?? '';
};
