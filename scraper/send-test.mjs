// Sends a test notification to all subscribed devices (used by push-test.yml).
import { readFile } from 'node:fs/promises';
import { buildDailyMessage, sendAll } from './notify.mjs';

let deals = {};
try { deals = JSON.parse(await readFile(new URL('../data/deals.json', import.meta.url), 'utf8')); } catch {}
const msg = buildDailyMessage(deals);
msg.title = '✅ Test · ' + msg.title;
msg.tag = 'test';
const r = await sendAll(msg);
console.log(r);
if (!r.webpush && !r.ntfy) {
  console.error('Nothing was delivered. Enable push in the app (Settings → Enable push) first.');
  process.exit(1);
}
