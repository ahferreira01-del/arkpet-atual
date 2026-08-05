---
name: Financial outbox & structured logging
description: Durable invariants for the financial_outbox pattern and structured logging. What future financial features must respect.
---

# Financial Outbox & Structured Logging — Invariants

## Hard rules

1. **Outbox inserts must share the same transaction as the main write.**
   `OutboxRepository.insert(event, tx)` takes a required `tx`. Never call it outside a transaction.

2. **Order cancellation must be atomic.**
   `cancelOrder()` includes the `status → cancelled` update inside its own transaction alongside the outbox events. The route early-returns after calling it — never do a separate status write.

3. **Each outbox event is processed in its own `db.transaction`.**
   The worker calls `processOneOutboxEvent()` in a loop. Each invocation does `SELECT … LIMIT 1 FOR UPDATE SKIP LOCKED` + process + `UPDATE status`. If the DB fails mid-update, the transaction rolls back and the event stays `pending` for the next tick. No cross-event pollution.

4. **Bounded retry: events exceeding the retry threshold become `failed` (dead-letter).**
   On processing error, `retryCount` is incremented atomically. Once it reaches the configured max, status is set to `failed`. If even that update fails, the transaction rolls back and the event stays `pending` — still retried next tick.

5. **DDL failure must abort startup.**
   `ensureOutboxSchema()` does NOT catch errors; a missing table means every subsequent financial mutation fails at the outbox insert, so it is better to fail fast at boot.

6. **All financial log output uses `financialLog()` from `lib/logger.ts`.**
   Covers: services/billing, services/credits, services/orders, lib/financialSync, routes/financial/*, lib/scheduler outbox section.

7. **Every financial mutation path emits the matching domain event inside its transaction.**
   Paid invoice → `InvoicePaid`. Voided (only if UPDATE matched via `.returning()`) → `InvoiceVoided`. Refunded → `InvoiceRefunded`. Order cancelled → `OrderCancelled`. Order paid/delivered → `OrderPaid`. Credits released/consumed/restored → respective events.

**Why:** Outbox atomicity is the only guarantee events are not lost when a transaction rolls back. Per-event isolation in the worker ensures retry counts survive individual failures. DDL fail-fast prevents silent boot with a missing table.
