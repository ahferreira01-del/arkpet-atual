---
name: stripe-replit-sync enum name collision
description: Why stripe-replit-sync migrations fail with "type stripe.X does not exist" and how to fix
---

# stripe-replit-sync enum collision with app pgEnum names

stripe-replit-sync migrations create enum types guarded by an UNQUALIFIED check:
`IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status')`.
This matches an enum of the same name in ANY schema (e.g. the app's `public`
schema). When matched, it skips creating `stripe.subscription_status`, then the
`CREATE TABLE stripe.subscriptions` referencing that type fails with
`type "stripe.subscription_status" does not exist`, rolling back and aborting all
later migrations (so the stripe schema is left half-built).

**Colliding enum names to avoid in the app's own schema:** `subscription_status`,
`invoice_status`, `subscription_schedule_status`, `pricing_tiers`, `pricing_type`.

**Fix:** rename the app enum so it no longer collides, e.g.
`ALTER TYPE public.subscription_status RENAME TO creche_subscription_status;`
then update the drizzle `pgEnum("creche_subscription_status", ...)` name and
rebuild lib/db. The failed migration was never recorded in `stripe._migrations`,
so it retries cleanly on next `runMigrations`/server boot.

**Why:** the app defined `subscription_status` in Sprint 1; renaming it (rather
than the vendor migration) is the only practical fix since the vendor SQL is fixed.
**How to apply:** before adding any new app pgEnum, avoid the names above.
