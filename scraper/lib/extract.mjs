// Generic structured-data price extraction. Works on most shop product pages
// because they embed schema.org Product/Offer data for Google Shopping.
import * as cheerio from 'cheerio';
import { parsePrice } from './match.mjs';

function tryJson(txt) {
  try {
    return JSON.parse(txt);
  } catch {
    // Some shops put several objects or trailing commas / HTML comments in the block
    try {
      const cleaned = txt.replace(/<!--|-->/g, '').replace(/,\s*([}\]])/g, '$1').trim();
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

function* walk(node, depth = 0) {
  if (!node || depth > 12) return;
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  yield node;
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === 'object') yield* walk(v, depth + 1);
  }
}

const typeIs = (node, t) => {
  const ty = node['@type'];
  return Array.isArray(ty) ? ty.some((x) => String(x).toLowerCase() === t) : String(ty || '').toLowerCase() === t;
};

function offerList(offers) {
  if (!offers) return [];
  return Array.isArray(offers) ? offers : [offers];
}

function readOffer(o, product, pageUrl) {
  const out = [];
  if (!o || typeof o !== 'object') return out;
  if (typeIs(o, 'aggregateoffer')) {
    const inner = offerList(o.offers);
    if (inner.length) for (const i of inner) out.push(...readOffer(i, product, pageUrl));
    const low = parsePrice(o.lowPrice ?? o.price);
    if (low != null && !inner.length)
      out.push({ price: low, highPrice: parsePrice(o.highPrice), offerCount: o.offerCount, aggregate: true, currency: o.priceCurrency || 'EUR' });
    return out;
  }
  let price = parsePrice(o.price ?? o.lowPrice);
  if (price == null && o.priceSpecification) {
    const specs = offerList(o.priceSpecification);
    for (const s of specs) {
      const p = parsePrice(s.price);
      if (p != null && (price == null || p < price)) price = p;
    }
  }
  if (price == null) return out;
  const seller = o.seller?.name || o.offeredBy?.name || (typeof o.seller === 'string' ? o.seller : null);
  out.push({
    price,
    currency: o.priceCurrency || 'EUR',
    availability: String(o.availability || ''),
    condition: String(o.itemCondition || ''),
    seller,
    url: o.url && typeof o.url === 'string' ? new URL(o.url, pageUrl).href : null,
  });
  return out;
}

/**
 * Extract product offers from an HTML page.
 * Returns { title, offers: [{price, currency, availability, condition, seller, url, aggregate}], method }
 */
export function extractOffers(html, pageUrl) {
  const $ = cheerio.load(html);
  const title =
    $('meta[property="og:title"]').attr('content') || $('h1').first().text().trim() || $('title').text().trim() || '';
  const results = [];
  let productName = null;

  // 1) JSON-LD
  $('script[type="application/ld+json"]').each((_, el) => {
    const data = tryJson($(el).contents().text());
    if (!data) return;
    for (const node of walk(data)) {
      if (typeIs(node, 'product') || typeIs(node, 'productgroup')) {
        productName = productName || node.name;
        for (const o of offerList(node.offers)) {
          for (const r of readOffer(o, node, pageUrl)) results.push({ ...r, name: node.name, method: 'jsonld' });
        }
        // ProductGroup variants
        for (const v of offerList(node.hasVariant)) {
          for (const o of offerList(v?.offers)) for (const r of readOffer(o, v, pageUrl)) results.push({ ...r, name: v.name, method: 'jsonld' });
        }
      }
    }
  });

  // 2) Microdata
  if (!results.length) {
    $('[itemtype*="schema.org/Offer"], [itemtype*="schema.org/AggregateOffer"]').each((_, el) => {
      const $el = $(el);
      const p = $el.find('[itemprop="price"],[itemprop="lowPrice"]').first();
      const price = parsePrice(p.attr('content') ?? p.text());
      if (price != null)
        results.push({
          price,
          currency: $el.find('[itemprop="priceCurrency"]').attr('content') || 'EUR',
          availability: $el.find('[itemprop="availability"]').attr('href') || $el.find('[itemprop="availability"]').attr('content') || '',
          condition: $el.find('[itemprop="itemCondition"]').attr('href') || '',
          method: 'microdata',
        });
    });
    if (!results.length) {
      const p = $('[itemprop="price"]').first();
      const price = parsePrice(p.attr('content') ?? p.text());
      if (price != null) results.push({ price, currency: 'EUR', method: 'microdata' });
    }
  }

  // 3) Meta tags (Open Graph / product)
  if (!results.length) {
    const meta =
      $('meta[property="product:price:amount"]').attr('content') ||
      $('meta[property="og:price:amount"]').attr('content') ||
      $('meta[itemprop="price"]').attr('content') ||
      $('meta[name="twitter:data1"]').attr('content');
    const price = parsePrice(meta);
    if (price != null) results.push({ price, currency: 'EUR', method: 'meta' });
  }

  // 4) Embedded state JSON: "price":4999 / "salesPrice":{"value":4999}
  if (!results.length) {
    const found = new Map();
    const re = /"(?:price|salesPrice|sellingPrice|currentPrice|finalPrice|priceAmount)"\s*:\s*\{?\s*(?:"(?:value|amount)"\s*:\s*)?"?(\d{3,5}(?:[.,]\d{1,2})?)"?/g;
    let m;
    while ((m = re.exec(html))) {
      const p = parsePrice(m[1]);
      if (p) found.set(p, (found.get(p) || 0) + 1);
    }
    const best = [...found.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    if (best) results.push({ price: best[0], currency: 'EUR', method: 'state', lowConfidence: true });
  }

  const oldPrice = extractOldPrice($, html);
  return { title: (productName || title).replace(/\s+/g, ' ').trim(), offers: results, oldPrice, $ };
}

function extractOldPrice($, html) {
  const cands = [
    $('[itemprop="highPrice"]').attr('content'),
    $('meta[property="product:original_price:amount"]').attr('content'),
    $('[class*="strikethrough"],[class*="old-price"],[class*="oldPrice"],[class*="price--old"],[class*="was-price"],[class*="from-price"],del,s').first().text(),
  ];
  const m = html.match(/"(?:listPrice|originalPrice|strikePrice|wasPrice|crossedPrice|regularPrice)"\s*:\s*\{?\s*(?:"(?:value|amount)"\s*:\s*)?"?(\d{3,5}(?:[.,]\d{1,2})?)/);
  if (m) cands.push(m[1]);
  for (const c of cands) {
    const p = parsePrice(c);
    if (p && p > 1000) return p;
  }
  return null;
}

/** Collect absolute links from a page, optionally filtered by a predicate on (href, text). */
export function extractLinks(html, pageUrl, pred = () => true) {
  const $ = cheerio.load(html);
  const out = new Map();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
    let abs;
    try {
      abs = new URL(href, pageUrl).href.split('#')[0];
    } catch {
      return;
    }
    const text = $(el).text().replace(/\s+/g, ' ').trim() || $(el).attr('title') || $(el).attr('aria-label') || '';
    if (pred(abs, text) && !out.has(abs)) out.set(abs, text);
  });
  return [...out.entries()].map(([url, text]) => ({ url, text }));
}
