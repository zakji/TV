import { extractOffers, extractLinks } from './extract.mjs';
import { fetchSmart, fetchText } from './fetch.mjs';
import { detectModel, detectCondition, isAccessory, isOtherSize, priceOk, shopFromUrl, parsePrice } from './match.mjs';

const BUNDLE_RE = /\s\+\s|\bbundel|\bbundle|\bset met\b|\binclusief soundbar|\bmet soundbar|\b(DS|S|SG|SC|US)\d{2,3}[A-Z]{1,3}\b/i;
const AGGREGATOR_RE = /vergelijk|prijs|price|compare|kompas|shopper|beste|knibble|tvpedia|kieskeurig|tweakers|beslist|pricedog|kelkoo|dagaanbieding|supersales/i;
export const isAggregatorUrl = (u) => { try { return AGGREGATOR_RE.test(new URL(u).hostname); } catch { return false; } };

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

const IN_STOCK_RE = /instock|limitedavailability|onlineonly|preorder|backorder/i;

/** Turn a fetched product page into normalized offers. */
export function offersFromPage({ html, url, seed = {}, shopName, source = 'page' }) {
  const { title, offers, oldPrice } = extractOffers(html, url);
  const pageText = `${title} ${url}`;
  if (isAccessory(title) && !detectModel(title)) return [];
  const detected = detectModel(title) || detectModel(url);
  const model = detected || seed.model;
  if (!model) return [];
  if (!detected && isOtherSize(pageText)) return [];

  const baseShop = shopName || shopFromUrl(url);
  const out = [];
  for (const o of offers) {
    if (o.currency && o.currency !== 'EUR') continue;
    const name = decodeEntities(o.name || title);
    if (o.name && isAccessory(o.name) && !detectModel(o.name)) continue;
    // Variants on one page (e.g. 77" and 83"): each offer must match the model and size itself.
    const offerModel = detectModel(name);
    if (isOtherSize(name) && !offerModel) continue;
    if (offerModel && offerModel !== model) continue;
    // Price-comparison sites often mislabel itemCondition; only trust keywords there.
    const condition = seed.condition || detectCondition(`${name} ${url} ${o.seller || ''}`, seed.aggregator ? '' : o.condition);
    if (!priceOk(o.price, condition)) continue;
    let shop = baseShop;
    const norm = (x) => String(x).toLowerCase().replace(/\.(nl|com|be)\b/g, '').replace(/[^a-z0-9]/g, '');
    if (o.seller && !/^(coolblue|mediamarkt|bol|bol\.com|amazon)/i.test(o.seller) && o.seller.length < 40) {
      const same = norm(o.seller).includes(norm(baseShop)) || norm(baseShop).includes(norm(o.seller));
      shop = seed.aggregator ? `${o.seller} via ${baseShop}` : same ? o.seller : `${o.seller} (${baseShop})`;
    }
    if (seed.aggregator && !o.seller) shop = `${o.aggregate ? 'Laagste' : 'Beste'} via ${baseShop}`;
    out.push({
      model,
      shop,
      title: name.slice(0, 140),
      bundle: BUNDLE_RE.test(name) || undefined,
      price: Math.round(o.price * 100) / 100,
      oldPrice: oldPrice && oldPrice > o.price * 1.01 && oldPrice < o.price * 1.8 ? oldPrice : null,
      condition,
      url: o.url && !seed.aggregator ? o.url : url,
      inStock: o.availability ? IN_STOCK_RE.test(o.availability) : null,
      source: `${source}:${o.method}`,
      aggregator: !!seed.aggregator,
      lowConfidence: !!o.lowConfidence,
    });
  }
  // One page can emit the same offer twice (JSON-LD + variants): keep the cheapest per shop/condition.
  const best = new Map();
  for (const o of out) {
    const k = `${o.shop}|${o.condition}|${o.model}`;
    if (!best.has(k) || best.get(k).price > o.price) best.set(k, o);
  }
  return [...best.values()];
}

export async function scrapeProductPage(seed, opts = {}) {
  const { body, url } = await fetchSmart(seed.url, {
    browserFirst: seed.browser,
    needs: (b) => b.includes('ld+json') || b.includes('itemprop="price"') || b.includes('"price"'),
    ...opts,
  });
  return offersFromPage({ html: body, url, seed, shopName: seed.shop, source: seed.source || 'seed' });
}

