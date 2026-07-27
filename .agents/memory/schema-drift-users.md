---
name: Schema drift — users cpf/phone
description: cpf and phone columns defined in Drizzle schema but were never applied to the real DB, causing all usersTable SELECTs to fail with "Failed query".
---

## Rule
Any column present in `lib/db/src/schema/users.ts` (or any schema file) but absent from the actual database will make **every** Drizzle query that touches that table fail at runtime with `Error: Failed query`.

## What happened
`cpf` and `phone` were declared in `lib/db/src/schema/users.ts` (lines 15-16) with a comment about AES-256-GCM encryption, but were never applied via migration. Since Drizzle generates `SELECT *-equivalent` queries that name every column, the missing columns caused 500s on login, register-creche, and any other endpoint that queried `usersTable`.

**Fix applied (2025-07-27):**
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS cpf text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;
```
Migration saved to `lib/db/src/migrations/add_users_cpf_phone.sql`.

## How to apply
When a route returns a Drizzle "Failed query" error with no obvious SQL syntax problem, cross-check the schema file columns against `\d <table>` in psql. Missing columns = apply `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
