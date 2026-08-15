---
name: F8 Subscription Enforcement
description: Central subscription gate architecture — how enforcement is applied to all tenant routes; key fix for authenticate ordering.
---

## Architecture

The subscription gate lives in `routes/index.ts`:

```typescript
router.use("/creches/:crecheId", authenticate, requireActiveSubscription);
```

**Critical**: `authenticate` MUST be chained BEFORE `requireActiveSubscription`. Without it, `req.user` is `undefined` when the gate runs (authenticate lives inside each individual sub-router, not globally). This was the root bug — the gate silently fell through to `next()` for every request.

## Enforcement rules (requireActiveSubscription.ts)

| Role | Behavior |
|---|---|
| `master_admin` | Bypasses entirely |
| `tutor` | Bypasses entirely (scope not gated) |
| No `crecheId` | Bypasses (auth middleware handles it) |
| Missing subscription row | 402 `subscription_missing` |
| `trial` + `trialEndsAt` in past | 402 `trial_expired` (real-time check) |
| `suspended` / `cancelled` | 402 `subscription_inactive` |
| `past_due` | Passes (grace period, UI banner only) |
| `active` / `trial` (valid) | Passes |

## Recovery routes (no gate)

Anything mounted OUTSIDE `/creches/:crecheId` remains accessible for blocked users:
- `/auth/*` — login, register
- `/billing/*` — plans, subscription, checkout, portal
- `/push/*`, `/users/*`, `/healthz`

## Scheduler job

`startTrialExpirationJob()` in `lib/scheduler.ts` — runs every hour + on startup. Converts `status=trial` where `trial_ends_at < now()` to `status=suspended`. Complements the real-time middleware check so DB records stay accurate.

## Frontend gate (app-layout.tsx)

- Uses `useGetBillingSubscription({ query: { enabled: isOperationalRole } as any })`
- On initial load: shows spinner (fail-closed)
- On API error: shows "Não foi possível verificar" + retry (fail-closed)
- On blocked: `useEffect` redirects to `/assinatura`; renders `null` while redirect fires
- Recovery paths: `/assinatura`, `/login`, `/cadastro`, `/recuperar-senha`, `/redefinir-senha` exempt from redirect

## Test file

`artifacts/api-server/src/__tests__/f8-subscription-enforcement.test.ts` — 12/13 passed (Case 7 master_admin skipped; no master token available in vitest shared context).

**Why:** `authenticate` runs inside sub-routers only — global gate must chain it explicitly.
**How to apply:** Any new central middleware on `/creches/:crecheId` must also chain `authenticate` first, or check if `req.user` is already populated.
