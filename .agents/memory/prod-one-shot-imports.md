---
name: Production one-shot data imports
description: How to write data into the production DB (agent access is read-only) — startup migration pattern and its safety rails
---

The agent's production DB access is READ-ONLY (replica). The only write path is code that runs in the deployed server: one-shot startup migrations in `artifacts/api-server/src/startup.ts` (precedents: `migrateQuintalPetTrial`, `importKimPetSitter`).

**Rules learned (Kim Pet Sitter import, Aug 2026):**
- Guard on a deterministic marker (e.g. creche row exists), run the whole payload as ONE `BEGIN…COMMIT`, and take `pg_advisory_xact_lock` first so a second instance can't race.
- Run `setval(seq, GREATEST(import_max, last_value))` BEFORE the inserts — setval is non-transactional, so it pushes concurrent inserts from the still-running old instance above the imported fixed-id ranges during the deploy window.
- Make the import non-fatal (try/catch around the call): a failed atomic import must not take the whole deploy down.
- Prod bundle is esbuild (`dist/index.cjs`) — loose SQL files don't ship; embed the SQL as a generated TS module.
- Verify prod id maxima via read-only queries per table right before publish; offset colliding id ranges and remap FKs (incl. references to users NOT present in the export — replace with an inert placeholder user, never leave ids that belong to other prod tenants).
- Old SQL exports can contain multi-line string values, comment lines, and statements wrapped in stray double quotes — parse quote-aware, never line-based; assert cols==vals per INSERT.
- After the import is verified in prod, REMOVE the embedded payload module (contains real PII + bcrypt hashes) in a follow-up publish.

**Why:** executeSql(environment:"production") rejects writes; production DATABASE_URL is not obtainable from the workspace; deployed app is behind replshield (curl can't reach temp admin endpoints when visibility=password).
