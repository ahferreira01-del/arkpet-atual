---
name: Subscription grandfathering for sub-less creches
description: Product decision — creches without a subscription row are intentionally left ungated (no pet limit, no inactive-subscription block).
---

# Creches without a subscription are intentionally ungated

A creche that has no row in `subscriptions` bypasses ALL billing gates: no pet
limit (`checkPetLimit`), no inactive-subscription block (`requireActiveSubscription`),
and no in-form upgrade banner on the pet creation modal (frontend `isBlocked`
stays false because `GET /billing/subscription` returns 404).

**Why:** The owner explicitly chose "deixar livres" for pre-existing creches. When
the billing system is first published, the existing production creches (3 at the
time of this decision) will have no subscription rows and must keep operating with
no limit — treated as grandfathered/courtesy tenants. The billing system (plans +
subscriptions tables) was NOT yet deployed to production when this was decided;
only self-registered creches get a trial subscription and are therefore gated.

**How to apply:** Do NOT build any backfill/migration that assigns a default plan
to sub-less creches unless the owner reverses this decision. Keep the `if (!sub)
next()` bypass in both gating middlewares and the 404-means-unblocked behavior on
the client. New gating logic must preserve "no subscription = no limit".
