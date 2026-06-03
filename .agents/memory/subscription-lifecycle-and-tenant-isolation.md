---
name: Subscription lifecycle sync & tenant isolation
description: Invariants for the Stripe→app subscription state machine and per-creche access control on /creches/:crecheId/* routes
---

# Webhook → app subscription sync (order-safety)
The app keeps its OWN subscription lifecycle (trial/active/past_due/suspended/cancelled) in `subscriptions`, separate from the `stripe` schema that stripe-replit-sync mirrors. The webhook is the source of truth for those transitions (subscriptionSync.applyStripeEvent).

**Rule:** every lifecycle write must go through an atomic compare-and-set keyed on `subscriptions.last_stripe_event_at`:
`UPDATE ... SET ..., last_stripe_event_at = eventDate WHERE id = ? AND (last_stripe_event_at IS NULL OR last_stripe_event_at <= eventDate)`.
**Why:** Stripe does NOT guarantee ordered delivery and retries can reorder. An in-memory staleness check + unconditional UPDATE is race-prone — two concurrent deliveries both pass the stale read and the older event can win. Doing the comparison in the SQL WHERE clause makes it a single atomic statement, so stale/older events are dropped (0 rows affected). `event.created` (seconds → ms) is the ordering key.
**How to apply:** any new event handler in subscriptionSync.ts must resolve the app sub then call the shared `commit(appSub, eventCreatedMs, updates)` — never write `subscriptionsTable` directly. eventCreatedMs<=0 falls back to a plain update.

# Tenant isolation on /creches/:crecheId/* routes
`:crecheId` is attacker-controlled in the path. Without a guard, any authenticated user can IDOR into another tenant.
**Rule:** every tenant-scoped route must enforce `req.user.crecheId === Number(params.crecheId)` unless `req.user.role === "master_admin"`.
- Routers mounted under `/creches/:crecheId/*` (pets, bookings, tasks, chat, walks, tutor-timeline) use the `requireCrecheMembership` middleware via `router.use` right after `authenticate`.
- `creches.ts` is mounted at `/creches` (mixes crecheId and non-crecheId routes like `GET /`, `POST /`), so it CANNOT blanket-apply the middleware — each `/:crecheId*` handler does the check inline.
**Also:** `requireActiveSubscription` reads `req.user.crecheId` (authoritative), never the path param, so the subscription gate can't be bypassed by targeting another tenant's path.
