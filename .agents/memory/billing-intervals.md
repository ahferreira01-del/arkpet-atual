---
name: Billing intervals model
description: How multi-interval (mensal/trimestral/semestral/anual) plan pricing is wired and the operational step required after price changes.
---

# Multi-interval billing

Plans support 4 billing intervals via a `plan_prices` table (one row per plan×interval,
each with its own `stripePriceId`). `plans.priceBrl` stays the monthly base and
`plans.stripePriceId` mirrors the monthly price for backward compatibility.
`subscriptions.billingInterval` records the chosen interval.

The discount preset (quarter 5%, semester 8%, year 15%) and the price math live in
ONE place: `lib/db/src/billing.ts` (`computeIntervalPrice`, `INTERVAL_*`,
`stripeRecurringFor`). DB seeding, Stripe price creation and the UI all import from
there so they never drift.

**Operational rule — running after any price/plan change:**
App startup (`startup.ts`) only seeds `plan_prices` ROWS with `stripePriceId = NULL`.
The actual Stripe prices are created by the manual script
`pnpm --filter @workspace/scripts exec tsx src/seed-stripe.ts`, which backfills
`stripePriceId`. Until that script runs, non-monthly checkout returns 400 (monthly
falls back to legacy `plans.stripePriceId`).

**Why:** decouples DB seeding (safe, automatic) from Stripe API calls (needs the
connector, must be idempotent, run intentionally). Forgetting the script = new
intervals look priced in the UI but are not purchasable.

**How to apply:** after editing `DEFAULT_PLANS` prices or discount preset, re-run
seed-stripe so Stripe prices and `plan_prices.stripePriceId` are recreated/updated.
seed-stripe is self-healing (creates missing plan_prices rows) and idempotent
(reuses matching active Stripe prices by amount + recurring interval/count).
