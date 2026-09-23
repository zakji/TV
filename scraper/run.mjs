#!/usr/bin/env node
// OLED//HUNT scraper: finds the best Dutch prices for the LG OLED 83" G4/G5/G6,
// updates data/deals.json + data/history.json and sends notifications.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, detectModel, isAccessory, shopFromUrl } from './lib/match.mjs';
import { PRODUCT_PAGES, SEARCH_PAGES, SEARCH_QUERIES, DISCOVERY_QUERIES, DISCOVERY_ALLOW, DISCOVERY_DENY, MARKTPLAATS_QUERIES } from './config.mjs';
import { scrapeProductPage, scrapeSearch, scrapeMarktplaats, webSearch, isAggregatorUrl } from './lib/sources.mjs';
import { closeBrowser, pool } from './lib/fetch.mjs';
import { buildDailyMessage, sendAll } from './notify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const args = new Set(process.argv.slice(2));
const TRIGGER = process.env.TRIGGER || (process.env.GITHUB_EVENT_NAME === 'schedule' ? 'schedule' : 'manual');
const log = (...a) => console.log(...a);

function amsterdamHour(d = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hour12: false }).format(d));
}
function amsterdamDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(d); // YYYY-MM-DD
}
async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}
const offerId = (o) =>
  createHash('sha1').update(`${o.shop}|${o.model}|${o.condition}|${o.url.split('?')[0]}`).digest('hex').slice(0, 12);

