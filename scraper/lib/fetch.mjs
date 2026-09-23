// HTTP fetching with realistic headers, timeouts, retries and an optional
// headless-browser fallback (Playwright) for bot-protected shops.

const UAS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class BlockedError extends Error {}

function looksBlocked(status, body) {
  if ([401, 403, 429, 503].includes(status)) return true;
  if (!body) return false;
  const head = body.slice(0, 6000).toLowerCase();
  return (
    head.includes('captcha') ||
    head.includes('access denied') ||
    head.includes('are you a robot') ||
    head.includes('cf-challenge') ||
    head.includes('just a moment...') ||
    head.includes('_incapsula_') ||
    head.includes('px-captcha') ||
    (head.includes('akamai') && head.includes('reference #'))
  );
}

export async function fetchText(url, { timeout = 20000, retries = 1, headers = {}, accept } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': UAS[(i + url.length) % UAS.length],
          Accept: accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache',
          ...headers,
        },
      });
      const body = await res.text();
      if (looksBlocked(res.status, body)) throw new BlockedError(`blocked (${res.status})`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { body, url: res.url, status: res.status };
    } catch (e) {
      lastErr = e.name === 'AbortError' ? new Error('timeout') : e;
      if (e instanceof BlockedError) break;
      await sleep(800 * (i + 1));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

// ---------- Browser fallback ----------
let browserPromise = null;
let browserDisabled = process.env.NO_BROWSER === '1';

async function getBrowser() {
  if (browserDisabled) return null;
  if (!browserPromise) {
    browserPromise = (async () => {
      try {
        const { chromium } = await import('playwright');
        const opts = { headless: true };
        if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
        return await chromium.launch(opts);
      } catch (e) {
        console.warn('  [browser] unavailable:', e.message.split('\n')[0]);
        browserDisabled = true;
        return null;
      }
    })();
  }
  return browserPromise;
}

const CONSENT_SELECTORS = [
  'button:has-text("Accepteren")',
  'button:has-text("Alles accepteren")',
  'button:has-text("Akkoord")',
  'button:has-text("Accepteer")',
  'button:has-text("Accept all")',
  'button:has-text("Accept")',
  '#onetrust-accept-btn-handler',
  'button[id*="accept"]',
];

export async function fetchWithBrowser(url, { timeout = 35000, waitFor } = {}) {
  const browser = await getBrowser();
  if (!browser) throw new Error('browser unavailable');
  const ctx = await browser.newContext({
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
    userAgent: UAS[2],
    viewport: { width: 1366, height: 900 },
  });
  const page = await ctx.newPage();
  try {
    await page.route('**/*.{png,jpg,jpeg,webp,avif,gif,svg,woff,woff2,mp4}', (r) => r.abort());
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    // Cookie/privacy walls (e.g. DPG Media Privacy Gate on Tweakers) can live in iframes and redirect after accepting.
    const gated = () => /privacy|consent|cookie/i.test(page.url());
    clicked: for (let attempt = 0; attempt < 2; attempt++) {
      for (const frame of page.frames()) {
        for (const sel of CONSENT_SELECTORS) {
          const b = frame.locator(sel).first();
          if (await b.isVisible({ timeout: 300 }).catch(() => false)) {
            await b.click({ timeout: 2000 }).catch(() => {});
            break clicked;
          }
        }
      }
      await page.waitForTimeout(800);
    }
    if (gated()) await page.waitForURL((u) => !/privacy|consent|cookie/i.test(u.toString()), { timeout: 10000 }).catch(() => {});
    if (waitFor) await page.waitForSelector(waitFor, { timeout: 8000 }).catch(() => {});
    else await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const body = await page.content();
    if (looksBlocked(200, body)) throw new BlockedError('blocked (browser)');
    return { body, url: page.url(), status: 200 };
  } finally {
    await ctx.close().catch(() => {});
  }
}

/** Plain fetch first; fall back to headless browser when blocked or empty. */
export async function fetchSmart(url, opts = {}) {
  if (opts.browserFirst) {
    try {
      return await fetchWithBrowser(url, opts);
    } catch (e) {
      return await fetchText(url, opts);
    }
  }
  try {
    const r = await fetchText(url, opts);
    if (opts.needs && !opts.needs(r.body)) throw new Error('content missing');
    return r;
  } catch (e) {
    if (opts.noBrowser) throw e;
    try {
      return await fetchWithBrowser(url, opts);
    } catch (e2) {
      throw new Error(`${e.message}; browser: ${e2.message}`);
    }
  }
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    await b?.close().catch(() => {});
  }
}

/** Run async tasks with a concurrency limit. */
export async function pool(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}
