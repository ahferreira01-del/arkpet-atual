-- =====================================================================
-- ARKPET MIGRATION 0039_r38c_unified_entitlements.sql
-- Unified Entitlements, Tenant Storage Ledger & Creche Invitations
-- Parent Baseline Commit: 5db3d8f99438f795010dab665b2a30e84c0f9c31
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- STEP A: Add nullable columns & create foundation tables
-- ---------------------------------------------------------------------

-- 1. Add nullable columns on existing tables
ALTER TABLE plan_versions ADD COLUMN IF NOT EXISTS staff_limit INTEGER;
ALTER TABLE plan_versions ADD COLUMN IF NOT EXISTS storage_bytes_limit BIGINT;

ALTER TABLE plans ADD COLUMN IF NOT EXISTS staff_limit INTEGER;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS storage_bytes_limit BIGINT;

ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS entitlement_staff_limit INTEGER;
ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS entitlement_storage_bytes_limit BIGINT;

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS scheduled_status VARCHAR(50);

-- 2. Create tenant_storage_ledger table
CREATE TABLE IF NOT EXISTS tenant_storage_ledger (
  creche_id INTEGER PRIMARY KEY REFERENCES creches(id),
  used_bytes BIGINT NOT NULL DEFAULT 0,
  reserved_bytes BIGINT NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_tenant_storage_ledger_used_bytes CHECK (used_bytes >= 0),
  CONSTRAINT chk_tenant_storage_ledger_reserved_bytes CHECK (reserved_bytes >= 0),
  CONSTRAINT chk_tenant_storage_ledger_file_count CHECK (file_count >= 0)
);

