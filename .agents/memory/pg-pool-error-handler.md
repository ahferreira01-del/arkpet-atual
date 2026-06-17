---
name: pg Pool crash on dropped connection
description: node-postgres Pool needs an 'error' listener or the whole API crashes when the DB drops an idle connection.
---
The shared pg `Pool` in lib/db/src/index.ts MUST register `pool.on("error", ...)`.

**Why:** Idle clients in the pool can emit an 'error' event when the database
terminates the connection (idle timeout, maintenance, failover, or
"terminating connection due to administrator command"). With no listener, Node
treats it as an unhandled 'error' event and CRASHES the entire process. In
production this took the whole API down at night (DB maintenance window) with no
code change — every user's login returned Replit's "This app isn't live yet"
404 HTML page. Symptom looked client/mobile-specific but was a server crash loop.

**How to apply:** Never create a pg Pool without an error listener. Also set
keepAlive: true. The listener just logs; the pool auto-replaces the dead client
on the next query, so no manual reconnection is needed.
