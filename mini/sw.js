// herdr-remote service worker — Web Push notifications
const APP_SCOPE = self.registration.scope;
// PNG rather than logo.svg: an SVG notification icon is ignored by most platforms, and this is the
// same mark the installed app already wears. iOS draws the app icon regardless.
const logoUrl = new URL('icon-192.png', APP_SCOPE).href;
const appUrl = (url = '') => new URL(url.replace(/^\//, ''), APP_SCOPE).href;

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let data = { title: '🐑 herdr', body: 'Agent needs attention', url: APP_SCOPE };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {}
  data.url = appUrl(data.url);
  // Clear notification (sent when agent unblocks)
  if (data.type === 'clear') {
    event.waitUntil(
      self.registration.getNotifications({ tag: data.tag || 'herdr-blocked' }).then((notes) => {
        notes.forEach((n) => n.close());
      })
    );
    return;
  }
  // The tag is per pane, so two panes wanting you are two notifications rather than one silently
  // replacing the other — and a pane's later state (finished, or the clear above) still lands on
  // the same tag and replaces its own earlier one. Older relays send no tag; keep the fixed one
  // for those, which is exactly the previous behaviour.
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: logoUrl,
      badge: logoUrl,
      tag: data.tag || 'herdr-blocked',
      renotify: true,
      data: { url: data.url },
    })
  );
});

// Where a tapped notification points, kept until the page asks for it. iOS brings a home-screen
// app forward on the tap but can drop the `navigate` message posted to a page still waking up, and
// can start a closed app at its start URL rather than the notification's. So the page asks each
// time it comes to the front (see terminal.js), and the answer is here whatever happened to the
// message. In the Cache API rather than a variable: iOS ends an idle worker between the tap and the
// ask. A link older than two minutes is a tap nobody is waiting on any more.
const NAV_CACHE = 'herdr-nav';
const NAV_KEY = appUrl('__pending_nav');
const NAV_TTL_MS = 120000;

async function putPendingNav(url) {
  const cache = await caches.open(NAV_CACHE);
  await cache.put(NAV_KEY, new Response(JSON.stringify({ url, at: Date.now() })));
}

async function takePendingNav() {
  const cache = await caches.open(NAV_CACHE);
  const hit = await cache.match(NAV_KEY);
  if (!hit) return null;
  await cache.delete(NAV_KEY);
  const p = await hit.json().catch(() => null);
  return p && Date.now() - p.at < NAV_TTL_MS ? p.url : null;
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'pending_nav') return;
  event.waitUntil(takePendingNav().then((url) => {
    if (url && event.source) event.source.postMessage({ type: 'navigate', url });
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || APP_SCOPE;
  event.waitUntil(putPendingNav(url).catch(() => {}).then(() =>
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })).then((clients) => {
      for (const client of clients) {
        if (client.frameType !== 'nested' && new URL(client.url).origin === self.location.origin
            && !new URL(client.url).searchParams.has('ns')
            && !new URL(client.url).searchParams.has('m')) {
          client.focus();
          client.postMessage({ type: 'navigate', url });
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
