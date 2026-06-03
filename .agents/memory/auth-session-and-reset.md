---
name: Auth session invalidation & password reset
description: How stateless auth tokens are invalidated on password change, and the single-use reset-token pattern.
---

# Auth tokens are stateless — invalidate via passwordChangedAt

Auth tokens are stateless signed blobs `base64(userId:role:issuedAtMs:sig)`; there is
no server-side session store. To revoke sessions on password change we compare the
token's `issuedAt` against `users.password_changed_at` inside `authenticate`:
reject (401 "Sessão expirada") when `issuedAt < passwordChangedAt.getTime()`.

**Why:** a password reset must not leave previously-issued bearer tokens valid.
**How to apply:** any flow that changes a user's password (reset, and ideally admin
force-change) must stamp `passwordChangedAt = now()`. `verifyToken` must keep
returning `issuedAt`. Column is nullable → NULL means "never invalidated" so existing
sessions are untouched until the first password change (backward compatible).

# Reset token single-use must be an atomic claim

Do NOT `SELECT ... WHERE used_at IS NULL` then later `UPDATE used_at` — that is a
TOCTOU race (two concurrent requests both pass the SELECT). Instead claim atomically:
`UPDATE password_reset_tokens SET used_at=now() WHERE token=? AND used_at IS NULL AND
expires_at>now() RETURNING user_id` and only proceed if exactly one row returns.
Postgres row-locking guarantees a single winner. Do the password update + stamp +
invalidation of the user's other outstanding reset tokens in the same transaction.
