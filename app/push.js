// Web Push setup: VAPID keys are generated on-device, the private key goes into an
// encrypted GitHub Actions secret, and the subscription into a repository variable.
import { gh } from './github.js';

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
};

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function pushStatus() {
  if (!pushSupported()) return { state: isIOS() && !isStandalone() ? 'install' : 'unsupported' };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return { state: sub ? 'subscribed' : Notification.permission === 'denied' ? 'denied' : 'off', sub };
}

async function ensureVapid(knownPublicKey) {
  let pub = gh.connected ? await gh.getVar('VAPID_PUBLIC_KEY') : knownPublicKey;
  if (pub && gh.connected && !(await gh.hasSecret('VAPID_PRIVATE_KEY'))) pub = null; // half-configured: regenerate
  if (pub) return pub;
  if (!gh.connected) throw new Error('Connect GitHub first (below). The app needs it once to set up push keys.');
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const rawPub = await crypto.subtle.exportKey('raw', kp.publicKey);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  pub = b64u(rawPub);
  await gh.setSecret('VAPID_PRIVATE_KEY', jwk.d);
  await gh.setVar('VAPID_PUBLIC_KEY', pub);
  await gh.setVar('PUSH_SUBSCRIPTIONS', '[]'); // old subscriptions are bound to the old key
  return pub;
}

export async function enablePush(knownPublicKey) {
  if (!pushSupported()) {
    if (isIOS() && !isStandalone()) throw new Error('On iPhone, first add the app to your Home Screen, then open it from there.');
    throw new Error('Push is not supported in this browser.');
  }
  // Must be called from a tap (iOS requirement)
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed. Turn them on in iOS Settings → Notifications → OLED Hunt.');
  const pub = await ensureVapid(knownPublicKey);
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    const cur = sub.options?.applicationServerKey ? b64u(sub.options.applicationServerKey) : null;
    if (cur && cur !== pub) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(pub) });
  const json = sub.toJSON();
  if (gh.connected) {
    let list = [];
    try { list = JSON.parse((await gh.getVar('PUSH_SUBSCRIPTIONS')) || '[]'); } catch {}
    list = [json, ...list.filter((s) => s.endpoint !== json.endpoint)].slice(0, 8);
    await gh.setVar('PUSH_SUBSCRIPTIONS', JSON.stringify(list));
    return { saved: true, sub: json };
  }
  return { saved: false, sub: json };
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  if (gh.connected) {
    let list = [];
    try { list = JSON.parse((await gh.getVar('PUSH_SUBSCRIPTIONS')) || '[]'); } catch {}
    await gh.setVar('PUSH_SUBSCRIPTIONS', JSON.stringify(list.filter((s) => s.endpoint !== endpoint)));
  }
}
