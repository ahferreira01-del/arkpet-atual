---
name: Receivables collector safety
description: Immutability, successor-period, hint-validation, and transaction-lock rules for tutor receivables.
---

## Editable collector rule

Only an invoice in `pending` status whose `dueDate` is on or after the current business date may receive or lose line items. Awaiting confirmation, paid, overdue, voided, refunded, and past-due pending invoices are frozen financial history.

**Why:** Proof submission, payment, delinquency, cancellation, and expiry all create an accounting boundary. Mutating amounts or items after that boundary makes the historical invoice disagree with what was presented or settled.

**How to apply:** Any charge, cancellation reversal, item refund, or order void that would change invoice amount/items/status must apply this rule before its first financial side effect. Paid item refunds preserve the invoice and use compensating transactions.

## Successor periods

When the effective period is frozen, route the charge to the first applicable later period with a normal `cycleStart`, `cycleEnd`, and `dueDate`. Never create a cycle-less overflow invoice for monthly receivables.

**Why:** Receivables are grouped by creche, tutor, and due period—not by one lifetime balance and not by arbitrary overflow records.

**How to apply:** Advance period by period until finding an editable collector or an unused non-expired period. The due date itself remains editable; only dates before the business date are expired.

## Concurrency and lock order

Acquire the transaction-scoped advisory lock for `(crecheId, tutorId)` before resolving a monthly collector or taking financial row locks. When linked orders may be touched, lock orders in deterministic ID order before the invoice. POS takes the tutor lock before catalogue rows; booking confirmation and checkout take it before booking/credit work.

**Why:** Row locks alone do not serialize two concurrent first-invoice inserts, and mixed order/invoice/catalogue acquisition created AB/BA deadlock cycles.

**How to apply:** Keep the advisory lock inside the database transaction and never hold it across Stripe, email, push, Object Storage, or other external I/O. For a supplied invoice ID, treat it only as a hint: validate creche, tutor, period, status, and due date again under row lock.

## Current tenant constraint

The current user model gives each globally unique tutor ID one `crecheId` and has no multi-creche membership table, so the existing tutor-period unique index is sufficient for legitimate data. The hotfix intentionally made no migration.

**Why:** Schema and constraint changes were explicitly out of scope, and there is no valid current case where one tutor ID needs same-period collectors in two creches.

**How to apply:** If tutors ever gain multi-creche memberships, migrate the collector unique key and re-audit advisory lock identity before enabling that model.