-- =====================================================================
-- ARKPET DOWN-MIGRATION 0038_r38b_plan_versioning.down.sql
-- Disposable CI/Testing Down-Migration ONLY.
-- GUARDED AGAINST PRODUCTION EXECUTION.
-- =====================================================================

-- 1. Production Safety Guard
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM subscriptions WHERE plan_version_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot drop plan_versions in production: bound subscriptions exist';
  END IF;
END $$;

-- 2. Drop triggers and trigger functions
DROP TRIGGER IF EXISTS trg_plan_version_prices_before_delete ON plan_version_prices;
DROP TRIGGER IF EXISTS trg_plan_version_prices_before_update ON plan_version_prices;
DROP FUNCTION IF EXISTS fn_plan_version_prices_delete_check();
DROP FUNCTION IF EXISTS fn_plan_version_prices_immutable_check();

DROP TRIGGER IF EXISTS trg_plan_versions_before_delete ON plan_versions;
DROP TRIGGER IF EXISTS trg_plan_versions_before_update ON plan_versions;
DROP FUNCTION IF EXISTS fn_plan_versions_delete_check();
DROP FUNCTION IF EXISTS fn_plan_versions_immutable_check();

-- 3. Drop columns from subscriptions
ALTER TABLE subscriptions DROP COLUMN IF EXISTS scheduled_stripe_price_id;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS scheduled_price_cents;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS scheduled_plan_version_price_id;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS scheduled_plan_version_id;

ALTER TABLE subscriptions DROP COLUMN IF EXISTS contracted_stripe_price_id;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS contracted_price_cents;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS plan_version_price_id;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS plan_version_id;

-- 4. Drop tables in reverse dependency order
DROP TABLE IF EXISTS billing_webhook_errors CASCADE;
DROP TABLE IF EXISTS unresolved_subscription_versions CASCADE;
DROP TABLE IF EXISTS plan_version_prices CASCADE;
DROP TABLE IF EXISTS plan_versions CASCADE;
