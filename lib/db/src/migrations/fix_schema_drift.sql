-- Schema drift fix: columns/tables defined in Drizzle schema but missing from DB
-- Applied 2026-07-27

-- Enums
CREATE TYPE IF NOT EXISTS creche_delivery_type AS ENUM ('fixed', 'on_demand');
CREATE TYPE IF NOT EXISTS pet_size AS ENUM ('small', 'medium', 'large');

-- creches
ALTER TABLE creches
  ADD COLUMN IF NOT EXISTS audit_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS delivery_type creche_delivery_type NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS delivery_fee numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pix_key text,
  ADD COLUMN IF NOT EXISTS pix_name text;

-- bookings
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS package_max_pets integer;

-- pets
ALTER TABLE pets
  ADD COLUMN IF NOT EXISTS size pet_size NOT NULL DEFAULT 'medium';

-- users (applied earlier in session)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS cpf text,
  ADD COLUMN IF NOT EXISTS phone text;

-- timeline tables (missing entirely)
CREATE TABLE IF NOT EXISTS timeline_event_pets (
  event_id integer NOT NULL,
  pet_id   integer NOT NULL
);
CREATE INDEX IF NOT EXISTS timeline_event_pets_event_idx ON timeline_event_pets (event_id);
CREATE INDEX IF NOT EXISTS timeline_event_pets_pet_idx  ON timeline_event_pets (pet_id);

CREATE TABLE IF NOT EXISTS timeline_views (
  event_id  integer NOT NULL,
  user_id   integer NOT NULL,
  viewed_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS timeline_views_event_idx ON timeline_views (event_id);
CREATE INDEX IF NOT EXISTS timeline_views_user_idx  ON timeline_views (user_id);

CREATE TABLE IF NOT EXISTS timeline_comments (
  id         serial PRIMARY KEY,
  event_id   integer NOT NULL,
  user_id    integer NOT NULL,
  content    text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS timeline_comments_event_idx ON timeline_comments (event_id);
