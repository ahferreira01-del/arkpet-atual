---
name: orval api-zod barrel & enum sync
description: Why the api-zod index.ts barrel and OpenAPI enums break the build, and the durable fixes.
---

# orval / api-zod build pitfalls

## api-zod index.ts barrel collision
The `zod` target in `lib/api-spec/orval.config.ts` generates zod schemas into
`generated/api.ts`. orval's auto-generated barrel for that target ALWAYS appends
`export * from "./generated/api.schemas"` (and previously `./generated/types` when
a `schemas: { type: "typescript" }` output was configured). The zod client only
emits `api.ts`, so those extra exports are dangling, and any typescript-types output
collides name-for-name with the zod schemas (TS2308 on `ListBookingsParams`,
`ListPetsParams`, etc.).

**Fix (durable):**
- Set `indexFiles: false` on the zod output so orval never (re)writes the barrel.
- Maintain `lib/api-zod/src/index.ts` by hand: `export * from "./generated/api"` plus
  `export * from "./object-storage"` (hand-written schemas live in `object-storage.ts`,
  NOT inline in index.ts — inline manual content makes orval append stale exports).
- Do NOT add `schemas: { type: "typescript" }` to the zod target; nothing consumes
  TS types from api-zod (only zod schemas + the manual object-storage schemas).

**Why:** keeps the barrel stable across `pnpm --filter @workspace/api-spec run codegen`
runs. The deploy build (`pnpm run build` → typecheck) operates on committed files and
does not run codegen, so a broken committed barrel fails the publish.

## OpenAPI enum drift vs DB enums
DB enum `booking_status` includes `cancel_requested`; the openapi.yaml booking-status
enums (listBookings query param, Booking.status, UpdateBookingRequest.status) must list
it too or the frontend gets TS errors. Keep all spec enums in sync with the Drizzle
enums, then regenerate codegen.