-- 3. Create storage_files table
CREATE TABLE IF NOT EXISTS storage_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creche_id INTEGER NOT NULL REFERENCES creches(id),
  file_key VARCHAR(1024) NOT NULL UNIQUE,
  size_bytes BIGINT NOT NULL,
  content_type VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'reserved',
  reservation_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT chk_storage_files_status CHECK (
    status IN (
      'reserved',
      'confirmed',
      'deleting',
      'deleted',
      'expired_cleanup_deleting',
      'abandoned',
      'rejected_overflow_deleting',
      'rejected_overflow_deleted'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_storage_files_creche_id ON storage_files(creche_id);
CREATE INDEX IF NOT EXISTS idx_storage_files_status ON storage_files(status);

-- 4. Create creche_invitations table
CREATE TABLE IF NOT EXISTS creche_invitations (
  id SERIAL PRIMARY KEY,
  creche_id INTEGER NOT NULL REFERENCES creches(id),
  email VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  invited_by_user_id INTEGER REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_creche_invitations_status CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  CONSTRAINT chk_creche_invitations_role CHECK (role IN ('creche_admin', 'staff', 'tutor'))
);

CREATE INDEX IF NOT EXISTS idx_creche_invitations_creche_id ON creche_invitations(creche_id);
CREATE INDEX IF NOT EXISTS idx_creche_invitations_email ON creche_invitations(email);
CREATE INDEX IF NOT EXISTS idx_creche_invitations_status ON creche_invitations(status);

-- 5. Add CHECK constraint on subscriptions.scheduled_status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'subscriptions'::regclass
      AND conname = 'chk_subscriptions_scheduled_status'
  ) THEN
    ALTER TABLE subscriptions
      ADD CONSTRAINT chk_subscriptions_scheduled_status
      CHECK (scheduled_status IN ('PENDING', 'FAILED_OVER_QUOTA') OR scheduled_status IS NULL);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- STEP B.0: Pre-Bootstrap Drift & Unmapped Version Guard
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_expected_staff INTEGER;
  v_expected_storage BIGINT;
BEGIN
  FOR r IN
    SELECT pv.id, pv.plan_id, pv.version_number, pv.status, pv.staff_limit, pv.storage_bytes_limit, LOWER(p.name) as plan_name
    FROM plan_versions pv
    JOIN plans p ON p.id = pv.plan_id
  LOOP
    IF r.plan_name LIKE '%trial%' THEN
      v_expected_staff := 2;
      v_expected_storage := 2147483648;
      IF r.staff_limit IS NOT NULL AND r.staff_limit <> v_expected_staff THEN
        RAISE EXCEPTION 'PRE_BOOTSTRAP_DRIFT: Trial plan_id=% version=% has invalid non-null staff_limit=% (expected %)', r.plan_id, r.version_number, r.staff_limit, v_expected_staff;
      END IF;
      IF r.storage_bytes_limit IS NOT NULL AND r.storage_bytes_limit <> v_expected_storage THEN
        RAISE EXCEPTION 'PRE_BOOTSTRAP_DRIFT: Trial plan_id=% version=% has invalid non-null storage_bytes_limit=% (expected %)', r.plan_id, r.version_number, r.storage_bytes_limit, v_expected_storage;
      END IF;

    ELSIF r.plan_name LIKE '%starter%' THEN
      v_expected_staff := 3;
      v_expected_storage := 5368709120;
      IF r.staff_limit IS NOT NULL AND r.staff_limit <> v_expected_staff THEN
        RAISE EXCEPTION 'PRE_BOOTSTRAP_DRIFT: Starter plan_id=% version=% has invalid non-null staff_limit=% (expected %)', r.plan_id, r.version_number, r.staff_limit, v_expected_staff;
      END IF;
      IF r.storage_bytes_limit IS NOT NULL AND r.storage_bytes_limit <> v_expected_storage THEN
        RAISE EXCEPTION 'PRE_BOOTSTRAP_DRIFT: Starter plan_id=% version=% has invalid non-null storage_bytes_limit=% (expected %)', r.plan_id, r.version_number, r.storage_bytes_limit, v_expected_storage;
      END IF;

    ELSIF r.plan_name LIKE '%essencial%' THEN
      v_expected_staff := 5;
      v_expected_storage := 16106127360;
      IF r.staff_limit IS NOT NULL AND r.staff_limit <> v_expected_staff THEN
        RAISE EXCEPTION 'PRE_BOOTSTRAP_DRIFT: Essencial plan_id=% version=% has invalid non-null staff_limit=% (expected %)', r.plan_id, r.version_number, r.staff_limit, v_expected_staff;
      END IF;
      IF r.storage_bytes_limit IS NOT NULL AND r.storage_bytes_limit <> v_expected_storage THEN
        RAISE EXCEPTION 'PRE_BOOTSTRAP_DRIFT: Essencial plan_id=% version=% has invalid non-null storage_bytes_limit=% (expected %)', r.plan_id, r.version_number, r.storage_bytes_limit, v_expected_storage;
      END IF;

    ELSIF r.plan_name LIKE '%pro%' THEN
      v_expected_staff := 10;
      v_expected_storage := 32212254720;
      IF r.staff_limit IS NOT NULL AND r.staff_limit <> v_expected_staff THEN
        RAISE EXCEPTION 'PRE_BOOTSTRAP_DRIFT: Pro plan_id=% version=% has invalid non-null staff_limit=% (expected %)', r.plan_id, r.version_number, r.staff_limit, v_expected_staff;
      END IF;
      IF r.storage_bytes_limit IS NOT NULL AND r.storage_bytes_limit <> v_expected_storage THEN
        RAISE EXCEPTION 'PRE_BOOTSTRAP_DRIFT: Pro plan_id=% version=% has invalid non-null storage_bytes_limit=% (expected %)', r.plan_id, r.version_number, r.storage_bytes_limit, v_expected_storage;
      END IF;

    ELSIF r.plan_name LIKE '%premium%' THEN
      v_expected_staff := 20;
      v_expected_storage := 64424509440;
      IF r.staff_limit IS NOT NULL AND r.staff_limit <> v_expected_staff THEN
        RAISE EXCEPTION 'PRE_BOOTSTRAP_DRIFT: Premium plan_id=% version=% has invalid non-null staff_limit=% (expected %)', r.plan_id, r.version_number, r.staff_limit, v_expected_staff;
      END IF;
      IF r.storage_bytes_limit IS NOT NULL AND r.storage_bytes_limit <> v_expected_storage THEN
        RAISE EXCEPTION 'PRE_BOOTSTRAP_DRIFT: Premium plan_id=% version=% has invalid non-null storage_bytes_limit=% (expected %)', r.plan_id, r.version_number, r.storage_bytes_limit, v_expected_storage;
      END IF;

    ELSIF r.plan_name LIKE '%enterprise%' THEN
      IF r.staff_limit IS NOT NULL THEN
        RAISE EXCEPTION 'PRE_BOOTSTRAP_DRIFT: Enterprise plan_id=% version=% has invalid non-null staff_limit=% (expected NULL)', r.plan_id, r.version_number, r.staff_limit;
      END IF;
      IF r.storage_bytes_limit IS NOT NULL AND r.storage_bytes_limit <> 107374182400 THEN
        RAISE EXCEPTION 'PRE_BOOTSTRAP_DRIFT: Enterprise plan_id=% version=% has invalid non-null storage_bytes_limit=% (expected 107374182400)', r.plan_id, r.version_number, r.storage_bytes_limit;
      END IF;

    ELSE
      -- Unmapped plan version encountered
      RAISE EXCEPTION 'ERR_R38C_UNMAPPED_PLAN_VERSION: Unmapped plan encountered in pre-bootstrap guard (plan_id=%, version_number=%, status=%)', r.plan_id, r.version_number, r.status;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- STEP B: Bootstrap NULL Fields Only & Enterprise Guard
-- ---------------------------------------------------------------------

-- Plan 1: Trial (pet_limit 30, staff_limit 2, storage_bytes_limit 2 GiB = 2147483648)
UPDATE plan_versions
SET staff_limit = COALESCE(staff_limit, 2),
    storage_bytes_limit = COALESCE(storage_bytes_limit, 2147483648)
WHERE plan_id IN (SELECT id FROM plans WHERE LOWER(name) LIKE '%trial%')
  AND (staff_limit IS NULL OR storage_bytes_limit IS NULL);

-- Plan 2: Starter (pet_limit 15, staff_limit 3, storage_bytes_limit 5 GiB = 5368709120)
UPDATE plan_versions
SET staff_limit = COALESCE(staff_limit, 3),
    storage_bytes_limit = COALESCE(storage_bytes_limit, 5368709120)
WHERE plan_id IN (SELECT id FROM plans WHERE LOWER(name) LIKE '%starter%')
  AND (staff_limit IS NULL OR storage_bytes_limit IS NULL);

-- Plan 3: Essencial (pet_limit 35, staff_limit 5, storage_bytes_limit 15 GiB = 16106127360)
UPDATE plan_versions
SET staff_limit = COALESCE(staff_limit, 5),
    storage_bytes_limit = COALESCE(storage_bytes_limit, 16106127360)
WHERE plan_id IN (SELECT id FROM plans WHERE LOWER(name) LIKE '%essencial%')
  AND (staff_limit IS NULL OR storage_bytes_limit IS NULL);

-- Plan 4: Pro (pet_limit 75, staff_limit 10, storage_bytes_limit 30 GiB = 32212254720)
UPDATE plan_versions
SET staff_limit = COALESCE(staff_limit, 10),
    storage_bytes_limit = COALESCE(storage_bytes_limit, 32212254720)
WHERE plan_id IN (SELECT id FROM plans WHERE LOWER(name) LIKE '%pro%')
  AND (staff_limit IS NULL OR storage_bytes_limit IS NULL);

-- Plan 5: Premium (pet_limit 150, staff_limit 20, storage_bytes_limit 60 GiB = 64424509440)
UPDATE plan_versions
SET staff_limit = COALESCE(staff_limit, 20),
    storage_bytes_limit = COALESCE(storage_bytes_limit, 64424509440)
WHERE plan_id IN (SELECT id FROM plans WHERE LOWER(name) LIKE '%premium%')
  AND (staff_limit IS NULL OR storage_bytes_limit IS NULL);

-- Plan 6: Enterprise (pet_limit 999999, staff_limit NULL = unlimited, storage_bytes_limit 100 GiB = 107374182400)
-- Guard: staff_limit = NULL is final unlimited value. Only populate storage_bytes_limit if NULL.
UPDATE plan_versions
SET storage_bytes_limit = 107374182400
WHERE plan_id IN (SELECT id FROM plans WHERE LOWER(name) LIKE '%enterprise%')
  AND storage_bytes_limit IS NULL;

-- ---------------------------------------------------------------------
-- STEP C: Pre-Commit Assertion Verification & Canonical Coverage
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_count INTEGER;
  r_pv RECORD;
BEGIN
  -- 1. Check if plans table has rows (if catalog is seeded, verify exact match)
  SELECT COUNT(*) INTO v_count FROM plans;
  IF v_count > 0 THEN
    -- Verify Trial v1: pet_limit = 30, staff_limit = 2, storage_bytes_limit = 2147483648, price_brl = 0
    SELECT pv.* INTO r_pv
    FROM plan_versions pv
    JOIN plans p ON p.id = pv.plan_id
    WHERE LOWER(p.name) LIKE '%trial%' AND pv.version_number = 1;

    IF FOUND THEN
      IF r_pv.pet_limit <> 30 THEN
        RAISE EXCEPTION 'STEP_C_DRIFT_ABORT: Trial v1 pet_limit drift (expected 30, got %)', r_pv.pet_limit;
      END IF;
      IF r_pv.staff_limit <> 2 THEN
        RAISE EXCEPTION 'STEP_C_DRIFT_ABORT: Trial v1 staff_limit drift (expected 2, got %)', r_pv.staff_limit;
      END IF;
      IF r_pv.storage_bytes_limit <> 2147483648 THEN
        RAISE EXCEPTION 'STEP_C_DRIFT_ABORT: Trial v1 storage_bytes_limit drift (expected 2147483648, got %)', r_pv.storage_bytes_limit;
      END IF;
      IF r_pv.price_brl <> 0 THEN
        RAISE EXCEPTION 'STEP_C_DRIFT_ABORT: Trial v1 price_brl drift (expected 0, got %)', r_pv.price_brl;
      END IF;
    END IF;

    -- Verify Starter v1
    SELECT pv.* INTO r_pv
    FROM plan_versions pv
    JOIN plans p ON p.id = pv.plan_id
    WHERE LOWER(p.name) LIKE '%starter%' AND pv.version_number = 1;

    IF FOUND THEN
      IF r_pv.pet_limit <> 15 OR r_pv.staff_limit <> 3 OR r_pv.storage_bytes_limit <> 5368709120 THEN
        RAISE EXCEPTION 'STEP_C_DRIFT_ABORT: Starter v1 entitlement drift';
      END IF;
    END IF;

    -- Verify Essencial v1
    SELECT pv.* INTO r_pv
    FROM plan_versions pv
    JOIN plans p ON p.id = pv.plan_id
    WHERE LOWER(p.name) LIKE '%essencial%' AND pv.version_number = 1;

    IF FOUND THEN
      IF r_pv.pet_limit <> 35 OR r_pv.staff_limit <> 5 OR r_pv.storage_bytes_limit <> 16106127360 THEN
        RAISE EXCEPTION 'STEP_C_DRIFT_ABORT: Essencial v1 entitlement drift';
      END IF;
    END IF;

    -- Verify Pro v1
    SELECT pv.* INTO r_pv
    FROM plan_versions pv
    JOIN plans p ON p.id = pv.plan_id
    WHERE LOWER(p.name) LIKE '%pro%' AND pv.version_number = 1;

    IF FOUND THEN
      IF r_pv.pet_limit <> 75 OR r_pv.staff_limit <> 10 OR r_pv.storage_bytes_limit <> 32212254720 THEN
        RAISE EXCEPTION 'STEP_C_DRIFT_ABORT: Pro v1 entitlement drift';
      END IF;
    END IF;

    -- Verify Premium v1
    SELECT pv.* INTO r_pv
    FROM plan_versions pv
    JOIN plans p ON p.id = pv.plan_id
    WHERE LOWER(p.name) LIKE '%premium%' AND pv.version_number = 1;

    IF FOUND THEN
      IF r_pv.pet_limit <> 150 OR r_pv.staff_limit <> 20 OR r_pv.storage_bytes_limit <> 64424509440 THEN
        RAISE EXCEPTION 'STEP_C_DRIFT_ABORT: Premium v1 entitlement drift';
      END IF;
    END IF;

    -- Verify Enterprise v1
    SELECT pv.* INTO r_pv
    FROM plan_versions pv
    JOIN plans p ON p.id = pv.plan_id
    WHERE LOWER(p.name) LIKE '%enterprise%' AND pv.version_number = 1;

    IF FOUND THEN
      IF r_pv.staff_limit IS NOT NULL THEN
        RAISE EXCEPTION 'STEP_C_DRIFT_ABORT: Enterprise v1 staff_limit drift (expected NULL, got %)', r_pv.staff_limit;
      END IF;
      IF r_pv.storage_bytes_limit <> 107374182400 THEN
        RAISE EXCEPTION 'STEP_C_DRIFT_ABORT: Enterprise v1 storage_bytes_limit drift (expected 107374182400, got %)', r_pv.storage_bytes_limit;
      END IF;
    END IF;
  END IF;

  -- 2. Verify Canonical Plan-Version Coverage (Prove every plan_version row is accounted for)
  SELECT COUNT(*) INTO v_count
  FROM plan_versions pv
  JOIN plans p ON p.id = pv.plan_id
  WHERE LOWER(p.name) NOT LIKE '%trial%'
    AND LOWER(p.name) NOT LIKE '%starter%'
    AND LOWER(p.name) NOT LIKE '%essencial%'
    AND LOWER(p.name) NOT LIKE '%pro%'
    AND LOWER(p.name) NOT LIKE '%premium%'
    AND LOWER(p.name) NOT LIKE '%enterprise%';

  IF v_count > 0 THEN
    SELECT pv.plan_id, pv.version_number, pv.status INTO r_pv
    FROM plan_versions pv
    JOIN plans p ON p.id = pv.plan_id
    WHERE LOWER(p.name) NOT LIKE '%trial%'
      AND LOWER(p.name) NOT LIKE '%starter%'
      AND LOWER(p.name) NOT LIKE '%essencial%'
      AND LOWER(p.name) NOT LIKE '%pro%'
      AND LOWER(p.name) NOT LIKE '%premium%'
      AND LOWER(p.name) NOT LIKE '%enterprise%'
    LIMIT 1;

    RAISE EXCEPTION 'ERR_R38C_UNMAPPED_PLAN_VERSION: Found unmapped plan version (plan_id=%, version_number=%, status=%)', r_pv.plan_id, r_pv.version_number, r_pv.status;
  END IF;

  -- 3. Verify no published plan_version has NULL storage_bytes_limit
  SELECT COUNT(*) INTO v_count
  FROM plan_versions
  WHERE status IN ('ACTIVE', 'SUPERSEDED', 'ARCHIVED')
    AND storage_bytes_limit IS NULL;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'STEP_C_DRIFT_ABORT: Found % published plan version(s) with NULL storage_bytes_limit', v_count;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- STEP D: Replace fn_plan_versions_immutable_check() trigger function
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_plan_versions_immutable_check()
RETURNS TRIGGER AS $$
BEGIN
  -- If row is in published state (ACTIVE, SUPERSEDED, ARCHIVED)
  IF OLD.status IN ('ACTIVE', 'SUPERSEDED', 'ARCHIVED') THEN
    -- Disallow mutating commercial or entitlement fields
    IF NEW.plan_id <> OLD.plan_id OR
       NEW.version_number <> OLD.version_number OR
       NEW.pet_limit <> OLD.pet_limit OR
       NEW.staff_limit IS DISTINCT FROM OLD.staff_limit OR
       NEW.storage_bytes_limit IS DISTINCT FROM OLD.storage_bytes_limit OR
       NEW.price_brl <> OLD.price_brl OR
       NEW.features IS DISTINCT FROM OLD.features THEN
      RAISE EXCEPTION 'ERR_COMMERCIAL_FIELDS_IMMUTABLE: Cannot modify commercial or entitlement fields of a published plan version (status: %)', OLD.status;
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

-- ---------------------------------------------------------------------
-- STEP E: Constrain plan_versions.storage_bytes_limit to NOT NULL (NO DEFAULT)
-- ---------------------------------------------------------------------
ALTER TABLE plan_versions ALTER COLUMN storage_bytes_limit SET NOT NULL;

-- ---------------------------------------------------------------------
-- STEP F: Mirror approved entitlement values to plans catalog projections
-- ---------------------------------------------------------------------
UPDATE plans SET staff_limit = 2, storage_bytes_limit = 2147483648 WHERE LOWER(name) LIKE '%trial%';
UPDATE plans SET staff_limit = 3, storage_bytes_limit = 5368709120 WHERE LOWER(name) LIKE '%starter%';
UPDATE plans SET staff_limit = 5, storage_bytes_limit = 16106127360 WHERE LOWER(name) LIKE '%essencial%';
UPDATE plans SET staff_limit = 10, storage_bytes_limit = 32212254720 WHERE LOWER(name) LIKE '%pro%';
UPDATE plans SET staff_limit = 20, storage_bytes_limit = 64424509440 WHERE LOWER(name) LIKE '%premium%';
UPDATE plans SET staff_limit = NULL, storage_bytes_limit = 107374182400 WHERE LOWER(name) LIKE '%enterprise%';

COMMIT;