// ------------------------------------------------------------------ main
async function main() {
  // Cron fires at 10:00 and 11:00 UTC; only the one that is 12:xx in Amsterdam proceeds (DST-proof).
  if (TRIGGER === 'schedule' && !args.has('--force') && amsterdamHour() !== 12) {
    log(`Skipping: it is ${amsterdamHour()}:xx in Amsterdam, not 12:xx.`);
    await writeOutput('skipped', 'true');
    return;
  }
  await writeOutput('skipped', 'false');
  await mkdir(DATA, { recursive: true });
  const prev = await readJson(path.join(DATA, 'deals.json'), { offers: [], sources: [] });
  const history = await readJson(path.join(DATA, 'history.json'), {});

  const started = Date.now();
  const sourceStats = new Map(); // name -> {name, ok, found, errors, ms, kind}
  const offers = [];
  const visited = new Set();
  const stat = (name, kind) => {
    if (!sourceStats.has(name)) sourceStats.set(name, { name, kind, ok: false, found: 0, errors: 0, ms: 0, lastError: null });
    return sourceStats.get(name);
  };
  const track = async (name, kind, fn) => {
    const s = stat(name, kind);
    const t0 = Date.now();
    try {
      const res = (await fn()) || [];
      s.ok = true;
      s.found += res.length;
      if (res.raw != null) s.raw = (s.raw || 0) + res.raw;
      offers.push(...res);
      return res;
    } catch (e) {
      s.errors++;
      s.lastError = String(e.message || e).slice(0, 160);
      return [];
    } finally {
      s.ms += Date.now() - t0;
    }
  };

  // 1) Known product pages
  log(`▶ Product pages (${PRODUCT_PAGES.length})`);
  await pool(PRODUCT_PAGES, 4, (seed) => {
    visited.add(seed.url.split('?')[0]);
    return track(seed.shop || shopFromUrl(seed.url), seed.aggregator ? 'aggregator' : 'shop', () => scrapeProductPage(seed));
  });

  // 2) Shop search pages
  if (!args.has('--quick')) {
    log(`▶ Shop searches (${SEARCH_PAGES.length} shops × ${SEARCH_QUERIES.length} queries)`);
    const jobs = SEARCH_PAGES.flatMap((cfg) => SEARCH_QUERIES.slice(0, cfg.browser ? 3 : 5).map((q) => ({ cfg, q })));
    await pool(jobs, 3, ({ cfg, q }) =>
      track(cfg.shop, cfg.aggregator ? 'aggregator' : cfg.condition ? 'second-chance' : 'shop', () => scrapeSearch(cfg, q, { visited })),
    );
  }

  // 3) Marktplaats
  log('▶ Marktplaats');
  await pool(MARKTPLAATS_QUERIES, 2, (q) => track('Marktplaats', 'second-hand', () => scrapeMarktplaats(q)));

  // 4) Web discovery: unknown shops
  if (!args.has('--quick')) {
    log('▶ Web discovery');
    const found = new Set();
    await pool(DISCOVERY_QUERIES, 2, async (q) => {
      const s = stat('Web discovery', 'discovery');
      try {
        const urls = await webSearch(q);
        s.ok = s.ok || urls.length > 0;
        for (const u of urls) {
          const clean = u.split('#')[0];
          if (!DISCOVERY_ALLOW.test(clean + '/') || DISCOVERY_DENY.test(clean)) continue;
          if (!detectModel(decodeURIComponent(clean)) && !/oled.*83|83.*oled/i.test(clean)) continue;
          if (visited.has(clean.split('?')[0])) continue;
          found.add(clean);
        }
      } catch (e) {
        s.errors++;
        s.lastError = e.message;
      }
    });
    const list = [...found].slice(0, 30);
    log(`  discovered ${list.length} candidate pages`);
    await pool(list, 4, (url) => {
      visited.add(url.split('?')[0]);
      const agg = isAggregatorUrl(url);
      return track('Web discovery', 'discovery', () => scrapeProductPage({ url, aggregator: agg, source: 'discovery' }, { noBrowser: true }));
    });
  }
  await closeBrowser();

  // ---------------------------------------------------------------- merge
  const now = new Date().toISOString();
  const prevById = new Map((prev.offers || []).map((o) => [o.id, o]));
  const byKey = new Map();
  for (const o of offers) {
    if (!MODELS[o.model] || isAccessory(o.title) && !detectModel(o.title)) continue;
    o.id = offerId(o);
    const p = prevById.get(o.id);
    o.firstSeen = p?.firstSeen || now;
    o.lastSeen = now;
    o.prevPrice = p && p.price !== o.price ? p.price : p?.prevPrice ?? null;
    // same shop/model/condition from different pages → keep the cheapest
    const k = o.shop === 'Marktplaats' ? o.id : `${o.shop}|${o.model}|${o.condition}`;
    if (!byKey.has(k) || byKey.get(k).price > o.price) byKey.set(k, o);
  }
  let merged = [...byKey.values()];
  // Drop "Shop via Aggregator" entries when the shop itself was scraped directly at (about) the same price.
  const norm = (x) => String(x).toLowerCase().replace(/\.(nl|com|be)\b/g, '').replace(/[^a-z0-9]/g, '');
  const direct = merged.filter((o) => !o.aggregator);
  merged = merged.filter((o) => {
    if (!o.aggregator) return true;
    const seller = norm(o.shop.split(' via ')[0]);
    return !direct.some((d) => d.model === o.model && d.condition === o.condition && Math.abs(d.price - o.price) <= 5 && (seller.includes(norm(d.shop)) || norm(d.shop).includes(seller) || /^(laagste|beste)$/.test(seller)));
  });

  // Carry over recent offers from sources that failed this run (avoids flapping), marked stale.
  const failed = new Set([...sourceStats.values()].filter((s) => !s.ok).map((s) => s.name));
  const freshIds = new Set(merged.map((o) => o.id));
  for (const p of prev.offers || []) {
    if (freshIds.has(p.id) || p.seed) continue;
    const age = Date.now() - new Date(p.lastSeen).getTime();
    const src = p.shop.replace(/ \(.*\)$| via .*$/, '');
    if (age < 72 * 3600e3 && (failed.has(src) || failed.has(p.shop))) merged.push({ ...p, stale: true });
  }
  merged.sort((a, b) => a.price - b.price);

  // ------------------------------------------------------------------ best
  const best = {};
  for (const m of Object.keys(MODELS)) {
    best[m] = {};
    for (const cond of ['new', 'refurbished', 'used']) {
      const ok = (o) => o.model === m && o.condition === cond && !o.lowConfidence && !o.bundle;
      const c = merged.find((o) => ok(o) && !o.stale && !o.aggregator) || merged.find(ok);
      if (c) best[m][cond] = c;
    }
  }

  // --------------------------------------------------------------- history
  const today = amsterdamDate();
  const allTimeLowBefore = {};
  for (const m of Object.keys(MODELS)) {
    const h = (history[m] ||= []);
    allTimeLowBefore[m] = Math.min(...h.filter((x) => x.d !== today && x.new).map((x) => x.new), Infinity);
    // One point per day: the latest scan of the day wins (so a bad scan heals itself).
    const idx = h.findIndex((x) => x.d === today);
    const entry = { d: today };
    for (const cond of ['new', 'refurbished', 'used']) if (best[m][cond]) entry[cond] = best[m][cond].price;
    if (best[m].new) entry.shop = best[m].new.shop;
    if (idx >= 0) h[idx] = entry;
    else h.push(entry);
    if (Object.keys(entry).length === 1) h.splice(h.indexOf(entry), 1);
    h.sort((a, b) => a.d.localeCompare(b.d));
  }

  const stats = {};
  for (const m of Object.keys(MODELS)) {
    const h = history[m] || [];
    const lows = h.map((x) => x.new).filter(Boolean);
    const yesterday = h.filter((x) => x.d < today && x.new).at(-1);
    stats[m] = {
      allTimeLow: lows.length ? Math.min(...lows) : null,
      allTimeHigh: lows.length ? Math.max(...lows) : null,
      changeVsPrev: best[m].new && yesterday ? best[m].new.price - yesterday.new : null,
      offerCount: merged.filter((o) => o.model === m).length,
    };
  }

  const deals = {
    generatedAt: now,
    trigger: TRIGGER,
    repo: process.env.GITHUB_REPOSITORY || null,
    push: { vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null },
    durationMs: Date.now() - started,
    models: MODELS,
    best,
    stats,
    offers: merged,
    sources: [...sourceStats.values()].sort((a, b) => Number(b.ok) - Number(a.ok) || b.found - a.found),
  };
  await writeFile(path.join(DATA, 'deals.json'), JSON.stringify(deals, null, 1));
  await writeFile(path.join(DATA, 'history.json'), JSON.stringify(history, null, 1));
  log(`✔ ${merged.length} offers from ${deals.sources.filter((s) => s.ok).length}/${deals.sources.length} sources in ${(deals.durationMs / 1000).toFixed(1)}s`);
  for (const m of Object.keys(MODELS)) {
    const b = best[m];
    log(`  ${m}: new ${b.new ? '€' + b.new.price + ' @ ' + b.new.shop : '—'} | refurb ${b.refurbished ? '€' + b.refurbished.price : '—'} | used ${b.used ? '€' + b.used.price : '—'}`);
  }
  for (const s of deals.sources) log(`  [${s.ok ? 'ok' : '××'}] ${s.name}: ${s.found}${s.raw != null ? ` (raw ${s.raw})` : ''}${s.lastError ? ' (' + s.lastError + ')' : ''}`);

  // ---------------------------------------------------------------- notify
  if (args.has('--no-notify')) return;
  const alertBelow = Number(process.env.ALERT_BELOW || 0);
  const drops = Object.keys(MODELS)
    .map((m) => best[m].new)
    .filter((o) => o && ((Number.isFinite(allTimeLowBefore[o.model]) && o.price < allTimeLowBefore[o.model]) || (alertBelow && o.price <= alertBelow)));
  if (TRIGGER === 'schedule' || process.env.FORCE_NOTIFY === 'true') {
    const msg = buildDailyMessage(deals);
    if (drops.length) msg.title = '🔥 ' + msg.title;
    log('▶ Sending daily notification:', msg.title);
    log(await sendAll(msg));
  } else if (drops.length) {
    const d = drops.sort((a, b) => a.price - b.price)[0];
    const msg = {
      title: `🔥 Price drop: ${d.model} 83"`,
      body: `€${Math.round(d.price).toLocaleString('nl-NL')} at ${d.shop}${Number.isFinite(allTimeLowBefore[d.model]) ? ` (previous low €${Math.round(allTimeLowBefore[d.model]).toLocaleString('nl-NL')})` : ''}`,
      url: './',
      tag: 'drop-' + d.model,
    };
    log('▶ Sending price-drop alert:', msg.title);
    log(await sendAll(msg));
  }
}

async function writeOutput(k, v) {
  if (!process.env.GITHUB_OUTPUT) return;
  const { appendFile } = await import('node:fs/promises');
  await appendFile(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
}

main().catch(async (e) => {
  console.error(e);
  await closeBrowser();
  process.exit(1);
});
