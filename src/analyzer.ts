/**
 * ttj-skills-playwright - Page structure analyzer.
 *
 * Connects over CDP to the running browser's active tab and extracts a
 * machine-readable snapshot of the page (repeating lists, tables, forms,
 * meta) so an AI can propose "what can be crawled here" to the user.
 */

import { evaluateInActiveTab } from './cdp.js';
import type { PageAnalysis } from './types.js';

/**
 * Browser-context JS (injected as a string, run inside `page.evaluate`).
 *
 * Authored in plain browser JavaScript — NOT project FP/TS conventions.
 * Like OVERLAY_JS in browser.ts, this string is exempt from the repo's
 * no-var / no-for / no-mutation rules; it must stay valid standalone browser
 * code. It:
 *  1. detects repeating sibling groups (3+ items sharing a tag+class
 *     signature) and scores them by area × count × content richness,
 *  2. lists visible tables (shape + headers),
 *  3. lists forms / standalone input groups,
 *  4. collects page meta (url, title, top headings).
 * Only on-screen, visible elements are considered (mirrors OVERLAY_JS).
 */
const ANALYZE_JS = `() => {
    const docW = document.documentElement.clientWidth;

    // Memoized per-ancestor clipping info (same optimization as OVERLAY_JS):
    // deep trees share the same few overflow containers, so caching avoids
    // recomputing getComputedStyle thousands of times.
    const clipInfoCache = new Map();
    const getClipInfo = (p) => {
      const cached = clipInfoCache.get(p);
      if (cached !== undefined) return cached;
      const ps = window.getComputedStyle(p);
      const clips = /(hidden|scroll|auto|clip)/.test(ps.overflow + ps.overflowX + ps.overflowY);
      const info = clips ? { clips: true, rect: p.getBoundingClientRect() } : { clips: false };
      clipInfoCache.set(p, info);
      return info;
    };
    const isClipped = (el, r) => {
      let p = el.parentElement;
      while (p && p !== document.body) {
        const info = getClipInfo(p);
        if (info.clips) {
          const pr = info.rect;
          if (r.right <= pr.left + 1 || r.left >= pr.right - 1 ||
              r.bottom <= pr.top + 1 || r.top >= pr.bottom - 1) return true;
        }
        p = p.parentElement;
      }
      return false;
    };

    const onScreenVisible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return false;
      if (r.right <= 0 || r.bottom <= 0 || r.left < -1000) return false;
      if (r.left >= docW) return false;
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      if (cs.clipPath && cs.clipPath.includes('inset(50%)')) return false;
      if (cs.clip === 'rect(0px, 0px, 0px, 0px)') return false;
      if (isClipped(el, r)) return false;
      return true;
    };

    // Short, mostly-unique CSS selector (ported from browser.ts:getShortUniqueSelector).
    const getShortUniqueSelector = (el) => {
      const tag = el.tagName.toLowerCase();
      const cls = Array.from(el.classList)
        .filter(c => !c.startsWith('pw-ref-'))
        .slice(0, 2).map(c => '.' + CSS.escape(c)).join('');

      if (el.id) return tag + '#' + CSS.escape(el.id);

      const base = tag + cls;
      try {
        if (document.querySelectorAll(base).length === 1) return base;
      } catch(e) {}

      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
        const nthIdx = siblings.indexOf(el) + 1;
        const withNth = siblings.length > 1 ? base + ':nth-of-type(' + nthIdx + ')' : base;
        try {
          if (document.querySelectorAll(withNth).length === 1) return withNth;
        } catch(e) {}

        const pTag = parent.tagName.toLowerCase();
        const pId = parent.id ? '#' + CSS.escape(parent.id) : '';
        const pCls = pId ? '' : Array.from(parent.classList)
          .filter(c => !c.startsWith('pw-ref-'))
          .slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
        const parentSel = pTag + pId + pCls;

        const grandParent = parent.parentElement;
        const parentWithNth = grandParent
          ? (() => {
              const pSiblings = Array.from(grandParent.children).filter(c => c.tagName === parent.tagName);
              return pSiblings.length > 1
                ? parentSel + ':nth-of-type(' + (pSiblings.indexOf(parent) + 1) + ')'
                : parentSel;
            })()
          : parentSel;

        return parentWithNth + ' > ' + withNth;
      }

      return base;
    };

    // Class fragment used to build an item selector that matches every sibling.
    const classFragment = (el) => Array.from(el.classList)
      .filter(c => !c.startsWith('pw-ref-'))
      .slice(0, 2).map(c => '.' + CSS.escape(c)).join('');

    const truncate = (s, n) => {
      const t = (s || '').replace(/\\s+/g, ' ').trim();
      return t.length > n ? t.slice(0, n) + '…' : t;
    };

    // Digit-anchored currency patterns avoid false positives on words that
    // merely contain 원 (지원/회원/병원, ...).
    const PRICE_RE = /(₩|€|£|¥|\\$\\s*\\d|\\d[\\d,\\.]*\\s*(원|won|krw|usd|dollars?))/i;
    const DATE_RE = /(\\d{4}\\s*[-\\/\\.년]\\s*\\d{1,2}|\\d{1,2}\\s*:\\s*\\d{2}|\\d+\\s*(초|분|시간|일|주|개월|달|년)\\s*전|\\d+\\s*(second|minute|hour|day|week|month|year)s?\\s*ago|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s*\\d{1,2})/i;

    const hasTitle = (item) => {
      if (item.querySelector('h1,h2,h3,h4,h5,h6')) return true;
      if (item.querySelector('[class*="title" i],[class*="name" i],[class*="subject" i],[class*="headline" i]')) return true;
      const link = item.querySelector('a[href]');
      if (link && link.textContent.trim().length > 1) return true;
      return item.textContent.trim().length > 1;
    };

    const detectFields = (item) => {
      const text = item.textContent || '';
      return {
        title: hasTitle(item),
        link: item.tagName === 'A' || !!item.querySelector('a[href]'),
        image: !!item.querySelector('img,picture,svg') ||
               /url\\(/.test(window.getComputedStyle(item).backgroundImage || ''),
        price: PRICE_RE.test(text),
        date: DATE_RE.test(text),
      };
    };

    const buildSample = (item) => {
      const link = item.tagName === 'A' ? item : item.querySelector('a[href]');
      const img = item.querySelector('img');
      const sample = { text: truncate(item.textContent, 80) };
      if (link && link.getAttribute('href')) sample.href = link.getAttribute('href');
      if (img && (img.currentSrc || img.src)) sample.imgSrc = img.currentSrc || img.src;
      return sample;
    };

    // 1) Repeating groups: for every parent, bucket visible children by
    //    tag+class signature; a bucket of 3+ is a repeating list.
    const groups = [];
    Array.from(document.querySelectorAll('*')).forEach(parent => {
      const children = Array.from(parent.children);
      if (children.length < 3) return;
      const buckets = new Map();
      children.forEach(child => {
        if (!onScreenVisible(child)) return;
        const sig = child.tagName + '|' + Array.from(child.classList)
          .filter(c => !c.startsWith('pw-ref-')).sort().join('.');
        if (!buckets.has(sig)) buckets.set(sig, []);
        buckets.get(sig).push(child);
      });
      buckets.forEach(items => {
        if (items.length < 3) return;
        const first = items[0];
        const rect = first.getBoundingClientRect();
        const area = Math.max(rect.width * rect.height, 1);
        const fields = detectFields(first);
        const richness = [fields.title, fields.link, fields.image, fields.price, fields.date]
          .filter(Boolean).length;
        const tag = first.tagName.toLowerCase();
        const containerSelector = getShortUniqueSelector(parent);
        const itemSelector = containerSelector + ' > ' + tag + classFragment(first);
        groups.push({
          containerSelector,
          itemSelector,
          count: items.length,
          fields,
          samples: items.slice(0, 3).map(buildSample),
          score: Math.round(area * items.length * (richness + 1)),
        });
      });
    });
    const repeatingGroups = groups
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // 2) Tables: shape + header texts.
    const tables = Array.from(document.querySelectorAll('table'))
      .filter(onScreenVisible)
      .map(table => {
        const rows = Array.from(table.rows);
        const columns = rows.reduce((max, r) => Math.max(max, r.cells.length), 0);
        const headerCells = table.querySelectorAll('th').length
          ? Array.from(table.querySelectorAll('th'))
          : (rows[0] ? Array.from(rows[0].cells) : []);
        return {
          selector: getShortUniqueSelector(table),
          rows: rows.length,
          columns,
          headers: headerCells.map(c => truncate(c.textContent, 40)).filter(t => t.length > 0),
        };
      });

    // 3) Forms + standalone input groups.
    const describeInput = (input) => {
      const info = { type: input.tagName === 'TEXTAREA' ? 'textarea' : (input.type || 'text') };
      if (input.placeholder) info.placeholder = input.placeholder;
      if (input.name) info.name = input.name;
      return info;
    };
    const formEls = Array.from(document.querySelectorAll('form')).filter(onScreenVisible);
    const forms = formEls.map(form => ({
      selector: getShortUniqueSelector(form),
      inputs: Array.from(form.querySelectorAll('input,select,textarea'))
        .filter(onScreenVisible).map(describeInput),
    }));
    const standalone = Array.from(document.querySelectorAll('input,select,textarea'))
      .filter(el => !el.closest('form') && onScreenVisible(el));
    const standaloneGroup = standalone.length
      ? [{ selector: 'body (standalone inputs)', inputs: standalone.map(describeInput) }]
      : [];

    // 4) Meta.
    const headings = Array.from(document.querySelectorAll('h1,h2'))
      .filter(onScreenVisible)
      .map(h => truncate(h.textContent, 80))
      .filter(t => t.length > 0)
      .slice(0, 5);

    return {
      meta: { url: location.href, title: document.title, headings },
      repeatingGroups,
      tables,
      forms: forms.concat(standaloneGroup),
    };
  }`;

/**
 * Analyze the active page's structure over CDP and return a PageAnalysis.
 * Pure orchestration — the heavy lifting runs browser-side in ANALYZE_JS.
 * Uses the direct-WebSocket fast path (exact MRU tab, hard 30s timeout).
 */
export const analyzeActivePage = (port: number): Promise<PageAnalysis> =>
  evaluateInActiveTab(port, `(${ANALYZE_JS})()`, 30_000).then(
    (result) => result as PageAnalysis,
  );
