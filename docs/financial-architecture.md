# Financial Module Architecture

> **Last updated:** Phase 15B/15C
> This document is the authoritative reference for the financial domain of ArkPet.
> It covers the invoice state machine, service boundaries, repository layer,
> domain events, outbox flow, credit system, and structured logging.

---

## 1. Invoice State Machine

Invoices transition through a strict set of states. Only the transitions listed
below are valid; any other transition throws `InvoiceStateMachine.assertTransition`.

```
pending ──────────────────────────────────► paid ──► refunded
   │                                          ▲
   ├──► overdue ──────────────────────────────┘
   │
   ├──► awaiting_confirmation ──────────────► paid
   │
   └──► voided  (terminal)

refunded  (terminal)
voided    (terminal)
```

| From                  | Allowed transitions              |
|-----------------------|----------------------------------|
| `pending`             | `paid`, `voided`, `overdue`      |
| `overdue`             | `paid`, `voided`                 |
| `awaiting_confirmation` | `paid`, `voided`               |
| `paid`                | `refunded`                       |
| `voided`              | _(none — terminal)_              |
| `refunded`            | _(none — terminal)_              |

**`InvoiceStateMachine.isClosed(status)`** returns `true` for `paid`, `refunded`,
and `voided`. Closed invoices never receive new charges; a new overflow avulso
invoice is created instead.

---

## 2. Service Layer

### BillingService (`services/billing.ts`)

The single authority for invoice creation, charge merging, and payment processing.

| Method | What it does |
|---|---|
| `addCharge(params)` | Creates or merges a charge into the correct cycle invoice. Returns the invoiceId. If the cycle invoice is already closed, creates an overflow avulso invoice instead. |
| `processManualPayment(invoiceId, crecheId, userId, method)` | Marks invoice paid, creates a financial transaction row, releases credits, marks associated orders paid, inserts `InvoicePaid` outbox event. |
| `approveReceipt(invoiceId, crecheId, userId)` | Same as manual payment but for PIX receipt confirmation. |
| `voidInvoice(invoiceId, crecheId, userId)` | Cancels invoice and pending orders, inserts `InvoiceVoided` event. |
| `refundInvoice(invoiceId, crecheId, userId)` | Marks paid invoice refunded, cancels all linked orders, inserts `InvoiceRefunded` event. |
| `BillingService.refundItem(params)` | Partial/item-level refund — restores stock for product items, creates a negative transaction for paid invoices. |
| `processStripePayment(params)` | Idempotent Stripe payment processing. No-ops if invoice is already closed. |
| `getCycleDates(mensalidadeDia, txDateStr)` | Pure helper — computes cycleStart/cycleEnd/dueDate for a billing cycle. |

**`addCharge` routing logic:**

```
existingInvoiceId? ──yes──► append to that invoice (throws if not found)
isAvulso? ──────────yes──► create standalone avulso invoice
                    no───► look for open cycle invoice
                             open? ──► merge (update amount)
                             closed? ─► create overflow avulso
                             absent? ─► create new cycle invoice
```

### CreditService (`services/credits.ts`)

Manages package day-credits and per-service credits.

| Function | What it does |
|---|---|
| `releasePurchasedCredits(invoiceId, userId, tx)` | Reads invoice items, creates `tutorCreditsTable` rows (packages) and `tutorServiceCreditsTable` rows (services). Idempotent via `creditsReleased` gate. |
| `consumePackageCredits(bookingId, ...)` | Consumes one credit per booking day. Tries piggyback (multi-pet) first, falls back to normal consume, then marks as billable day. Idempotent via `bookingCreditsTable` check. |
| `consumeServiceCreditsForBooking(bookingId, ...)` | Matches service credits by `catalogueItemId` (then by name normalization). Idempotent via `bookingServiceCreditsTable` check. |
| `restoreBookingPackageCredits(bookingId, tx, crecheId)` | Reverses `consumePackageCredits` on booking cancellation. Transfers credits to piggyback children where applicable. |
| `restoreBookingServiceCredits(bookingId, tx, crecheId)` | Decrements `usedCredits` on the service credit rows. |

**Credit priority for `releasePurchasedCredits`:**
1. Snapshot columns in `invoice_items` (preferred — captured at purchase time)
2. Fallback by `catalogueItemId` (if snapshot absent)
3. Legacy fallback by name match (deprecated; logs a `warn`)

### WalletService (`services/wallet.ts`)

Read-only aggregation API for tutor balances.

