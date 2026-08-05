---
name: Financial module audit
description: Complete audit + all business rules for the financial module (billing, invoices, credits, orders, catalogue). Full doc at .agents/docs/financial-module-audit.md
---

Full document: `.agents/docs/financial-module-audit.md`

## Critical open bugs (B1–B5)
- **B1** Stripe `unit_amount` = `Math.round(basePrice)` without ×100 → charges in cents not reais (`financial.ts:~919`)
- **B2** Stripe webhook `checkout.session.completed` never calls `releasePurchasedCredits`
- **B3** `releasePurchasedCredits` reads `creditsReleased` without `FOR UPDATE` → concurrent approvals can double-release credits (`credits.ts:25`)
- **B4** `addCharge` (monthly) resets a `paid` invoice to `pending` when a new booking is added to the same cycle (`billing.ts:302–305`)
- **B5** `SELECT tutor_credits` in bookings has no `FOR UPDATE` before `UPDATE usedCredits+1` — two concurrent booking confirmations can overdraft the balance

## Key architectural inconsistencies
- Two parallel purchase paths: `/packages/purchase` (legacy, no UI) and `/orders` (current)
- Two credit tables: `tutor_credits` (diárias) and `tutor_service_credits` (services) — different schemas
- Monetary fields stored as varchar → manual `parseFloat()` everywhere
- `calculateDueDate` (local TZ) vs `getCycleDates` (UTC) — same purpose, different timezone handling

**Why:** Documented August 2026 after session-wide financial module audit. Use this as the reference before any financial module change.
