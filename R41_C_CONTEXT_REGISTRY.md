# ARKPET — R41.C CONTEXT REGISTRY
## Source-Verified Product Screen Context Registry & Action Allowlist

**Phase:** R41.C — Contextual Product Guide  
**Status:** IMPLEMENTATION CERTIFIED (NOT DEPLOYED)  
**Registered Route Count:** 20 (`REGISTERED_CONTEXT_ROUTE_COUNT = 20`)  
**Broken Route Count:** 0 (`REGISTERED_CONTEXT_ROUTE_BROKEN_COUNT = 0`)  
**Documented Fictitious Route Count:** 0 (`DOCUMENTED_FICTITIOUS_ROUTE_COUNT = 0`)  
**Settings Context Role Metadata Matches App:** YES (`SETTINGS_CONTEXT_ROLE_METADATA_MATCHES_APP = YES`)  
**Context Role Metadata Mismatch Count:** 0 (`CONTEXT_ROLE_METADATA_MISMATCH_COUNT = 0`)  

---

## 1. Registry Architecture & Principles

The `AssistantProductContextRegistry` (`artifacts/api-server/src/assistant/assistant-context-registry.service.ts`) is a deterministic, server-enforced registry that maps ArkPet URL routes to structured screen definitions.

Each definition declares:
- `routeId`: Unique canonical identifier.
- `matcher`: Exact string or parameterized RegExp matcher.
- `feature`: Domain feature grouping.
- `title`: Human-readable Portuguese title.
- `description`: Comprehensive explanation of the screen's purpose.
- `roles`: ArkPet RBAC roles permitted to view the screen (strictly aligned with `App.tsx` and `NAVIGATION_CONFIG`).
- `availableActionIds`: Allowlist of action IDs valid for that screen.
- `guidanceTargets`: Certified DOM target identifiers for visual guidance.
- `knowledgeCategories`: Grounding knowledge categories for anti-hallucination.
- `entityType`: Optional entity type (currently `pet` on `/pets/:id`).
- `roleGuidance`: Role-specific explanations tailored to `creche_admin`, `staff`, `tutor`, `master_admin`.

---

## 2. Inventory of Exact 20 Source-Verified Registry Screens

