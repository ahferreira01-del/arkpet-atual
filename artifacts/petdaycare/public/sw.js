const CACHE_NAME = "arkpet-v9";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon.svg",
];

// Resolve a path relative to the SW scope so it works under any BASE_PATH.
function scopedUrl(path) {
  try {
    return new URL(path.replace(/^\/+/, ""), self.registration.scope).toString();
  } catch {
    return path;
  }
}

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
async function anyClientFocused() {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return list.some((c) => c.visibilityState === "visible" && c.focused);
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "ArkPet", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "ArkPet";
  // Use the provided tag verbatim. With renotify:true the same tag
  // replaces the previous notification but still buzzes/sounds the device.
  // This prevents the duplicate-notification spam from previous versions.
  const tag = data.tag || "arkpet-notification";

  const options = {
    body: data.body || "",
    icon: data.icon || scopedUrl("icons/icon-192.png"),
    badge: scopedUrl("icons/icon-192.png"),
    tag,
    renotify: true,
    requireInteraction: false,
    silent: false,
    data: data.data || {},
    vibrate: [200, 100, 200],
    timestamp: Date.now(),
  };

  event.waitUntil(
    (async () => {
      // If the app is open AND the relevant tab is focused, skip the OS
      // notification — the in-app UI (toast / live update) covers it and
      // we avoid the double-notify experience users complain about.
      // Chat messages and explicit tests are exceptions: always show so
      // the user gets visible feedback.
      const isChat = data.type === "chat";
      const isTest = data.type === "test";
      if (!isChat && !isTest && await anyClientFocused()) {
        // Still update the app via postMessage so any open client can refresh.
        const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const c of list) c.postMessage({ kind: "push", payload: data });
        return;
      }
      await self.registration.showNotification(title, options);
    })()
  );
});

// ──────────────────────────────────────────────────────
// Notification click — open or focus the app
// ──────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  let targetPath = "/";

  if (data.type === "booking" || data.type === "checkin" || data.type === "checkout") {
    targetPath = "/bookings";
  } else if (data.type === "task") {
    targetPath = "/staff";
  } else if (data.type === "chat") {
    targetPath = data.petId ? `/chat?pet=${data.petId}` : "/chat";
  } else if (data.type === "walk" && data.petId) {
    targetPath = `/pets/${data.petId}`;
  } else if (data.type === "medical" && data.petId) {
    targetPath = `/pets/${data.petId}?tab=medical`;
  } else if (data.type === "timeline" && data.petId) {
    targetPath = `/pets/${data.petId}?tab=timeline`;
  } else if (data.type === "ontheway") {
    targetPath = "/bookings";
  } else if (data.type === "mensalidade") {
    targetPath = "/settings";
  } else if (data.petId) {
    targetPath = `/pets/${data.petId}`;
  }

  const fullUrl = scopedUrl(targetPath);

  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Try to focus an existing client and ask it to navigate (in-app router).
      for (const c of list) {
        if (c.url.startsWith(self.location.origin)) {
          c.postMessage({ kind: "navigate", path: targetPath });
          try { await c.focus(); return; } catch {}
        }
      }
      await self.clients.openWindow(fullUrl);
    })()
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
  const oldEndpoint = event.oldSubscription?.endpoint;
  event.waitUntil(
    self.registration.pushManager
      .subscribe({
        userVisibleOnly: true,
        applicationServerKey: event.oldSubscription?.options?.applicationServerKey,
      })
      .then(async (newSub) => {
        const p256dh = arrayBufferToBase64(newSub.getKey("p256dh"));
        const auth = arrayBufferToBase64(newSub.getKey("auth"));
        // Send oldEndpoint so the server can locate and rotate the existing
        // row without requiring an auth token (SW has no localStorage).
        await fetch(scopedUrl("api/push/subscribe"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: newSub.endpoint,
            p256dh,
            auth,
            oldEndpoint,
          }),
        });
      })
      .catch((err) => {
        console.error("[SW] pushsubscriptionchange error:", err);
      })
  );
});
