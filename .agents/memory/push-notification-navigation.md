---
name: Push notification navigation architecture
description: How ArkPet routes push notification clicks to the correct in-app screen with deep-link highlighting.
---

## Rule
All push notifications MUST include `petId`, `bookingId`, or `taskId` in their `data` payload so the SW can deep-link directly to the entity.

## SW resolveTargetPath() (sw.js)
Maps `data.type` → URL path:
- `booking / checkin / checkout / ontheway` → `/bookings?b={bookingId}`
- `task` → `/staff?t={taskId}`
- `chat` → `/chat?pet={petId}`
- `walk / timeline` → `/pets/{petId}?tab=timeline`
- `medical` → `/pets/{petId}?tab=medical`
- `mensalidade / test` → `/settings`
Fallback chain: petId → bookingId → taskId → "/"

## URL param conventions
- `?b={bookingId}` — bookings page scrolls + highlights that booking (violet ring)
- `?t={taskId}` — staff page scrolls + highlights that task (violet ring)
- `?pet={petId}` — chat page opens that pet's chat thread

## Frontend behavior
When `?b=` / `?t=` params are present:
- statusFilter / onlyPresent overridden to "all/false" so the item is always visible
- useEffect fires 400ms after data loads to scrollIntoView the element
- Element gets `id="booking-{id}"` / `id="task-{id}"` for DOM targeting

**Why:** Prior to this, notifications opened generic /bookings or /staff with no indication of which item triggered them. The user had to scroll and find it manually.

## CACHE_NAME versioning
Bump CACHE_NAME (arkpet-vN) every time sw.js behavior changes so devices actually activate the new SW. Current: v13.

## Critical payload structure bug (found and fixed)

The SW push handler receives the FULL push payload as `event.data.json()`:
```js
data = { title, body, tag, data: { type: "chat", petId, ... } }
```
The notification type is at `data.data.type`, NOT `data.type` (which is `undefined`).

Two places were reading `data.type` incorrectly:
1. **sw.js isChat/isTest check** — `const isChat = data.type === "chat"` → always `false` → ALL notifications were suppressed when the app was visible (including chat, which should always show). Fix: `(data.data?.type ?? data.type) === "chat"`
2. **App.tsx ServiceWorkerBridge** — `const type = msg.payload?.type` → always `undefined` → cache invalidation never fired for any notification type. Fix: `msg.payload?.data?.type ?? msg.payload?.type`

**Why:** The push payload is a nested object (`{ ..., data: { type } }`). The `data.data` field holds the notification-specific metadata; `data.type` is the MIME type of the notification spec, not our app type.
