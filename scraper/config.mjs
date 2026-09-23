// Where to look. Add URLs here any time: the extractor is generic, so most
// Dutch shops work without custom code (they embed schema.org JSON-LD).

// Known product pages (seed URLs). Condition is auto-detected, but can be forced.
export const PRODUCT_PAGES = [
  // ---- Coolblue
  { url: 'https://www.coolblue.nl/product/946209/lg-oled83g45lw-2024.html', model: 'G4' },
  { url: 'https://www.coolblue.nl/product/963239/lg-83-oled-evo-g55-4k-2025.html', model: 'G5' },
  { url: 'https://www.coolblue.nl/product/977589/lg-oled-evo-83-g6-2026.html', model: 'G6' },
  // ---- MediaMarkt
  { url: 'https://www.mediamarkt.nl/nl/product/_lg-oled83g45lwaeu-2024-1807467.html', model: 'G4' },
  { url: 'https://www.mediamarkt.nl/nl/product/_lg-oled83g55lwaeu-2025-1880622.html', model: 'G5' },
  { url: 'https://www.mediamarkt.nl/nl/product/_lg-oled-evo-ai-oled83g55lw-2025-154831333.html', model: 'G5' },
  // ---- bol
  { url: 'https://www.bol.com/nl/nl/p/lg-g5-oled83g55lw-83-inch-4k-oled-evo-2025/9300000229413531/', model: 'G5' },
  // ---- LG
  { url: 'https://www.lg.com/nl/televisies-soundbars/oled-evo/oled83g55lw/', model: 'G5' },
  { url: 'https://www.lg.com/nl/televisies-soundbars/oled-evo/oled83g68lw/', model: 'G6' },
  { url: 'https://www.lg.com/nl/televisies-soundbars/oled-evo/oled83g67lw/', model: 'G6' },
  // ---- Specialists
  { url: 'https://www.hellotv.nl/product/lg-oled83g45lw-2024', model: 'G4' },
  { url: 'https://www.hellotv.nl/product/lg-oled-evo-83g55lw-2025', model: 'G5' },
  { url: 'https://www.vanhunen.nl/product/lg-oled83g45lw/', model: 'G4' },
  { url: 'https://www.tvspecialisten.nl/lg-oled83g45lw', model: 'G4' },
  { url: 'https://www.ovitshop.nl/product/lg-oled83g45lw-4k-smart-oled-tv-83-inch/', model: 'G4' },
  { url: 'https://www.plasmavisie.nl/lg-oled83g68lw', model: 'G6' },
  { url: 'https://www.plasmavisie.nl/lg-oled83g67lw', model: 'G6' },
  // ---- Aggregators (lowest price across many shops)
  { url: 'https://knibble.nl/tv/lg/oled83g45lw-2024', model: 'G4', aggregator: true },
  { url: 'https://tvpedia.nl/televisie/lg-oled83g45lw-2024/', model: 'G4', aggregator: true },
  { url: 'https://www.vergelijk.nl/televisies/lg/oled83g45lw_2024_750627242/', model: 'G4', aggregator: true },
];

// Search pages: product links on the result page that match an 83" G4/G5/G6 are followed.
// {q} is replaced with each query below.
export const SEARCH_QUERIES = ['OLED83G4', 'OLED83G5', 'OLED83G6', 'LG OLED 83 G5', 'LG OLED 83 G6'];

export const SEARCH_PAGES = [
  { shop: 'Coolblue', url: 'https://www.coolblue.nl/zoeken?query={q}', link: /coolblue\.nl\/product\/\d+/ },
  { shop: 'Coolblue Tweedekans', url: 'https://www.coolblue.nl/tweedekans?query={q}', link: /coolblue\.nl\/(tweedekans|product)\//, condition: 'refurbished' },
  { shop: 'MediaMarkt', url: 'https://www.mediamarkt.nl/nl/search.html?query={q}', link: /mediamarkt\.nl\/nl\/product\//, browser: true },
  { shop: 'bol', url: 'https://www.bol.com/nl/nl/s/?searchtext={q}', link: /bol\.com\/nl\/nl\/p\//, browser: true },
  { shop: 'Amazon.nl', url: 'https://www.amazon.nl/s?k={q}', link: /amazon\.nl\/.*\/dp\/[A-Z0-9]{10}/, browser: true },
  { shop: 'Expert', url: 'https://www.expert.nl/zoeken?q={q}', link: /expert\.nl\/.+/ },
  { shop: 'EP', url: 'https://www.ep.nl/zoeken/?q={q}', link: /ep\.nl\/.+/ },
  { shop: 'BCC', url: 'https://www.bcc.nl/search?q={q}', link: /bcc\.nl\/.+/ },
  { shop: 'HelloTV', url: 'https://www.hellotv.nl/zoeken?q={q}', link: /hellotv\.nl\/product\// },
  { shop: 'Tweakers', url: 'https://tweakers.net/pricewatch/zoeken/?keyword={q}', link: /tweakers\.net\/pricewatch\/\d+\//, browser: true, aggregator: true },
  { shop: 'Kieskeurig', url: 'https://www.kieskeurig.nl/search?q={q}', link: /kieskeurig\.nl\/.+\/product\//, aggregator: true },
];

// Web discovery. Every result URL on an allowed (Dutch) domain is fetched and parsed.
export const DISCOVERY_QUERIES = [
  'OLED83G45LW prijs',
  'OLED83G55LW prijs',
  'OLED83G68LW prijs',
  'OLED83G67LW prijs',
  'LG OLED 83 G5 tweedekans',
  'LG OLED 83 G4 refurbished',
  'LG OLED83G6 aanbieding',
];
export const DISCOVERY_ALLOW = /\.(nl|com|be)\//;
export const DISCOVERY_DENY =
  /(youtube|reddit|facebook|instagram|twitter|x\.com|wikipedia|rtings|lg\.com\/(?!nl)|\.co\.uk|\.de\/|\.fr\/|\.be\/fr|forum|review|nieuws|news|kitele|slickdeals|ebay\.(?!nl))/i;

// Marktplaats (2nd-hand). Public JSON API used by their own site.
export const MARKTPLAATS_QUERIES = ['lg oled 83 g4', 'lg oled 83 g5', 'lg oled 83 g6', 'oled83g4', 'oled83g5', 'oled83g6'];
