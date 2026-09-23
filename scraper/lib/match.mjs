// Model detection, condition detection and price parsing helpers.

export const MODELS = {
  G4: { name: 'LG OLED evo G4 83"', year: 2024, codes: ['OLED83G45LW', 'OLED83G44LW', 'OLED83G48LW', 'OLED83G4'] },
  G5: { name: 'LG OLED evo G5 83"', year: 2025, codes: ['OLED83G55LW', 'OLED83G54LW', 'OLED83G56LW', 'OLED83G5'] },
  G6: { name: 'LG OLED evo G6 83"', year: 2026, codes: ['OLED83G68LW', 'OLED83G67LW', 'OLED83G65LW', 'OLED83G6'] },
};

// Sane price windows (EUR). Anything outside is almost certainly an accessory,
// a monthly lease price or a parsing error.
export const PRICE_RANGE = {
  new: [1800, 9500],
  refurbished: [1200, 9500],
  used: [700, 9500],
};

const ACCESSORY_RE =
  /\b(muurbeugel|wandbeugel|beugel|wall\s?mount|wandhouder|voet|tv[-\s]?standaard|floor\s?stand|standaard\b|stand\b|afstandsbediening|remote|kabel|cable|hoes|cover|screen\s?protector|schermbeschermer|soundbar(?!.*\btv\b)|onderdeel|spare|reparatie|defect|kapot|panel only|moederbord|mainboard|t-con|voeding|power\s?board|backlight)\b/i;
const OTHER_SIZE_RE = /\b(42|48|55|65|77|97)\s?(?:"|”|''|inch|in\b|-?inch|g[4-6])|oled(42|48|55|65|77|97)g/i;

/** Returns 'G4' | 'G5' | 'G6' | null for a free-text title/url. */
export function detectModel(text) {
  if (!text) return null;
  const t = String(text).toUpperCase().replace(/[\s_\-.\/]+/g, ' ');
  // Explicit model code: OLED83G55LW, OLED 83 G5, 83G55LW
  let m = t.match(/OLED ?83 ?G ?([456])\d?/);
  if (m) return 'G' + m[1];
  m = t.match(/\b83 ?G([456])\d?(?: ?LW| ?LA| ?\b)/);
  if (m) return 'G' + m[1];
  // "LG OLED evo 83" G5", "83 inch ... G6", "G5 83 inch"
  const has83 = /\b83\b|\b83(?:"|”|INCH|IN\b)|211 ?CM|210 ?CM/.test(t) || /\b83 ?(?:INCH|"|”)/.test(t);
  const isLG = /\bLG\b|OLED/.test(t);
  if (has83 && isLG) {
    m = t.match(/\bG([456])\d?\b/);
    if (m) return 'G' + m[1];
  }
  return null;
}

export function isAccessory(text) {
  return ACCESSORY_RE.test(text || '');
}

export function isOtherSize(text) {
  if (!text) return false;
  // Only reject when there is a size mention and 83 is not present at all.
  return OTHER_SIZE_RE.test(text) && !/\b83\b|OLED83/i.test(text);
}

/** Detect condition from text: new | refurbished | used */
export function detectCondition(text, schemaCondition) {
  const s = String(schemaCondition || '').toLowerCase();
  if (s.includes('refurb') || s.includes('damaged')) return 'refurbished';
  if (s.includes('used')) return 'used';
  const t = String(text || '').toLowerCase();
  if (/tweede\s?kans|tweedekans|2e\s?kans|2de\s?kans|second\s?chance|refurb|outlet|b-?grade|b-?keus|b-?stock|retour|showmodel|demo(model)?|open\s?box|ex-?display|licht beschadigd|zo goed als nieuw/.test(t))
    return 'refurbished';
  if (/gebruikt|tweedehands|2e\s?hands|2dehands|occasion|marktplaats/.test(t)) return 'used';
  return 'new';
}

/** Parse Dutch/English price strings or numbers to a float in EUR. */
export function parsePrice(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(/[€\s]|EUR|euro/gi, '').replace(/,-+$/, '').replace(/\.-+$/, '');
  if (!/\d/.test(s)) return null;
  // Keep digits, dot, comma
  s = s.replace(/[^\d.,]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Whichever comes last is the decimal separator
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // "4999,00" decimal or "4,999" thousands
    const dec = s.length - lastComma - 1;
    s = dec === 3 && s.split(',').length === 2 && s.indexOf(',') > 0 && s.length > 4 ? s.replace(',', '') : s.replace(/,/g, '.');
  } else if (lastDot > -1) {
    const dec = s.length - lastDot - 1;
    if (dec === 3 || s.split('.').length > 2) s = s.replace(/\./g, ''); // 4.999 -> 4999
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function priceOk(price, condition = 'new') {
  const [lo, hi] = PRICE_RANGE[condition] || PRICE_RANGE.new;
  return typeof price === 'number' && price >= lo && price <= hi;
}

export function shopFromUrl(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    const known = {
      'coolblue.nl': 'Coolblue', 'mediamarkt.nl': 'MediaMarkt', 'bol.com': 'bol', 'amazon.nl': 'Amazon.nl',
      'lg.com': 'LG.com', 'expert.nl': 'Expert', 'ep.nl': 'EP', 'bcc.nl': 'BCC', 'hellotv.nl': 'HelloTV',
      'plasmavisie.nl': 'Plasmavisie', 'vanhunen.nl': 'Van Hunen', 'tvspecialisten.nl': 'TVSpecialisten',
      'ovitshop.nl': 'Ovitshop', 'artencraft.nl': 'Art & Craft', 'marktplaats.nl': 'Marktplaats',
      'tweakers.net': 'Tweakers', 'knibble.nl': 'Knibble', 'tvpedia.nl': 'TVPedia', 'kieskeurig.nl': 'Kieskeurig',
      'vergelijk.nl': 'Vergelijk.nl', 'beslist.nl': 'Beslist', 'wehkamp.nl': 'Wehkamp', 'alternate.nl': 'Alternate',
      'megekko.nl': 'Megekko', 'maxict.nl': 'MaxICT', 'supersales.nl': 'Supersales', 'electronicavoorjou.nl': 'Electronicavoorjou',
    };
    for (const [k, v] of Object.entries(known)) if (h === k || h.endsWith('.' + k)) return v;
    const base = h.split('.').slice(-2, -1)[0] || h;
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return 'Unknown';
  }
}
