---
name: Lib rebuild order
description: After codegen or schema changes, which packages need tsc --build and in what order.
---

## Rule
Any time `lib/db` schema changes or `lib/api-spec` codegen runs, rebuild both packages before running frontend TypeScript checks:

1. `cd lib/db && npx tsc --build`
2. `cd lib/api-client-react && pnpm tsc --build`

The frontend (`artifacts/petdaycare`) uses project references that consume the compiled `.d.ts` files. If skipped, TypeScript reports "no exported member" even though the source is correct.

**Why:** pnpm monorepo uses TypeScript project references. The consuming packages resolve types from `dist/` not `src/`. Codegen writes to `src/generated/` but doesn't trigger a build.

**How to apply:** Whenever the task involves schema changes (Drizzle) or API spec codegen (orval), add these two build steps before any `tsc --noEmit` check on the frontend.
