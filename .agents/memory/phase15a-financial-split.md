---
name: Financial module layered architecture
description: Decision to split the financial monolith into repositories/services/routes; key invariants every future edit must respect.
---

# Financial Module — Layered Architecture

**Why:** The financial module was a single 1,500-line file mixing SQL, business logic, and HTTP. Any future financial feature must follow the layered split to stay maintainable and testable.

## Invariants that must hold

1. **No SQL in routes or services.** All Drizzle queries live in `repositories/*.repository.ts`. Services call repositories; routes call services (or repositories for read-only queries where there is no business logic).
2. **All financial routes that mutate data require `requireFinancialAccess`.** This middleware is in `routes/financial/middleware.ts` and blocks tutors with 403. Do NOT skip it on mutation endpoints — the refund, pay, void, approve, and adjustment routes must all include it.
3. **Repositories accept an optional `tx?: any` parameter.** Use the `c(tx)` helper from `repositories/shared.ts` — never pass `db` directly inside a repository when a transaction might be active.
4. **BillingService invariants (from Phase 14) must stay intact:** `addCharge` overflow-avulso flag, `InvoiceStateMachine` state machine, snapshot columns on `invoice_items`.

## Shared helpers to know about

- `repositories/shared.ts` exports: `c(tx)`, `getPaginationParams`, `getTutorMensalidadeDia`, `getCrecheAdminEmail`
- `BillingService.refundItem()` — partial item refund; restores stock, adjusts pending invoice totals, or creates a negative transaction on paid invoices.

**How to apply:** Any new financial endpoint → new thin route file under `routes/financial/`, import a repository or service, include `requireFinancialAccess` if the operation mutates data.
