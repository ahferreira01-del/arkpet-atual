---
name: Feed V2 Architecture
description: Key decisions from the complete rewrite of the feed/timeline module (V2)
---

## Media Authentication
- Login now emits both `accessToken` and `mediaToken` (24h, HMAC-signed, stored as `media_token` in localStorage)
- `GET /storage/objects/*` accepts `?mt=<mediaToken>` in addition to Bearer header
- Frontend uses `buildMediaSrc(objectPath, mediaToken)` → `/api/storage/objects/…?mt=…`
- `<img loading="lazy" src={buildMediaSrc(…)}>` works natively — no fetch, no blob, no expiry in cache

## Feed V2 Routes
- All routes at `/creches/:crecheId/feed` (same path as V1, feed-v2.ts replaces feed.ts in index.ts)
- All routes have `router.use(authenticate)` — no unauthenticated access possible
- GET returns `{ posts: FeedPost[], nextCursor: number | null }` — cursor-based pagination (`?after=id`)
- POST returns `{ post: FeedPost }` — full DTO so frontend prepends without re-fetching

## Push Notifications
- `IFeedNotificationService` interface in `lib/notifications/` — feed route depends only on the interface
- `PushFeedNotificationService.onPostPublished()` uses `setImmediate()` to fire AFTER HTTP response
- `Promise.allSettled` for per-tutor sends — one failure doesn't cancel others
- Swap to BullMQ/SQS: only change the concrete implementation class

## Upload
- Photos: `compressToWebPBlob()` → WebP Blob → `POST /storage/uploads/direct` — zero base64 anywhere
- Videos: raw File → same endpoint — no browser conversion
- `validateMediaFile()` runs client-side; `validateUpload` middleware runs server-side independently
- XHR used for upload (not fetch) to support progress events

## DTO Structure
- `mediaItems: MediaItem[]` (array) even though V2 only has 0 or 1 — prepared for carousels
- `MediaItem.objectPath` is the raw `/objects/…` path; frontend constructs full URL at render time

## State Management
- TanStack Query `useInfiniteQuery` for cursor pagination
- New post: `queryClient.setQueryData` prepends to first page — no refetch
- Like: optimistic update + rollback on error
- Delete: optimistic removal + rollback on error
- Comments: separate query per postId, counter updated in feed cache on new comment

## Why V1 Was Replaced
- V1 did 3 round-trips per card (list → detail → blob fetch) — V2 does 1
- V1 stored photos as base64 in DB — could be MBs per row, caused mobile timeouts
- V1 presigned URL sidecar returns 401 in production — V2 avoids it entirely
- V1 GET /comments had no auth check — V2 fixes it
- V1 delete had no transaction — V2 wraps in db.transaction()