| # | Route Matcher | Route ID | Feature | Allowed Roles | Entity | Primary Guidance Target |
|---|---------------|----------|---------|---------------|--------|------------------------|
| 1 | `/^\/(dashboard)?$/` (`/`, `/dashboard`) | `dashboard` | `dashboard` | `creche_admin`, `staff`, `tutor`, `master_admin` | - | - |
| 2 | `/^\/pets$/` (`/pets`) | `pets.list` | `pets_directory` | `creche_admin`, `staff`, `tutor` | - | `pet-create-button`, `pet-search-input` |
| 3 | `/^\/pets\/(\d+)$/` (`/pets/:id`) | `pets.detail` | `pet_detail` | `creche_admin`, `staff`, `tutor` | `pet` | `pet-edit-button`, `pet-detail-plan-tab`, `pet-detail-care-tab` |
| 4 | `/^\/bookings$/` (`/bookings`) | `bookings.list` | `bookings_calendar` | `creche_admin`, `staff`, `tutor` | - | `booking-create-button`, `booking-filter-status` |
| 5 | `/^\/bookings\/new$/` (`/bookings/new`) | `bookings.new` | `booking_create` | `creche_admin`, `tutor` | - | `booking-submit-button` |
| 6 | `/^\/(staff\/board\|staff\|walks)$/` (`/staff/board`, `/staff`, `/walks`) | `staff.board` | `operational_board` | `creche_admin`, `staff` | - | `staff-board-checkin-tab`, `staff-board-feeding-tab`, `staff-board-meds-tab`, `staff-board-walks-tab` |
| 7 | `/^\/staff\/manage$/` (`/staff/manage`) | `staff.manage` | `staff_management` | `creche_admin` | - | `staff-create-button` |
| 8 | `/^\/staff\/qr-scanner$/` (`/staff/qr-scanner`) | `staff.qr_scanner` | `qr_scanner` | `creche_admin`, `staff` | - | `qr-scanner-camera-view` |
| 9 | `/^\/tutors$/` (`/tutors`) | `tutors.list` | `tutors_directory` | `creche_admin` | - | `tutor-create-button` |
| 10 | `/^\/chat$/` (`/chat`) | `chat` | `chat_messaging` | `creche_admin`, `staff`, `tutor` | - | `chat-input-textarea`, `chat-send-button` |
| 11 | `/^\/settings$/` (`/settings`) | `settings` | `creche_settings` | `creche_admin`, `staff`, `tutor` | - | `creche-profile-form`, `settings-save-button` |
| 12 | `/^\/financial$/` (`/financial`) | `financial` | `financial_management` | `creche_admin` | - | `financial-reports-tab` |
| 13 | `/^\/tutor\/financial$/` (`/tutor/financial`) | `tutor.financial` | `tutor_financial` | `tutor` | - | `tutor-invoices-list` |
| 14 | `/^\/tutor\/store$/` (`/tutor/store`) | `tutor.store` | `tutor_store` | `tutor` | - | `store-catalog-grid` |
| 15 | `/^\/assinatura(\/sucesso)?$/` (`/assinatura`, `/assinatura/sucesso`) | `billing` | `billing_subscription` | `creche_admin` | - | `billing-plans-card` |
| 16 | `/^\/marketing\/campaigns$/` (`/marketing/campaigns`) | `marketing.campaigns` | `creche_campaigns` | `creche_admin`, `staff` | - | `campaign-create-button` |
| 17 | `/^\/admin(\/creches)?$/` (`/admin`, `/admin/creches`) | `admin.creches` | `master_admin_creches` | `master_admin` | - | `admin-creches-table` |
| 18 | `/^\/admin\/campaigns$/` (`/admin/campaigns`) | `admin.campaigns` | `master_admin_campaigns` | `master_admin` | - | - |
| 19 | `/^\/admin\/proposals$/` (`/admin/proposals`) | `admin.proposals` | `master_admin_proposals` | `master_admin` | - | - |
| 20 | `/^\/admin\/users$/` (`/admin/users`) | `admin.users` | `master_admin_users` | `master_admin` | - | - |

---

## 3. Route Aliases & Composite Matchers

The registry maps standard route aliases and legacy redirect paths to maintain uninterrupted guidance:
- **Operational Board:** `/staff/board`, `/staff`, and `/walks` all map to `staff.board` (`operational_board`).
- **Billing Subscription:** `/assinatura` and `/assinatura/sucesso` map to `billing` (`billing_subscription`).
- **Platform Creches:** `/admin` and `/admin/creches` map to `admin.creches` (`master_admin_creches`).

---

## 4. Source-Verified Absence of Fictitious Routes

In strict accordance with the principle *"Certification must follow product source, not vice versa"*:
- Nonexistent routes `/bookings/:id` (`bookings.detail`) and `/tutors/:id` (`tutors.detail`) are **absent** from the context registry and cannot be queried.
- Automated test `R41C-ROUTE-TRUTH-001` validates this absence deterministically.
- Frontend dead context parsers for `/bookings/:id` and `/tutors/:id` have been removed (`FRONTEND_FICTITIOUS_ENTITY_ROUTE_PARSERS = 0`).

---

## 5. Fallback Route & Graceful Degradation

If a user navigates to an unregistered route (e.g. `/unknown-feature` or edge URLs):
- `AssistantProductContextRegistry.getFallbackScreen(route)` is triggered.
- Generates a safe `general_view` definition with general guidance and standard help categories.
- Ensures the assistant remains 100% operational without crashing or throwing errors (`UNKNOWN_SCREEN_BREAKS_ASSISTANT = NO`).
