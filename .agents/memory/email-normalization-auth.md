---
name: Email normalization on auth
description: Login and register must normalize email identically or mobile logins fail.
---
Both register-creche and login must apply `String(email).trim().toLowerCase()` before
querying `usersTable.email`. Registration stores the normalized email; login originally
did an exact match on the raw input.

**Why:** Mobile keyboards auto-capitalize the first letter of the email field (and can add
trailing spaces from autocomplete). A stored lowercase email never matches a capitalized
input, so login fails ONLY on mobile while desktop works — a confusing, hard-to-reproduce bug.

**How to apply:** Any new auth/lookup-by-email path (login, password reset, invite, change-email)
must normalize the email the same way before the DB query. Defense in depth on the client:
email inputs should set autoCapitalize="none" autoCorrect="off" spellCheck={false} and trim+lowercase
before submit.
