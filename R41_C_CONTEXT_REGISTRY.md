# ARKPET — R41.C CONTEXT REGISTRY
## Source-Verified Product Screen Context Registry & Action Allowlist

**Phase:** R41.C — Contextual Product Guide  
**Status:** FULLY CERTIFIED  
**Registered Route Count:** 20 (`REGISTERED_CONTEXT_ROUTE_COUNT = 20`)  
**Broken Route Count:** 0 (`REGISTERED_CONTEXT_ROUTE_BROKEN_COUNT = 0`)  

---

## 1. Registry Architecture & Principles

The `AssistantProductContextRegistry` (`artifacts/api-server/src/assistant/assistant-context-registry.service.ts`) is a deterministic, server-enforced registry that maps ArkPet URL routes to structured screen definitions.

Each definition declares:
- `routeId`: Unique canonical identifier.
- `matcher`: Exact string or parameterized RegExp matcher.
- `feature`: Domain feature grouping.
- `title`: Human-readable Portuguese title.
- `description`: Comprehensive explanation of the screen's purpose.
- `roles`: ArkPet RBAC roles permitted to view the screen.
- `availableActionIds`: Allowlist of action IDs valid for that screen.
- `guidanceTargets`: Certified DOM target identifiers for visual guidance.
- `knowledgeCategories`: Grounding knowledge categories for anti-hallucination.
- `entityType`: Optional entity type (`pet`, `booking`, `tutor`, `invoice`).
- `roleGuidance`: Role-specific explanations tailored to `creche_admin`, `staff`, `tutor`, `master_admin`.

---

## 2. Inventory of 20 Source-Verified Routes

| # | Route Matcher | Route ID | Feature | Allowed Roles | Entity | Primary Guidance Target |
|---|---------------|----------|---------|---------------|--------|------------------------|
| 1 | `/` | `dashboard` | `dashboard` | `creche_admin`, `staff`, `tutor`, `master_admin` | - | `onboarding-open-assistant-btn` |
| 2 | `/settings` | `creche.settings` | `creche_settings` | `creche_admin` | - | `creche-profile-form` |
| 3 | `/staff/manage` | `staff.manage` | `staff_management` | `creche_admin` | - | `staff-create-button` |
| 4 | `/staff/board` | `staff.board` | `operational_board` | `creche_admin`, `staff` | - | `staff-board-checkin-tab` |
| 5 | `/staff/qr-scanner` | `staff.qr_scanner` | `qr_scanner` | `creche_admin`, `staff` | - | - |
| 6 | `/tutors` | `tutors.list` | `tutors_directory` | `creche_admin`, `staff` | - | `tutor-create-button` |
| 7 | `/tutors/:id` | `tutors.detail` | `tutor_detail` | `creche_admin`, `staff` | `tutor` | - |
| 8 | `/pets` | `pets.list` | `pets_directory` | `creche_admin`, `staff`, `tutor` | - | `pet-create-button` |
| 9 | `/pets/:id` | `pets.detail` | `pet_detail` | `creche_admin`, `staff`, `tutor` | `pet` | `pet-search-input` |
| 10 | `/bookings` | `bookings.calendar` | `bookings_calendar` | `creche_admin`, `staff`, `tutor` | - | `booking-create-button` |
| 11 | `/bookings/new` | `bookings.new` | `booking_create` | `creche_admin`, `staff`, `tutor` | - | `booking-create-button` |
| 12 | `/bookings/:id` | `bookings.detail` | `booking_detail` | `creche_admin`, `staff`, `tutor` | `booking` | `booking-filter-status` |
| 13 | `/financial` | `financial.dashboard` | `financial_management` | `creche_admin` | - | - |
| 14 | `/tutor/financial` | `tutor.financial` | `tutor_financial` | `tutor` | `invoice` | - |
| 15 | `/tutor/store` | `tutor.store` | `tutor_store` | `tutor` | - | - |
| 16 | `/chat` | `chat.messaging` | `chat_messaging` | `creche_admin`, `staff`, `tutor` | - | `chat-input-textarea` |
| 17 | `/assinatura` | `billing.subscription` | `billing_subscription` | `creche_admin` | - | - |
| 18 | `/marketing/campaigns` | `marketing.campaigns` | `marketing_campaigns` | `creche_admin` | - | - |
| 19 | `/admin/creches` | `superadmin.creches` | `superadmin_creches` | `master_admin` | - | - |
| 20 | `/admin/users` | `superadmin.users` | `superadmin_users` | `master_admin` | - | - |

---

## 3. Fallback Route & Graceful Degradation

If a user navigates to an unregistered route (e.g. `/unknown-feature` or dynamic edge URL):
- `AssistantProductContextRegistry.getFallbackScreen(route)` is triggered.
- Generates a safe `general_view` definition with general guidance and standard help categories.
- Ensures the assistant remains 100% operational without crashing or throwing errors (`UNKNOWN_SCREEN_BREAKS_ASSISTANT = NO`).

---

## 4. Anti-Hallucination & Feature Grounding

The registry guarantees that the assistant never invents unreleased features:
- **Bath & Grooming Module:** Documented explicitly as an additional service linked to a booking/day use, **not** as an independent standalone system module (`R41C-KNOW-002 = PASS`).
- **Telemetry / Hologram / Cryptocurrency:** Strictly refused with clear grounding in the ArkPet domain model.
