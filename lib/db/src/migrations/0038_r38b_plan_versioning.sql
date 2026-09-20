-- =====================================================================
-- ARKPET MIGRATION 0038_r38b_plan_versioning.sql
-- Plan Catalog Versioning, Grandfathering & Safe Subscription Backfill
-- Parent Baseline Commit: 13df258476532d6e7e31e511e15d68ba1c3db698
-- =====================================================================

-- 1. Create plan_versions table
CREATE TABLE IF NOT EXISTS plan_versions (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  version_number INTEGER NOT NULL,
  version_name VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
  pet_limit INTEGER NOT NULL,
  price_brl INTEGER NOT NULL DEFAULT 0,
  features JSONB,
  effective_from TIMESTAMPTZ,
  effective_until TIMESTAMPTZ,
  change_reason TEXT,
  activated_by_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_plan_version_status CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED')),
  CONSTRAINT chk_plan_version_temporal CHECK (
    (status = 'DRAFT' AND effective_from IS NULL AND effective_until IS NULL) OR
    (status = 'ACTIVE' AND effective_from IS NOT NULL AND effective_until IS NULL) OR
    (status = 'SUPERSEDED' AND effective_from IS NOT NULL AND effective_until IS NOT NULL AND effective_until >= effective_from) OR
    (status = 'ARCHIVED' AND effective_from IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_versions_plan_version_unique ON plan_versions(plan_id, version_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_versions_one_active_per_plan ON plan_versions(plan_id) WHERE status = 'ACTIVE';

-- 2. Create plan_version_prices table
CREATE TABLE IF NOT EXISTS plan_version_prices (
  id SERIAL PRIMARY KEY,
  plan_version_id INTEGER NOT NULL REFERENCES plan_versions(id) ON DELETE CASCADE,
  interval billing_interval NOT NULL,
  price_brl INTEGER NOT NULL,
  stripe_price_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_plan_version_price_non_negative CHECK (price_brl >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_version_prices_version_interval_unique ON plan_version_prices(plan_version_id, interval);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_version_prices_stripe_price_id_unique ON plan_version_prices(stripe_price_id) WHERE stripe_price_id IS NOT NULL;

-- 3. Create unresolved_subscription_versions table (Category 05 Ledger)
CREATE TABLE IF NOT EXISTS unresolved_subscription_versions (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  creche_id INTEGER NOT NULL,
  diagnostic_category VARCHAR(100) NOT NULL,
  notes TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by_user_id INTEGER REFERENCES users(id),
  resolution_action TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE unresolved_subscription_versions DROP CONSTRAINT IF EXISTS unresolved_subscription_versions_creche_id_fkey;

CREATE INDEX IF NOT EXISTS idx_unresolved_sub_versions_sub_id ON unresolved_subscription_versions(subscription_id);
CREATE INDEX IF NOT EXISTS idx_unresolved_sub_versions_creche_id ON unresolved_subscription_versions(creche_id);

-- 4. Create billing_webhook_errors table (Durable unknown Stripe price intake)
CREATE TABLE IF NOT EXISTS billing_webhook_errors (
  id SERIAL PRIMARY KEY,
  event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(255) NOT NULL,
  stripe_price_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  customer_id VARCHAR(255),
  raw_payload JSONB NOT NULL,
  error_code VARCHAR(100),
  error_message TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING_RECONCILIATION',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by VARCHAR(255),
  resolution_note TEXT,
  CONSTRAINT uq_billing_webhook_errors_event_id UNIQUE (event_id),
  CONSTRAINT chk_billing_webhook_errors_status CHECK (status IN ('PENDING_RECONCILIATION', 'PROCESSING', 'RESOLVED', 'FAILED_FINAL'))
);

-- 5. Add R38.B columns to subscriptions table
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan_version_id INTEGER REFERENCES plan_versions(id);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan_version_price_id INTEGER REFERENCES plan_version_prices(id);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS contracted_price_cents INTEGER;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS contracted_stripe_price_id TEXT;

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS scheduled_plan_version_id INTEGER REFERENCES plan_versions(id);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS scheduled_plan_version_price_id INTEGER REFERENCES plan_version_prices(id);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS scheduled_price_cents INTEGER;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS scheduled_stripe_price_id TEXT;

CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_version_id ON subscriptions(plan_version_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_version_price_id ON subscriptions(plan_version_price_id);

-- Ensure commercial condition schema alignment
ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS assigned_benefit_id INTEGER;

-- 6. Immutability Triggers

-- Trigger function: plan_versions immutability barrier
CREATE OR REPLACE FUNCTION fn_plan_versions_immutable_check()
RETURNS TRIGGER AS $$
BEGIN
  -- If row is in published state (ACTIVE, SUPERSEDED, ARCHIVED)
  IF OLD.status IN ('ACTIVE', 'SUPERSEDED', 'ARCHIVED') THEN
    -- Disallow mutating commercial fields
    IF NEW.plan_id <> OLD.plan_id OR
       NEW.version_number <> OLD.version_number OR
       NEW.pet_limit <> OLD.pet_limit OR
       NEW.price_brl <> OLD.price_brl OR
       NEW.features IS DISTINCT FROM OLD.features THEN
      RAISE EXCEPTION 'ERR_COMMERCIAL_FIELDS_IMMUTABLE: Cannot modify commercial fields of a published plan version (status: %)', OLD.status;
    END IF;

    -- Enforce valid lifecycle transitions
    IF OLD.status = 'ACTIVE' AND NEW.status NOT IN ('ACTIVE', 'SUPERSEDED') THEN
      RAISE EXCEPTION 'ERR_INVALID_LIFECYCLE_TRANSITION: Active version can only transition to SUPERSEDED';
    END IF;

    IF OLD.status = 'SUPERSEDED' AND NEW.status NOT IN ('SUPERSEDED', 'ARCHIVED') THEN
      RAISE EXCEPTION 'ERR_CANNOT_REACTIVATE_SUPERSEDED_VERSION: Superseded version can only transition to ARCHIVED';
    END IF;

    IF OLD.status = 'ARCHIVED' AND NEW.status <> 'ARCHIVED' THEN
      RAISE EXCEPTION 'ERR_INVALID_LIFECYCLE_TRANSITION: Archived version is immutable and cannot change status';
    END IF;
  ELSIF OLD.status = 'DRAFT' THEN
    IF NEW.status = 'ARCHIVED' THEN
      RAISE EXCEPTION 'ERR_INVALID_LIFECYCLE_TRANSITION: Draft version cannot transition directly to ARCHIVED';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_plan_versions_before_update ON plan_versions;
CREATE TRIGGER trg_plan_versions_before_update
BEFORE UPDATE ON plan_versions
FOR EACH ROW EXECUTE FUNCTION fn_plan_versions_immutable_check();

-- Trigger function: plan_versions delete barrier
CREATE OR REPLACE FUNCTION fn_plan_versions_delete_check()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'ACTIVE' THEN
    RAISE EXCEPTION 'ERR_CANNOT_DELETE_ACTIVE_VERSION: Cannot delete active plan version';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_plan_versions_before_delete ON plan_versions;
CREATE TRIGGER trg_plan_versions_before_delete
BEFORE DELETE ON plan_versions
FOR EACH ROW EXECUTE FUNCTION fn_plan_versions_delete_check();

-- Trigger function: plan_version_prices immutability barrier
CREATE OR REPLACE FUNCTION fn_plan_version_prices_immutable_check()
RETURNS TRIGGER AS $$
DECLARE
  v_status VARCHAR(50);
BEGIN
  SELECT status INTO v_status FROM plan_versions WHERE id = OLD.plan_version_id;
  IF v_status IN ('ACTIVE', 'SUPERSEDED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'ERR_PRICE_ROW_IMMUTABLE: Cannot mutate published price rows (version status: %)', v_status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_plan_version_prices_before_update ON plan_version_prices;
CREATE TRIGGER trg_plan_version_prices_before_update
BEFORE UPDATE ON plan_version_prices
FOR EACH ROW EXECUTE FUNCTION fn_plan_version_prices_immutable_check();

-- Trigger function: plan_version_prices delete barrier
CREATE OR REPLACE FUNCTION fn_plan_version_prices_delete_check()
RETURNS TRIGGER AS $$
DECLARE
  v_status VARCHAR(50);
BEGIN
  SELECT status INTO v_status FROM plan_versions WHERE id = OLD.plan_version_id;
  IF v_status IN ('ACTIVE', 'SUPERSEDED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'ERR_CANNOT_DELETE_PUBLISHED_PRICE: Cannot delete price row of a published version (status: %)', v_status;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_plan_version_prices_before_delete ON plan_version_prices;
CREATE TRIGGER trg_plan_version_prices_before_delete
BEFORE DELETE ON plan_version_prices
FOR EACH ROW EXECUTE FUNCTION fn_plan_version_prices_delete_check();

-- 7. Baseline Catalog Seed (v1 for all existing plans)
DO $$
DECLARE
  r_plan RECORD;
  v_version_id INTEGER;
  r_price RECORD;
  v_pet_limit INTEGER;
  v_price_brl INTEGER;
BEGIN
  FOR r_plan IN SELECT * FROM plans ORDER BY id LOOP
    -- Only seed v1 if no versions exist for this plan yet
    IF NOT EXISTS (SELECT 1 FROM plan_versions WHERE plan_id = r_plan.id) THEN
      IF LOWER(r_plan.name) LIKE '%trial%' THEN
        v_pet_limit := 30; -- Database reality: Trial has pet_limit = 30
        v_price_brl := 0;
      ELSE
        v_pet_limit := r_plan.pet_limit;
        v_price_brl := r_plan.price_brl;
      END IF;

      INSERT INTO plan_versions (
        plan_id,
        version_number,
        version_name,
        status,
        pet_limit,
        price_brl,
        effective_from,
        change_reason
      ) VALUES (
        r_plan.id,
        1,
        r_plan.name || ' v1',
        'ACTIVE',
        v_pet_limit,
        v_price_brl,
        NOW(),
        'MIGRATION_BASELINE_CURRENT_CATALOG'
      ) RETURNING id INTO v_version_id;

      -- Seed plan_version_prices from existing plan_prices (Trial has 0 prices)
      IF LOWER(r_plan.name) NOT LIKE '%trial%' THEN
        FOR r_price IN SELECT * FROM plan_prices WHERE plan_id = r_plan.id LOOP
          INSERT INTO plan_version_prices (
            plan_version_id,
            interval,
            price_brl,
            stripe_price_id
          ) VALUES (
            v_version_id,
            r_price.interval,
            r_price.price_brl,
            r_price.stripe_price_id
          ) ON CONFLICT DO NOTHING;
        END LOOP;
      END IF;
    END IF;
  END LOOP;
END $$;

-- 8. Subscription Backfill (Safe Evidence-Based Backfill)
DO $$
DECLARE
  v_trial_plan_id INTEGER;
  v_trial_version_id INTEGER;
  r_sub RECORD;
  v_target_version_id INTEGER;
  v_target_price_id INTEGER;
  v_price_brl INTEGER;
  v_stripe_price_id TEXT;
BEGIN
  -- 8.1 Trial Subscriptions Backfill
  SELECT id INTO v_trial_plan_id FROM plans WHERE LOWER(name) LIKE '%trial%' LIMIT 1;
  IF v_trial_plan_id IS NOT NULL THEN
    SELECT id INTO v_trial_version_id FROM plan_versions WHERE plan_id = v_trial_plan_id AND version_number = 1 LIMIT 1;
    IF v_trial_version_id IS NOT NULL THEN
      UPDATE subscriptions
      SET plan_version_id = v_trial_version_id,
          plan_version_price_id = NULL,
          contracted_price_cents = 0,
          contracted_stripe_price_id = NULL,
          billing_interval = NULL
      WHERE (status = 'trial' OR plan_id = v_trial_plan_id)
        AND plan_version_id IS NULL;
    END IF;
  END IF;

  -- 8.2 Paid Subscriptions with Reliable Evidence
  FOR r_sub IN
    SELECT s.id, s.creche_id, s.plan_id, s.billing_interval, s.stripe_subscription_id
    FROM subscriptions s
    WHERE s.plan_version_id IS NULL
      AND (s.status <> 'trial' AND s.plan_id <> COALESCE(v_trial_plan_id, -1))
  LOOP
    -- If subscription has billing_interval, resolve price from active v1
    IF r_sub.billing_interval IS NOT NULL THEN
      SELECT pv.id, pvp.id, pvp.price_brl, pvp.stripe_price_id
      INTO v_target_version_id, v_target_price_id, v_price_brl, v_stripe_price_id
      FROM plan_versions pv
      JOIN plan_version_prices pvp ON pvp.plan_version_id = pv.id
      WHERE pv.plan_id = r_sub.plan_id
        AND pv.status = 'ACTIVE'
        AND pvp.interval = r_sub.billing_interval
      LIMIT 1;

      IF v_target_version_id IS NOT NULL AND v_target_price_id IS NOT NULL THEN
        UPDATE subscriptions
        SET plan_version_id = v_target_version_id,
            plan_version_price_id = v_target_price_id,
            contracted_price_cents = v_price_brl,
            contracted_stripe_price_id = v_stripe_price_id
        WHERE id = r_sub.id;
      ELSE
        -- Log unresolved paid subscription
        INSERT INTO unresolved_subscription_versions (
          subscription_id,
          creche_id,
          diagnostic_category,
          notes
        ) VALUES (
          r_sub.id,
          r_sub.creche_id,
          'PAID_WITHOUT_PRICE_EVIDENCE',
          'Paid subscription with interval but no matching version price row found'
        );
      END IF;
    ELSE
      -- Category 05: Paid subscription with NULL billing_interval and no price evidence
      -- Leaves plan_version_id = NULL, contracted_price_cents = NULL (Zero speculation)
      INSERT INTO unresolved_subscription_versions (
        subscription_id,
        creche_id,
        diagnostic_category,
        notes
      ) VALUES (
        r_sub.id,
        r_sub.creche_id,
        'PAID_WITHOUT_PRICE_EVIDENCE',
        'Active paid subscription without billing interval or Stripe subscription binding'
      );
    END IF;
  END LOOP;
END $$;
