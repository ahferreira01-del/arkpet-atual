---
name: Schema drift — multiple tables
description: Several Drizzle schema columns and entire tables were never applied to the real DB; caused "Failed query" 500s on any endpoint that touched those tables.
---

## Rule
Any column (or table) in a Drizzle schema file but absent from the actual DB makes **every** query touching that table fail at runtime with `Error: Failed query` / `column X does not exist`. Drizzle names every column in its generated SQL — there is no graceful degradation.

## Full drift found and fixed (2026-07-27)

| Table | Missing columns/objects |
|---|---|
| `users` | `cpf text`, `phone text` |
| `creches` | `audit_enabled bool NOT NULL DEFAULT true`, `delivery_type creche_delivery_type NOT NULL DEFAULT 'fixed'`, `delivery_fee numeric(10,2) NOT NULL DEFAULT 0`, `pix_key text`, `pix_name text` |
| `bookings` | `package_max_pets integer` |
| `pets` | `size pet_size NOT NULL DEFAULT 'medium'` |
| enums | `creche_delivery_type ('fixed','on_demand')`, `pet_size ('small','medium','large')` |
| tables | `timeline_event_pets`, `timeline_views`, `timeline_comments` (entirely missing) |

Migration idempotently saved to `lib/db/src/migrations/fix_schema_drift.sql`.

## How to diagnose
```
psql $DATABASE_URL -c "\d <table>"
```
Cross-check every column in `lib/db/src/schema/<file>.ts` against the actual DB columns. Missing column = 500 on every query that touches the table.

## How to apply
```sql
ALTER TABLE <t> ADD COLUMN IF NOT EXISTS <col> <type>;
CREATE TYPE IF NOT EXISTS <enum> AS ENUM (...);
CREATE TABLE IF NOT EXISTS ...;
```
