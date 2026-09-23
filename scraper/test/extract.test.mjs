import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, detectModel, detectCondition, isAccessory, priceOk, shopFromUrl } from '../lib/match.mjs';
import { offersFromPage } from '../lib/sources.mjs';

test('parsePrice handles Dutch and English formats', () => {
  assert.equal(parsePrice('€ 4.999,-'), 4999);
  assert.equal(parsePrice('4.999,00'), 4999);
  assert.equal(parsePrice('4999.00'), 4999);
  assert.equal(parsePrice('4,999.95'), 4999.95);
  assert.equal(parsePrice('4,999'), 4999);
  assert.equal(parsePrice('3499,95'), 3499.95);
  assert.equal(parsePrice(4299), 4299);
  assert.equal(parsePrice('n.v.t.'), null);
});

test('detectModel finds G4/G5/G6 83 inch', () => {
  assert.equal(detectModel('LG OLED83G45LW (2024)'), 'G4');
  assert.equal(detectModel('LG 83" OLED EVO G55 4K (2025)'), 'G5');
  assert.equal(detectModel('LG OLED EVO 83" G6 (2026)'), 'G6');
  assert.equal(detectModel('https://www.coolblue.nl/product/977589/lg-oled-evo-83-g6-2026.html'), 'G6');
  assert.equal(detectModel('LG G5 OLED83G55LW - 83 inch 4K OLED evo'), 'G5');
  assert.equal(detectModel('lg oled 83 g4 als nieuw'), 'G4');
  assert.equal(detectModel('LG OLED65G45LW'), null);
  assert.equal(detectModel('LG 83" OLED C4'), null);
  assert.equal(detectModel('LG OLED 83 B6 (2026)'), null);
});

test('condition + accessory detection', () => {
  assert.equal(detectCondition('LG OLED83G45LW Tweedekans'), 'refurbished');
  assert.equal(detectCondition('x', 'https://schema.org/RefurbishedCondition'), 'refurbished');
  assert.equal(detectCondition('LG G5 gebruikt'), 'used');
  assert.equal(detectCondition('LG OLED83G55LW'), 'new');
  assert.ok(isAccessory('LG WB25EGB muurbeugel voor G5'));
  assert.ok(!isAccessory('LG OLED83G55LW 83 inch'));
  assert.ok(priceOk(4299) && !priceOk(129) && !priceOk(49.99, 'used'));
  assert.equal(shopFromUrl('https://www.coolblue.nl/product/1'), 'Coolblue');
  assert.equal(shopFromUrl('https://shop.example-tv.nl/x'), 'Example-tv');
});

const jsonld = (obj) => `<html><head><title>t</title><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body><h1>x</h1></body></html>`;

test('JSON-LD Offer on a shop page', () => {
  const html = jsonld({ '@context': 'https://schema.org', '@type': 'Product', name: 'LG OLED83G55LW (2025)', offers: { '@type': 'Offer', price: '4299.00', priceCurrency: 'EUR', availability: 'https://schema.org/InStock' } });
  const o = offersFromPage({ html, url: 'https://www.coolblue.nl/product/963239/x.html' });
  assert.equal(o.length, 1);
  assert.deepEqual([o[0].model, o[0].shop, o[0].price, o[0].condition, o[0].inStock], ['G5', 'Coolblue', 4299, 'new', true]);
});

test('JSON-LD @graph with refurbished condition + old price', () => {
  const html = jsonld({ '@graph': [{ '@type': 'WebPage' }, { '@type': 'Product', name: 'LG OLED 83" G4', offers: [{ '@type': 'Offer', price: 3349, priceCurrency: 'EUR', itemCondition: 'https://schema.org/RefurbishedCondition' }] }] })
    .replace('<body>', '<body><span class="price--old">€ 3.999,-</span>');
  const o = offersFromPage({ html, url: 'https://www.example.nl/p/1' });
  assert.equal(o[0].condition, 'refurbished');
  assert.equal(o[0].oldPrice, 3999);
});