| Method | What it does |
|---|---|
| `getBalance(tutorId, crecheId)` | Returns `{ totalCredits, usedCredits, availableCredits, packages, nearestExpiration }`. Filters out expired and fully-used rows. |
| `listPackages(crecheId, tutorId, pageSize, offset)` | Paginated list of package credits. |
| `listServiceCredits(crecheId, tutorId, pageSize, offset)` | Paginated list of service credits with catalogue name joined. |
| `createManualPackage(...)` | Admin action — creates a package credit row without an invoice. |

---

## 3. Repository Layer

All SQL lives in `repositories/`. Services never write SQL directly.

| Repository | Tables owned |
|---|---|
| `InvoiceRepository` | `invoicesTable`, `invoiceItemsTable` |
| `OrderRepository` | `ordersTable`, `orderItemsTable` |
| `TransactionRepository` | `financialTransactionsTable` |
| `CreditRepository` | `tutorCreditsTable`, `bookingCreditsTable`, `tutorServiceCreditsTable`, `bookingServiceCreditsTable` |
| `WalletRepository` | Read-only queries on `tutorCreditsTable`, `tutorServiceCreditsTable` |
| `CatalogueRepository` | `catalogueItemsTable`, `catalogueStockTransactionsTable` |
| `OutboxRepository` | `financialOutboxTable` |
| `ExpenseRepository` | `expensesTable` |

**Transaction contract:** Every repository method that mutates data accepts an
optional `tx` parameter (the Drizzle transaction client). Callers in services
that need atomicity pass their active `tx`. The `c(tx)` helper from
`repositories/shared.ts` returns `tx ?? db` so methods are usable both inside
and outside a transaction.

**`OutboxRepository.insert` is the exception:** `tx` is required (not optional).
Outbox events must always be committed atomically with the main write — passing
no `tx` is a compile-time type error.

---

## 4. Domain Events Catalog

All events are typed in `services/events.ts` and stored in `financial_outbox`.

| Event type | Emitted when | Key payload fields |
|---|---|---|
| `InvoicePaid` | Invoice marked paid by any payment path | `invoiceId`, `tutorId`, `amount`, `paymentMethod` |
| `InvoiceRefunded` | Invoice (or item) refunded | `invoiceId`, `tutorId`, `amount` |
| `InvoiceVoided` | Invoice voided | `invoiceId`, `tutorId` |
| `CreditsReleased` | Package/service credits released after payment | `invoiceId`, `tutorId` |
| `CreditsConsumed` | Package or service credits deducted for a booking | `bookingId`, `tutorId`, `creditsConsumed` |
| `CreditsRestored` | Credits restored on booking cancellation | `bookingId` |
| `OrderPaid` | Order status transitions to `paid` or `delivered` for the first time | `invoiceId` |
| `OrderCancelled` | Order cancelled (via route or scheduler) | `invoiceId` |

Every event extends `BaseFinancialEvent`:
```typescript
{ type: FinancialEventType; crecheId: number; occurredAt: string /* ISO-8601 */ }
```

---

## 5. Outbox Flow

The transactional outbox pattern guarantees events are never lost even if the
service processing them fails after the DB commit.

```
Service write (billing/credits/orders)
  └─► db.transaction(async (tx) => {
        1. Main business write  (invoice, credit, order row)
        2. OutboxRepository.insert(event, tx)   ← same tx, same commit
      })
        │
        │  (committed together or rolled back together)
        ▼
  financial_outbox table  status='pending'
        │
        │  (outbox worker — runs every minute via node-cron)
        ▼
  processOneOutboxEvent()
    SELECT id FROM financial_outbox
    WHERE status='pending'
    ORDER BY id LIMIT 1
    FOR UPDATE SKIP LOCKED
        │
        ├─ success ──► UPDATE status='processed', processedAt=NOW()
        └─ failure ──► retryCount++
                        retryCount >= 3 ──► status='failed'  (dead-letter)
                        retryCount < 3  ──► stays 'pending', retried next tick
```

**Design invariants:**
- One event is processed per `db.transaction` call in the worker → a DB failure
  on one event's status update only rolls back that event.
- `FOR UPDATE SKIP LOCKED` ensures two concurrent worker ticks never process
  the same event.
- Dead-letter threshold: `MAX_OUTBOX_RETRIES = 3`.

---

## 6. Credit System

### Package Credits (`tutor_credits`)

Represent pre-purchased day-use credits. Each row tracks:
- `totalCredits` — credits at purchase time
- `usedCredits` — incremented on booking confirmation, decremented on cancellation
- `maxPetsPerDay` — enables **piggyback**: multiple pets from the same tutor on
  the same day share one credit slot if a qualifying entry exists.
