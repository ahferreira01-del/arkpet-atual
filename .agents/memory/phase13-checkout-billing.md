---
name: Phase 13 checkout billing fix
description: Checkout double-charge bug root cause and fix; booking billing lifecycle; catalogue PUT fields that were silently dropped
---

## Booking Billing Lifecycle (after Phase 7+13)

**Confirmation (`status = "confirmed"`):**
- `consumePackageCredits` deducts from tutorCreditsTable (package days)
- `consumeServiceCreditsForBooking` deducts from tutorServiceCreditsTable (service packages)
- `BillingService.addCharge` charges the remaining `daysToBill` days (base price)
- `booking.price = subtotal` (total already billed)

**Checkout (`POST /:bookingId/checkout`):**
- ONLY charges consumables added during the stay
- Does NOT re-charge the base booking price (that was done at confirmation)
- Does NOT deduct tutorCredits (that was done at confirmation)
- The legacy credit-deduction block at checkout was REMOVED in Phase 13

**Why:** BillingService.addCharge is NOT idempotent — every call creates a new invoice_items row. Calling it at both confirmation AND checkout = double charge.

## Catalogue PUT — Fields Previously Silently Dropped

The PUT `/catalogue/:itemId` handler now persists `costPrice` and `barcode`.
Previously these fields were extracted from req.body but not included in the `.set()` update.

`stockQuantity` is intentionally NOT accepted via PUT — use POST `/catalogue/:itemId/stock-adjustment` instead (maintains audit trail, prevents negative stock races).

## Push Subscription Cleanup

When a new push subscription is registered for a userId, any stale subscriptions from the same push service host are cleaned up before insertion. This prevents silent notification failures after logout/re-login on the same browser.

## Stock Transactions Table Resilience

The `GET /catalogue/:itemId/stock-transactions` endpoint now catches "relation does not exist" errors and returns an empty paginated response instead of 500. Safe for fresh deployments without DB migration applied.

## Medical Routes — Parent ID Validation

All GET routes in medical.ts now validate:
1. petId is a valid positive integer (400 if not)
2. Pet exists in the same creche (404 if not)

Prevents silent 200+empty responses for invalid parent IDs.
