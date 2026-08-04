---
name: Booking state machine by type
description: Service bookings (banho) have a different operational flow from day-use/lodging and must not show check-out or consumables.
---

## Rule
Booking types in `SERVICE_BOOKING_TYPES = new Set(["banho"])` follow:
- `confirmed` → "Iniciar Serviço" (calls `/checkin` endpoint, sets `active`)
- `active` → "Concluir Serviço" (calls `/complete-service`, sets `completed`)
- No "Consumo" button, no "Check-out"

Day-use/lodging follow the original flow:
- `confirmed` → "Check-in" → `active` → "Check-out" + "Consumo"

**Why:** Service pets leave after grooming without overnight tracking. The `/complete-service` backend endpoint does NOT set `isCheckedIn=false` on the pet (uses `force-checkout` logic), so pets do not appear "still checked in" after service completion.

**How to apply:** When adding a new service type (e.g. `tosa`, `veterinario`), add it to `SERVICE_BOOKING_TYPES` in `artifacts/petdaycare/src/pages/bookings/index.tsx`. No backend changes needed — `/checkin` and `/complete-service` already work for all types.
