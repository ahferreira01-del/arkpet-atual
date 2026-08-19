---
name: TypeScript dist resolution in monorepo
description: Why "tsc --build" must run before frontend typecheck; how stale dist files cause false TS errors.
---

# TypeScript dist resolution — lib/api-client-react

## The rule
The frontend `artifacts/petdaycare/tsconfig.json` uses `"references": [{ "path": "../../lib/api-client-react" }]`.
With TypeScript project references, the frontend reads compiled `.d.ts` files from `lib/api-client-react/dist/`, NOT from `src/`.

**Why:**
Even though `lib/api-client-react/package.json` exports `"./src/index.ts"`, the `references` entry makes `tsc --noEmit` use the compiled output.
If `dist/` is stale (generated before recent schema changes), TS reports errors like `Property 'deliveryFee' does not exist on type 'Creche'` even though the source has the field.

**How to apply:**
Whenever the frontend typecheck fails on generated types (hooks, schemas), run `pnpm run typecheck:libs` (i.e. `tsc --build`) from the workspace root FIRST to rebuild `lib/api-client-react/dist/`. Then re-run the frontend typecheck — most errors will disappear.

## Layout
- Source of truth: `lib/api-client-react/src/generated/api.schemas.ts`, `api.ts`
- Compiled output: `lib/api-client-react/dist/generated/api.schemas.d.ts`, `api.d.ts`
- Stale dist = false TS errors in the frontend — always rebuild libs first before diagnosing