/** Search a shop and follow matching product links. */
export async function scrapeSearch(cfg, query, { maxFollow = 4, visited } = {}) {
  const url = cfg.url.replace('{q}', encodeURIComponent(query));
  const { body, url: finalUrl } = await fetchSmart(url, { browserFirst: cfg.browser });
  // Sometimes a search redirects straight to a product page
  if (cfg.link.test(finalUrl) && finalUrl !== url) {
    return offersFromPage({ html: body, url: finalUrl, seed: cfg, source: 'search' });
  }
  const links = extractLinks(body, finalUrl, (href, text) => {
    if (!cfg.link.test(href)) return false;
    let path = href;
    try { path = decodeURIComponent(href); } catch {}
    // Link texts are marketing copy ("tv met golvende standaard"), so check accessories on the URL.
    return !!detectModel(`${text} ${path}`) && !isAccessory(path);
  })
    .filter((l) => !visited?.has(l.url.split('?')[0]))
    .slice(0, maxFollow);
  if (process.env.DEBUG_SOURCES && !links.length) {
    const t = (body.match(/<title[^>]*>([^<]*)/i) || [])[1] || '';
    const any = extractLinks(body, finalUrl, (h) => cfg.link.test(h)).slice(0, 3).map((l) => `${l.text.slice(0, 40)} → ${l.url.slice(0, 80)}`);
    console.log(`    [search] ${cfg.shop} "${query}": 0 matches; ${body.length}b title="${t.trim().slice(0, 60)}" productLinks=${JSON.stringify(any)}`);
  }
  const all = [];
  for (const l of links) {
    visited?.add(l.url.split('?')[0]);
    try {
      const r = await fetchSmart(l.url, { browserFirst: cfg.browser });
      all.push(
        ...offersFromPage({
          html: r.body,
          url: r.url,
          seed: { model: detectModel(l.text) || detectModel(l.url), condition: cfg.condition, aggregator: cfg.aggregator },
          source: 'search',
        }),
      );
    } catch (e) {
      // individual product failures are fine
    }
  }
  return all;
}

/** Marktplaats public search API. */
export async function scrapeMarktplaats(query) {
  const api = `https://www.marktplaats.nl/lrp/api/search?query=${encodeURIComponent(query)}&limit=50&offset=0&sortBy=SORT_INDEX&sortOrder=DECREASING`;
  const { body } = await fetchText(api, { accept: 'application/json', headers: { Referer: 'https://www.marktplaats.nl/' } });
  const data = JSON.parse(body);
  const out = [];
  out.raw = (data.listings || []).length;
  if (process.env.DEBUG_SOURCES)
    for (const l of (data.listings || []).slice(0, 6))
      console.log(`    [mp] ${JSON.stringify(l.priceInfo)} ${String(l.title).slice(0, 70)} | model=${detectModel(l.title)}`);
  for (const l of data.listings || []) {
    const text = `${l.title} ${l.description || ''}`;
    const model = detectModel(l.title) || detectModel(text);
    if (!model) continue;
    if (isAccessory(l.title)) continue;
    if (isOtherSize(l.title)) continue;
    const pi = l.priceInfo || {};
    if (['SEE_DESCRIPTION', 'RESERVED', 'EXCHANGE', 'FREE', 'ON_REQUEST'].includes(pi.priceType) || !pi.priceCents) continue;
    const price = pi.priceCents / 100;
    if (!priceOk(price, 'used')) continue;
    out.push({
      model,
      shop: 'Marktplaats',
      title: l.title.slice(0, 140),
      price,
      oldPrice: null,
      condition: 'used',
      url: l.vipUrl ? `https://www.marktplaats.nl${l.vipUrl}` : `https://www.marktplaats.nl/v/${l.itemId}`,
      inStock: true,
      source: 'marktplaats:api',
      location: l.location?.cityName || null,
      priceType: pi.priceType === 'BID_FROM' ? 'bieden vanaf' : null,
      image: l.pictures?.[0]?.mediumUrl || null,
      listedAt: l.date || null,
    });
  }
  return out;
}

/** DuckDuckGo (html) + Bing web search, returns result URLs. */
export async function webSearch(query) {
  const urls = new Set();
  const engines = [
    {
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=nl-nl`,
      pick: (html) =>
        extractLinks(html, 'https://html.duckduckgo.com/', (h) => h.includes('uddg=') || /^https?:\/\/(?!.*duckduckgo)/.test(h)).map((l) => {
          try {
            const u = new URL(l.url);
            return u.searchParams.get('uddg') || l.url;
          } catch {
            return l.url;
          }
        }),
    },
    {
      url: `https://www.bing.com/search?q=${encodeURIComponent(query)}&cc=NL&setlang=nl&count=30`,
      pick: (html) => extractLinks(html, 'https://www.bing.com/', (h) => /^https?:\/\/(?!.*(bing|microsoft|msn)\.)/.test(h)).map((l) => l.url),
    },
  ];
  for (const e of engines) {
    try {
      const { body } = await fetchText(e.url, { retries: 0, timeout: 15000 });
      for (const u of e.pick(body)) if (/^https?:/.test(u)) urls.add(u);
    } catch (err) {
      // engine blocked, try the next one
    }
  }
  return [...urls];
}

export { parsePrice };
