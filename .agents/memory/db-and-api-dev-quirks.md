---
name: DB schema conventions & API dev quirks
description: Non-obvious conventions for Drizzle schema + how to test/push in this repo
---

## No foreign-key constraints anywhere
This codebase intentionally uses plain `integer("creche_id")` etc. WITHOUT `.references()` on every table (users.crecheId, pets.crecheId, pets.tutorId, subscriptions.crecheId/planId, etc.).
**Why:** consistency — the whole schema relies on app-level integrity, not DB FKs.
**How to apply:** when adding new tables, match this — do NOT add `.references()`/FK constraints even if a reviewer flags "missing FK". It would be inconsistent with the rest of the schema.

## `drizzle-kit push` is interactive for constraint changes
Adding a UNIQUE/constraint to a table that already has rows makes `drizzle-kit push` prompt ("truncate or not?") and it does NOT accept piped stdin (`printf '\n' |` fails — detects non-TTY).
**How to apply:** for constraint additions on populated tables, apply the SQL directly via `psql "$DATABASE_URL"` with an idempotent `DO $$ ... IF NOT EXISTS (pg_constraint) ... ALTER TABLE ADD CONSTRAINT ... $$`, and keep the schema `.ts` file in sync so future fresh pushes match.

## Testing the API server: hit localhost:8080 directly
`$REPLIT_DEV_DOMAIN/api/...` routes to the FRONTEND (petdaycare web), NOT the api-server. Curling it for backend tests returns empty/fails.
**How to apply:** test the API server directly at `http://localhost:8080/api/...` from the shell. The frontend reaches the API via its own vite proxy.

## Known PRE-EXISTING issues (not regressions — do not "fix" reflexively)
- `lib/api-zod/src/index.ts` has duplicate-export TS2308 ambiguity (ListBookingsParams, etc.) from `export *` of both ./generated/api and ./generated/types. api-zod is consumed by api-server only, not the frontend; frontend libs (lib/db, lib/api-client-react) build clean.
- `artifacts/petdaycare/src/pages/bookings/index.tsx` references booking status `cancel_requested` which is NOT in openapi.yaml → 3 TS errors there. Pre-existing spec/frontend drift.
- Password hashing is SHA-256 + static `PASSWORD_SALT` (not bcrypt/argon2). Pre-existing across all users; changing it is a breaking migration needing user sign-off — flag, don't silently change.
