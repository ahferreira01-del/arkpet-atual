---
name: Phase 15C integration test patterns
description: Patterns, fixes, and invariants discovered while writing the financial integration test suite.
---

# Phase 15C Integration Test Patterns

## Test file layout

Four new test files under `artifacts/api-server/src/__tests__/`:
- `billing.integration.test.ts` — BillingService, processManualPayment, void, refund, concurrency
- `credits.integration.test.ts` — releasePurchasedCredits, consumePackageCredits, consumeServiceCredits, restore
- `outbox.integration.test.ts` — OutboxRepository primitives, atomicity, event types
- `wallet.integration.test.ts` — WalletService balance, expiry, listPackages, createManualPackage

Helpers:
- `helpers/fixtures.ts` — createTestTutor, createCatalogueItem, bookmarkOutboxId, getOutboxEventsSince
- `vitest.d.ts` — `ProvidedContext` declaration so `inject("e2eCtx")` types correctly instead of `never`

## Avulso unique-index collision

**Rule:** Two avulso invoices for the same `tutorId` on the same date collide on `UNIQUE(tutorId, cycleStart, cycleEnd)`.

**In tests:** Give each test that creates its own avulso invoice a fresh tutor (via `createTestTutor`). Never reuse a tutor across multiple avulso `addCharge` calls in the same day.

**In POS service:** Anonymous sales (`tutorId ?? null`) bypass the index because NULL ≠ NULL in Postgres.

## addCharge null-tutorId routing

`BillingService.addCharge` now accepts `tutorId: number | null`.
- `null` (or `isAvulso=true`) → standalone invoice, `cycleStart/cycleEnd` omitted for anonymous sales
- Non-null + not avulso → monthly-cycle branch (narrowed `tutorId` used internally)

**Why:** POS sales without a customer must never enter the monthly-cycle branch; the unique index would reject concurrent same-day anonymous sales.

## Global error handler

`artifacts/api-server/src/app.ts` error handler now reads `err.status` / `err.statusCode`.
If `4xx`, returns that status + `err.message` directly without logging a stack trace.
If `5xx` or unknown, logs fully and returns 500.

**Why:** Routes that call `next(err)` with `{ status: 400 }` were all silently returning 500 before this fix.

## Outbox atomicity test pattern

```typescript
const bookmark = await bookmarkOutboxId(); // snapshot max(id) before operation
await operation();
const events = await getOutboxEventsSince(bookmark, "EventType");
expect(events.length).toBeGreaterThanOrEqual(1);
```

Rollback test: wrap insert + intentional throw in db.transaction, confirm no events appear after bookmark.

## global-setup.ts subscriptions insert

`currentPeriodStart` column does not exist in `subscriptionsTable`. The field was silently ignored by Drizzle at runtime (excess property) but caused a compile-time TS error. Removed.
