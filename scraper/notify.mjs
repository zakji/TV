// Push delivery: Web Push (VAPID) to the installed iPhone PWA, plus optional ntfy.sh.

const eur = (n) => '€' + Math.round(n).toLocaleString('nl-NL');

export function buildDailyMessage(deals) {
  const lines = [];
  let top = null;
  for (const m of ['G4', 'G5', 'G6']) {
    const b = deals.best?.[m];
    if (!b) continue;
    const parts = [];
    if (b.new) parts.push(`${eur(b.new.price)} ${b.new.shop}`);
    const second = [b.refurbished, b.used].filter(Boolean).sort((a, c) => a.price - c.price)[0];
    if (second) parts.push(`2nd chance ${eur(second.price)}`);
    if (parts.length) lines.push(`${m}: ${parts.join(' · ')}`);
    const cands = [b.new, second].filter(Boolean);
    for (const c of cands) if (!top || c.price < top.price) top = c;
  }
  return {
    title: top ? `OLED//HUNT · ${top.model} from ${eur(top.price)}` : 'OLED//HUNT · daily scan',
    body: lines.join('\n') || 'No prices found today. Open the app to see the status of each source.',
    url: './',
    tag: 'daily',
  };
}

export async function sendAll(message, { log = console.log } = {}) {
  const results = { webpush: 0, webpushFailed: 0, ntfy: false, expired: [] };

  // --- Web Push
  const subsRaw = process.env.PUSH_SUBSCRIPTIONS;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (subsRaw && pub && priv) {
    let subs = [];
    try {
      subs = JSON.parse(subsRaw);
      if (!Array.isArray(subs)) subs = [subs];
    } catch {
      log('  push: PUSH_SUBSCRIPTIONS is not valid JSON');
    }
    const webpush = (await import('web-push')).default;
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:oled-hunt@example.com', pub, priv);
    for (const s of subs) {
      try {
        await webpush.sendNotification(s, JSON.stringify(message), { TTL: 60 * 60 * 6, urgency: 'high' });
        results.webpush++;
      } catch (e) {
        results.webpushFailed++;
        if (e.statusCode === 404 || e.statusCode === 410) results.expired.push(s.endpoint);
        log(`  push: failed (${e.statusCode || e.message})`);
      }
    }
  } else {
    log('  push: web push not configured (VAPID keys / subscriptions missing)');
  }

  // --- ntfy.sh (optional, free iOS app)
  const topic = (process.env.NTFY_TOPIC || '').trim().replace(/^-$/, '');
  if (topic) {
    try {
      const server = process.env.NTFY_SERVER || 'https://ntfy.sh';
      const res = await fetch(`${server}/${encodeURIComponent(topic)}`, {
        method: 'POST',
        body: message.body,
        headers: {
          Title: message.title.replace(/[^\x20-\x7E]/g, ''),
          Tags: 'tv,moneybag',
          ...(process.env.APP_URL ? { Click: process.env.APP_URL } : {}),
        },
      });
      results.ntfy = res.ok;
    } catch (e) {
      log('  ntfy failed: ' + e.message);
    }
  }
  return results;
}