test('AggregateOffer on aggregator, marketplace sellers, accessories rejected', () => {
  const agg = jsonld({ '@type': 'Product', name: 'LG OLED83G45LW 2024', offers: { '@type': 'AggregateOffer', lowPrice: '3833.48', highPrice: '5299', offerCount: 12, priceCurrency: 'EUR' } });
  const a = offersFromPage({ html: agg, url: 'https://knibble.nl/tv/lg/oled83g45lw-2024', seed: { model: 'G4', aggregator: true } });
  assert.equal(a[0].shop, 'Laagste via Knibble');
  assert.equal(a[0].price, 3833.48);

  const multi = jsonld({ '@type': 'Product', name: 'LG OLED83G68LW', offers: [
    { '@type': 'Offer', price: 5199, priceCurrency: 'EUR', seller: { name: 'TVshop BV' } },
    { '@type': 'Offer', price: 5299, priceCurrency: 'EUR', seller: { name: 'bol' } } ] });
  const m = offersFromPage({ html: multi, url: 'https://www.bol.com/nl/nl/p/x/1/' });
  assert.deepEqual(m.map((x) => x.shop).sort(), ['TVshop BV (bol)', 'bol']);

  const acc = jsonld({ '@type': 'Product', name: 'LG WB22EGB muurbeugel', offers: { price: 129, priceCurrency: 'EUR' } });
  assert.equal(offersFromPage({ html: acc, url: 'https://x.nl/a', seed: { model: 'G5' } }).length, 0);
});

test('microdata + meta + state fallbacks', () => {
  const micro = '<html><h1>LG OLED83G67LW</h1><div itemscope itemtype="https://schema.org/Offer"><meta itemprop="price" content="4799.00"><meta itemprop="priceCurrency" content="EUR"></div></html>';
  assert.equal(offersFromPage({ html: micro, url: 'https://www.plasmavisie.nl/lg-oled83g67lw' })[0].price, 4799);
  const meta = '<html><head><meta property="og:title" content="LG OLED83G45LW"><meta property="product:price:amount" content="3999"></head></html>';
  assert.equal(offersFromPage({ html: meta, url: 'https://s.nl/x' })[0].price, 3999);
  const state = '<html><title>LG OLED83G55LW</title><script>window.__S={"price":4599,"x":{"price":4599},"price":19}</script></html>';
  const s = offersFromPage({ html: state, url: 'https://s.nl/y' });
  assert.equal(s[0].price, 4599);
  assert.ok(s[0].lowConfidence);
});

test('size variants on one page, bundles, aggregator condition, entities', () => {
  const variants = jsonld({ '@type': 'ProductGroup', name: 'LG OLED evo G6 (2026)', hasVariant: [
    { '@type': 'Product', name: 'LG OLED83G67LW 83 inch', offers: { price: 4799, priceCurrency: 'EUR' } },
    { '@type': 'Product', name: 'LG Evo AI 77G67LW - 77 inch', offers: { price: 3499, priceCurrency: 'EUR' } } ] });
  const v = offersFromPage({ html: variants, url: 'https://www.mediamarkt.nl/nl/product/x.html', seed: { model: 'G6' } });
  assert.deepEqual(v.map((o) => o.price), [4799]);

  const bundle = jsonld({ '@type': 'Product', name: 'LG OLED 83" G6 (2026) + LG DS95TR', offers: { price: 5389, priceCurrency: 'EUR' } });
  assert.equal(offersFromPage({ html: bundle, url: 'https://www.coolblue.nl/product/985912/x.html' })[0].bundle, true);

  const agg = jsonld({ '@type': 'Product', name: 'LG OLED83G67LW &#8211; 83” OLED EVO (2026)', offers: { price: 5499, priceCurrency: 'EUR', itemCondition: 'https://schema.org/UsedCondition' } });
  const a = offersFromPage({ html: agg, url: 'https://www.pricedog.nl/product/x', seed: { aggregator: true } });
  assert.equal(a[0].condition, 'new');
  assert.ok(a[0].title.includes('–'));

  const sm = jsonld({ '@type': 'Product', name: '83G45LW', offers: { price: 3199, priceCurrency: 'EUR', seller: { name: 'Smits Arnhem' } } });
  assert.equal(offersFromPage({ html: sm, url: 'https://www.smitsarnhem.nl/83g45lw' })[0].shop, 'Smits Arnhem');
});
