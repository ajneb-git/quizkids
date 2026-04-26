const CACHE_NAME = 'quizkids-v5';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/quiz.js',
  '/js/results.js',
  '/js/share.js',
  '/js/storage.js',
  '/js/config.js',
  '/manifest.json'
];

// ─── Install ──────────────────────────────────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ─── Activate ─────────────────────────────────────────────────────────────────

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ─── Fetch (Cache first / Network first) ─────────────────────────────────────

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (url.pathname.includes('/data/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

// ─── Periodic Background Sync ─────────────────────────────────────────────────

self.addEventListener('periodicsync', event => {
  if (event.tag === 'daily-quiz-reminder') {
    event.waitUntil(sendDailyReminder());
  }
});

async function sendDailyReminder() {
  const now = new Date();
  const hour = now.getHours();

  // Only notify between 7h30 and 11h00
  if (hour < 7 || (hour === 7 && now.getMinutes() < 30) || hour >= 11) return;

  // Check if user has already played today (stored in Cache API by the app)
  const today = now.toISOString().slice(0, 10);
  const alreadyPlayed = await hasPlayedTodayFromCache(today);
  if (alreadyPlayed) return;

  await self.registration.showNotification('QuizKids 🧠', {
    body: 'C\'est l\'heure du quiz ! 60 questions t\'attendent ce matin.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'daily-quiz',       // replaces any previous notification with the same tag
    renotify: false,
    vibrate: [200, 100, 200],
    data: { url: '/' }
  });
}

// The app writes last_play_date into a dedicated cache entry so the SW can read it
// (localStorage is not accessible from service workers)
async function hasPlayedTodayFromCache(today) {
  try {
    const cache = await caches.open('quizkids-state');
    const res = await cache.match('/state/last-play-date');
    if (!res) return false;
    const date = await res.text();
    return date.trim() === today;
  } catch {
    return false;
  }
}

// ─── Push notifications (future use with backend) ─────────────────────────────

self.addEventListener('push', event => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'QuizKids 🧠', {
      body: data.body ?? 'Ton quiz du jour t\'attend !',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'daily-quiz',
      data: { url: data.url ?? '/' }
    })
  );
});

// ─── Notification click ────────────────────────────────────────────────────────

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url ?? '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // If a window is already open, focus it
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return clients.openWindow(targetUrl);
    })
  );
});
