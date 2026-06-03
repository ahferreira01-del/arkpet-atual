---
name: Billing checkout confirm trust boundary
description: How /billing/confirm must validate a Stripe Checkout session before activating a creche subscription
---

# /billing/confirm activation gate

The success-redirect confirm endpoint (`POST /billing/confirm {sessionId}`) flips the
app subscription to `active` for immediate UX. The managed webhook (stripe-replit-sync)
remains the source of truth for later lifecycle, but the confirm endpoint must still be
strict because the client controls `sessionId`.

Three checks are mandatory, in order:
1. **Tenant isolation** — `session.metadata.crecheId` must equal `req.user.crecheId`, else 403.
2. **Money gate** — require `session.payment_status === "paid"`. Do NOT also accept
   `session.status === "complete"`: a complete session can still be unpaid, which would
   grant entitlement before the charge succeeds.
3. **Plan derivation** — resolve the plan from the *purchased price*
   (`session.line_items.data[0].price.id` → `plans.stripePriceId`), NOT from
   `session.metadata.planId`. Metadata is client-influenceable and can drift; the price
   actually charged is authoritative.

**Why:** architect review caught that gating on `complete` and trusting metadata.planId
let a subscription activate without confirmed payment / with a mismatched plan — a
direct money/entitlement bug.

**How to apply:** retrieve the session with `expand: ["subscription", "line_items"]`.
Any future endpoint that grants entitlement from a Checkout session must follow the same
three-check pattern.
