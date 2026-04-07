const CACHE_NAME = "luxepets-v4";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon.svg",
];

// ──────────────────────────────────────────────────────
// Install
// ──────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

// ──────────────────────────────────────────────────────
// Activate
// ──────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// ──────────────────────────────────────────────────────
// Fetch (network strategy)
// ──────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api")) {
    event.respondWith(fetch(request));
    return;
  }

  // Network-first for everything: always try network, fall back to cache
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(
          (cached) => cached || caches.match("./index.html")
        )
      )
  );
});

// ──────────────────────────────────────────────────────
// Push notifications
// ──────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "LuxePets", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "LuxePets";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icons/icon.svg",
    badge: data.badge || "/icons/icon.svg",
    tag: data.tag || "luxepets-notification",
    data: data.data || {},
    vibrate: [100, 50, 100],
    actions: [],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ──────────────────────────────────────────────────────
// Notification click — open the app
// ──────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  let targetUrl = "/";

  if (data.type === "booking") targetUrl = "/bookings";
  else if (data.type === "task") targetUrl = "/staff";
  else if (data.type === "chat") targetUrl = "/chat";
  else if (data.type === "checkin" || data.type === "checkout") targetUrl = "/bookings";
  else if (data.type === "timeline" && data.petId) targetUrl = `/pets/${data.petId}`;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        return clients.openWindow(targetUrl);
      })
  );
});

// ──────────────────────────────────────────────────────
// Push subscription change (browser auto-refreshes key)
// ──────────────────────────────────────────────────────
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: event.oldSubscription?.options?.applicationServerKey,
    }).then((newSub) => {
      // POST new subscription — token retrieved from IndexedDB by the app
      return fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: newSub.endpoint,
          p256dh: btoa(String.fromCharCode(...new Uint8Array(newSub.getKey("p256dh")))),
          auth: btoa(String.fromCharCode(...new Uint8Array(newSub.getKey("auth")))),
        }),
      });
    })
  );
});
