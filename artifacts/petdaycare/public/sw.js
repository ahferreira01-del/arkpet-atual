const CACHE_NAME = "arkpet-v19";
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
  // Force immediate activation — the new SW takes over without waiting for
  // user confirmation. This ensures mobile PWA installs always run the latest
  // frontend code and don't get stuck on a stale cached version.
  self.skipWaiting();
});

// ──────────────────────────────────────────────────────
// Update flow — activate the waiting SW on demand
// ──────────────────────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
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
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      // Always send postMessage so open tabs update their UI in real-time,
      // regardless of whether we also show an OS notification.
      for (const c of list) c.postMessage({ kind: "push", payload: data });

      // Decide whether to also show the OS notification.
      // Chat and test events always show — they need explicit visual feedback.
      // Other events: suppress only when at least one tab is visibly in the
      // foreground. We intentionally do NOT check `c.focused` here because
      // on Android Chrome (PWA standalone mode) `focused` is often reported
      // as false even when the app is in the foreground, causing notifications
      // to leak through when the app is already open.
      // data is the full push payload: { title, body, tag, data: { type, ... } }
      // The actual notification type lives in data.data.type, not data.type.
      const notifType = (data.data?.type ?? data.type) || "";
      const isChat = notifType === "chat";
      const isTest = notifType === "test";
      const anyVisible = list.some((c) => c.visibilityState === "visible");

      if (!isChat && !isTest && anyVisible) {
        // App is open and visible — in-app toast/UI handles the update.
        return;
      }

      await self.registration.showNotification(title, options);
    })()
  );
});

// ──────────────────────────────────────────────────────
// Resolve the in-app path to navigate to from a push data payload.
// Rules:
//  - Never open the root "/" when a more specific route exists.
//  - Never open a random/previous page.
//  - Use query params (?b= for booking, ?t= for task, ?pet= for chat)
//    so the target page can scroll to and highlight the specific item.
// ──────────────────────────────────────────────────────
function resolveTargetPath(data) {
  const type = data.type || "";

  // ── Booking events ──────────────────────────────────
  if (["booking", "checkin", "checkout", "ontheway"].includes(type)) {
    if (data.bookingId) return `/bookings?b=${data.bookingId}`;
    if (data.petId)     return `/bookings?pet=${data.petId}`;
    return "/bookings";
  }

  // ── Task events ──────────────────────────────────────
  if (type === "task") {
    if (data.taskId) return `/staff?t=${data.taskId}`;
    return "/staff";
  }

  // ── Chat events ───────────────────────────────────────
  if (type === "chat") {
    if (data.tutorId) return `/chat?tutor=${data.tutorId}`;
    return "/chat";
  }

  // ── Walk events ───────────────────────────────────────
  if (type === "walk") {
    if (data.petId) return `/pets/${data.petId}?tab=timeline`;
    return "/walks";
  }

  // ── Timeline / pet events ─────────────────────────────
  if (type === "timeline") {
    if (data.petId) return `/pets/${data.petId}?tab=timeline`;
    return "/pets";
  }
  if (type === "medical") {
    if (data.petId) return `/pets/${data.petId}?tab=medical`;
    return "/pets";
  }

  // ── Financial / settings ──────────────────────────────
  if (type === "mensalidade") return "/settings";

  // ── Test push (sent from Settings) ───────────────────
  if (type === "test") return "/settings";

  // ── Admin / tutor events ──────────────────────────────
  if (type === "tutor")  return "/tutors";
  if (type === "admin")  return "/admin";

  // ── Generic fallback — prefer a known entity over "/" ─
  if (data.petId)     return `/pets/${data.petId}`;
  if (data.bookingId) return `/bookings?b=${data.bookingId}`;
  if (data.taskId)    return `/staff?t=${data.taskId}`;

  // Last resort: dashboard (never a random previous page)
  return "/";
}

// ──────────────────────────────────────────────────────
// Notification click — open or focus the app
// ──────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const targetPath = resolveTargetPath(data);
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
