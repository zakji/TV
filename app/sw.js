// OLED//HUNT service worker: offline app shell, fresh data, Web Push.
const VERSION = 'oh-v2';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'chart.js', 'github.js', 'push.js', 'tv3d.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'api.github.com') return; // never cache API calls
  // Data: network first, cache fallback (offline)
  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        if (res.ok) caches.open(VERSION).then((c) => c.put(url.origin + url.pathname, copy));
        return res;
      }).catch(() => caches.match(url.origin + url.pathname)),
    );
    return;
  }
  // App shell + fonts: stale-while-revalidate
  if (url.origin === location.origin || url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com')) {
    e.respondWith(
      caches.open(VERSION).then(async (c) => {
        const hit = await c.match(req, { ignoreSearch: url.origin === location.origin });
        const net = fetch(req).then((res) => {
          if (res.ok || res.type === 'opaque') c.put(req, res.clone());
          return res;
        }).catch(() => hit);
        return hit || net;
      }),
    );
  }
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'OLED//HUNT', body: e.data?.text() }; }
  const title = d.title || 'OLED//HUNT';
  const opts = {
    body: d.body || 'New deals are in.',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: d.tag || 'oledhunt',
    renotify: true,
    data: { url: d.url || './' },
  };
  e.waitUntil(Promise.all([self.registration.showNotification(title, opts), self.navigator.setAppBadge?.(1).catch(() => {})]));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if (c.url.startsWith(self.registration.scope)) return c.focus().then(() => c.navigate?.(target));
      return self.clients.openWindow(target);
    }),
  );
});
