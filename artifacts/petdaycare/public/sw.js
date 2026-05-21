const CACHE_NAME = "arkpet-v8";
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
// Fetch (network-first strategy)
// ──────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api")) {
    event.respondWith(fetch(request));
    return;
  }

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
    data = { title: "ArkPet", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "ArkPet";

  // Use unique tag per notification so renotify always fires.
  // If a tag is provided use it; append timestamp to force renotify display.
  const baseTag = data.tag || "arkpet-notification";
  const uniqueTag = `${baseTag}-${Date.now()}`;

  const options = {
    body: data.body || "",
    // Prefer PNG for better Android/iOS compatibility
    icon: data.icon || "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    tag: uniqueTag,
    // renotify: true ensures the notification is always shown even if same tag
    renotify: true,
    requireInteraction: false,
    silent: false,
    data: data.data || {},
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ──────────────────────────────────────────────────────
// Notification click — open or focus the app
// ──────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  let targetUrl = "/";

  if (data.type === "booking" || data.type === "checkin" || data.type === "checkout") {
    targetUrl = "/bookings";
  } else if (data.type === "task") {
    targetUrl = "/staff";
  } else if (data.type === "chat") {
    targetUrl = data.petId ? `/chat?pet=${data.petId}` : "/chat";
  } else if (data.type === "walk" && data.petId) {
    targetUrl = `/pets/${data.petId}`;
  } else if (data.type === "medical" && data.petId) {
    targetUrl = `/pets/${data.petId}?tab=medical`;
  } else if (data.type === "timeline" && data.petId) {
    targetUrl = `/pets/${data.petId}?tab=timeline`;
  } else if (data.type === "ontheway") {
    targetUrl = "/bookings";
  } else if (data.type === "mensalidade") {
    targetUrl = "/settings";
  } else if (data.petId) {
    targetUrl = `/pets/${data.petId}`;
  }

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
function arrayBufferToBase64(buffer) {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str);
}

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: event.oldSubscription?.options?.applicationServerKey,
    }).then((newSub) => {
      const p256dh = arrayBufferToBase64(newSub.getKey("p256dh"));
      const auth = arrayBufferToBase64(newSub.getKey("auth"));
      return fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: newSub.endpoint, p256dh, auth }),
      });
    }).catch((err) => {
      console.error("[SW] pushsubscriptionchange error:", err);
    })
  );
});
