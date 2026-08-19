---
name: Phase 14 financial module restructure
description: Key architectural decisions from the Phase 14 financial refactor — state machine, snapshot columns, idempotency, and financialSync delegation.
---

## InvoiceStateMachine
`BillingService` now exports `InvoiceStateMachine` as the sole authority for status transitions.
Valid: pending→paid/voided/overdue, overdue→paid/voided, paid→refunded, voided→[], refunded→[].
For new charges, `isClosed(status)` also includes awaiting confirmation and overdue. Payment idempotency is a separate question: overdue and awaiting-confirmation invoices may still transition to paid.

**Why:** F-03 — `addCharge` was reopening paid/voided/refunded invoices, corrupting closed-cycle financials.

**How to apply:** Any code that changes `invoicesTable.status` must call `InvoiceStateMachine.assertTransition(from, to)` or use the helper functions (voidInvoice, refundInvoice, approveReceipt).

## invoice_items snapshot columns (Fase 14)
Added to `invoiceItemsTable`: `catalogueItemId`, `snapshotName`, `snapshotPrice`, `creditsAmount`, `snapshotMaxPets`, `snapshotExpirationDays`.
`addCharge` always saves these. `releasePurchasedCredits` reads snapshot first, falls back to catalogueItemId lookup, then name lookup (legacy warning).

**Why:** Eliminates string/regex matching in `releasePurchasedCredits` and prevents stale data issues when catalogue items are renamed/deleted.

**How to apply:** All `BillingService.addCharge` calls for packages MUST pass `catalogueItemId`, `creditsAmount`, `snapshotMaxPets`, `snapshotExpiration`. For services, pass `catalogueItemId`.

## Idempotency gates
- `consumePackageCredits`: checks `bookingCreditsTable` for existing rows for `bookingId` before consuming. Returns existing totals if found.
- `consumeServiceCreditsForBooking`: checks `bookingServiceCreditsTable`. Returns without reprocessing if found.
- `releasePurchasedCredits`: checks `invoice.creditsReleased` flag (FOR UPDATE) before inserting credits.

**Why:** F-05/F-06 — double-confirm (retry) was causing double credit debit.

## financialSync delegates entirely to BillingService
`financialSync.ts` only calls `BillingService.processStripePayment()`. No direct DB writes. Idempotency is inside `processStripePayment` (FOR UPDATE + `isClosed` check).

**Why:** F-08 — webhook had no audit log and no state machine guard.

## lib/db project references
After editing `lib/db/src/schema/financial.ts`, must run `pnpm --filter @workspace/db exec tsc --build tsconfig.json` before api-server TS check sees the new columns. The api-server uses compiled `.d.ts` from `lib/db/dist/`.

## Scheduler concurrency flags
`receiptCleanupRunning` and `expiredOrderCancellerRunning` module-level booleans with try/finally. Receipt cleanup now excludes `paid` invoices (status=voided|refunded|overdue only).

**Why:** Cron jobs could overlap on slow DB; paid invoice receipts have probatory value (LGPD does not require deletion of proof-of-payment documents).