- `expirationDate` — credits past this date are excluded from wallet queries.

**Piggyback rule:** When `consumePackageCredits` processes a day, it checks for
an existing `booking_credits` entry for the same date/creditId where
`usedPetsCount < maxPetsPerDay`. If found, the new booking attaches to that slot
(`creditsConsumed = 0`) instead of consuming a new credit.

### Service Credits (`tutor_service_credits`)

Represent pre-purchased service sessions (e.g., 5 baths). Each row is scoped
to a specific `catalogueItemId`. Matching priority:
1. `catalogueItemId` equality (exact match)
2. Normalized service-type name match (e.g., "Banho P", "Banho G" → same type)

### Idempotency gates

| Function | Gate mechanism |
|---|---|
| `releasePurchasedCredits` | `invoice.creditsReleased` flag; `FOR UPDATE` on invoice row |
| `consumePackageCredits` | Checks `booking_credits` for existing rows with this `bookingId` |
| `consumeServiceCreditsForBooking` | Checks `booking_service_credits` for existing rows |

---

## 7. Structured Logging

All financial operations log via `financialLog(params)` from `lib/logger.ts`.
Output format is **NDJSON** (one JSON object per line) written to `stdout`.

### Mandatory fields

| Field | Type | Description |
|---|---|---|
| `ts` | ISO-8601 string | Timestamp |
| `operation` | string | Machine-readable operation name |
| `level` | `"info"` \| `"warn"` \| `"error"` | Defaults to `"info"` |

### Common optional fields

| Field | Description |
|---|---|
| `tenantId` / `crecheId` | Creche ID |
| `tutorId` | Tutor user ID |
| `invoiceId` | Invoice ID |
| `bookingId` | Booking ID |
| `result` | Outcome string (e.g., `"ok"`, `"skipped"`, `"overflow_avulso_created"`) |
| `error` | Error message string (for `level: "error"` entries) |

### Example log entry

```json
{
  "ts": "2026-08-05T12:34:56.789Z",
  "level": "warn",
  "operation": "billing_overflow_avulso",
  "tenantId": 3,
  "tutorId": 42,
  "cycleStart": "2026-08-01",
  "cycleEnd": "2026-08-10",
  "closedStatus": "paid",
  "result": "overflow_avulso_created"
}
```

### Scope

`financialLog` replaces `console.*` in:
- `services/billing.ts`, `services/credits.ts`, `services/orders.ts`
- `lib/financialSync.ts`
- `routes/financial/catalogue.routes.ts`, `invoice.routes.ts`
- `lib/scheduler.ts` — invoice reminder and outbox worker paths

Non-financial scheduler paths (task reminders, plan applicator, suspender,
receipt cleanup, order canceller) use `console.*` which is out of scope for the
financial log.

---

## 8. Billing Cycle Calculation

`BillingService.getCycleDates(mensalidadeDia, txDateStr)` determines the cycle
for a monthly charge:

- If `mensalidadeDia` is null → use `day = 10` as default.
- If today's day ≤ `mensalidadeDia` → the cycle ends this month on `mensalidadeDia`.
- If today's day > `mensalidadeDia` → the cycle ends next month on `mensalidadeDia`.
- Handles month-end overflow (e.g., `mensalidadeDia = 31` in a 30-day month).

The returned `cycleStart` is the day after the previous `cycleEnd` (same `mensalidadeDia`
one month earlier). The unique index on `(tutorId, cycleStart, cycleEnd)` in
`invoicesTable` prevents two monthly invoices for the same cycle.

---

## 9. Key Architectural Invariants

1. **Outbox insert inside transaction** — `OutboxRepository.insert(event, tx)` has
   no default for `tx`; the parameter is required.
2. **One transaction for status + side-effects** — any route that changes order
   status and triggers financial side-effects (credit release, outbox event) does
   so in a single `db.transaction` call.
3. **Concurrency guard via `FOR UPDATE`** — `cancelOrder()` re-reads the order
   with a row lock inside the transaction; `processManualPayment` locks the invoice.
4. **Idempotency via state checks** — all payment and credit functions check the
   current state before writing and return early if already applied.
5. **DDL fail-fast** — if `ensureOutboxSchema()` fails at startup, the process
   exits via `process.exit(1)` rather than serving with a missing table.
6. **Expired-order cancellation is atomic** — the scheduler routes expired orders
   through `cancelOrder()`, not a direct SQL update, so stock restoration, invoice
   voiding, and domain events all commit together.
