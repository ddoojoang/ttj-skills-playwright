/**
 * ttj-skills-browser - Direct CDP connection helpers (playwright-core).
 *
 * Connects to the already-running Chrome (launched by this tool with
 * `--remote-debugging-port`) over CDP. No playwright-cli session, no temp
 * config file, no side-effect tabs — measured ~2x faster than shelling out
 * to playwright-cli per command.
 */

import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';

/**
 * A real content tab (excludes about:blank, chrome:// and devtools pages).
 */
const isContentPage = (page: Page): boolean => {
  const url = page.url();
  return (
    !url.startsWith('about:') &&
    !url.startsWith('chrome') &&
    !url.startsWith('devtools')
  );
};

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
 * Pick the user's active tab: prefer the focused page, then a visible one,
 * then fall back to the first content page.
 */
const pickActivePage = async (browser: Browser): Promise<Page | undefined> => {
  const pages = contentPages(browser);
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
 */
const withBrowser = async <T>(
  port: number,
  fn: (browser: Browser) => Promise<T>,
): Promise<T> => {
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
    const page = await pickActivePage(browser);
    if (!page) {
      throw new Error(
        '열린 페이지가 없습니다. 브라우저에서 작업할 페이지를 먼저 열어주세요.',
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

/** Remove all visualize/crawl overlays (badges, boxes, labels) from the tab. */
const CLEAR_OVERLAY_JS = `() => {
  document.querySelectorAll('.pw-ref-overlay,.pw-ref-style,.pw-ref-svg,.pw-ref-badge,.pw-ref-tooltip').forEach(e => e.remove());
  document.querySelectorAll('.pw-ref-highlight').forEach(e => e.classList.remove('pw-ref-highlight','pw-ref-focused','pw-ref-dimmed','pw-ref-list'));
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
 * Type text into an element with real (trusted) keyboard events, one
 * character at a time with a randomized human-like delay.
 */
export const typeInActivePage = (
  port: number,
  selector: string,
  text: string,
): Promise<void> =>
  withActivePage(port, async (page) => {
    await page.click(selector, { timeout: ACTION_TIMEOUT_MS });
    await [...text].reduce(async (prev, char) => {
      await prev;
      await page.keyboard.type(char);
      await new Promise((resolve) => setTimeout(resolve, humanTypeDelay()));
    }, Promise.resolve());
  });

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

export interface TabInfo {
  index: number;
  url: string;
  title: string;
  active: boolean;
}

/**
 * List every content tab with its 1-based index and active flag.
 */
export const listTabs = (port: number): Promise<TabInfo[]> =>
  withBrowser(port, async (browser) => {
    const pages = contentPages(browser);
    const active = await pickActivePage(browser);
    return Promise.all(
      pages.map(async (page, index) => ({
        index: index + 1,
        url: page.url(),
        title: await page.title().catch(() => ''),
        active: page === active,
      })),
    );
  });

/**
 * Bring the tab at the given 1-based index to the front so subsequent
 * commands target it. Returns its URL.
 */
export const activateTab = (port: number, index: number): Promise<string> =>
  withBrowser(port, async (browser) => {
    const pages = contentPages(browser);
    const target = pages[index - 1];
    if (!target) {
      throw new Error(`탭 ${index}번이 없습니다 (열린 탭: ${pages.length}개)`);
    }
    await target.bringToFront();
    return target.url();
  });
