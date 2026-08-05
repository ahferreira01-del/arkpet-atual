---
name: Financial outbox & structured logging
description: Durable invariants every financial feature must respect — outbox atomicity, fail-fast startup, and structured logging scope.
---

# Financial Outbox & Structured Logging — Invariants

## Rules

**1. Outbox insert must share a transaction with the triggering write.**
`OutboxRepository.insert(event, tx)` takes a required `tx`. There is no default. Calling it outside a transaction is a bug.

**2. Any status mutation that triggers financial side-effects must be one transaction.**
The status column update, credit release, and outbox event insert must all be in the same `db.transaction(...)` call. A two-step "update first, then transact" pattern violates atomicity: if the second step fails the domain record is already in the new state with no event emitted.

**3. Per-event isolation in the outbox worker.**
Each `processOneOutboxEvent()` call opens and closes its own transaction. A DB failure on one event's status update rolls back only that event (it retries next tick). Cross-event pollution is impossible. `SELECT … FOR UPDATE SKIP LOCKED` prevents concurrent ticks from double-processing the same event.

**4. DDL failure must terminate the process.**
`initializeDatabase()` does not swallow errors — the catch handler calls `process.exit(1)`. If the outbox schema cannot be created, the process exits so that the health-check / deploy health-probe fails rather than serving a process where every financial write will fail.

**5. Structured logging covers all financial scheduler paths.**
`financialLog()` replaces `console.*` in: billing, credits, orders services; financialSync; invoice route handlers; the outbox worker (both per-event errors and the top-level worker error); and the invoice reminder scheduler. Non-financial schedulers (task reminders, plan changes, receipts, subscription suspender, order canceller) may still use `console.*`.

**Why:** The whole point of the outbox pattern is atomicity — an event that is inserted in a separate transaction can be lost if the surrounding write rolls back. DDL fail-fast prevents the silent failure mode where the API boots and appears healthy but every payment mutation crashes at the outbox insert. Structured logging enables alerting on financial anomalies without grepping free-text lines.
