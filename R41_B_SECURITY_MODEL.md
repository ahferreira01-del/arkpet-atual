# ARKPET — R41.B SECURITY MODEL
## Role-Based Access Control, Tenant Isolation, and Input Sanitization for Guided Onboarding

**Phase:** R41.B — AI Guided Onboarding  
**Baseline SHA:** `fb8ed90f3b31358464ea22dce07655b46961934b`  
**Date:** 2026-10-01  
**Status:** FULLY CERTIFIED & TESTED  

---

## 1. Tool Authorization Matrix (RBAC)

The ArkPet Assistant exposes exactly 7 read-only tools. The authorization decision is strictly enforced by the server (`AI_AUTHORIZATION_DECISION_SOURCE = SERVER`) using the authenticated session context, not model arguments.

| Tool Name | `creche_admin` | `master_admin` | `staff` | `tutor` | Scoping Authority |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`get_onboarding_status`** | ✅ | ❌ | ❌ | ❌ | Server `context.crecheId` |
| **`get_guided_onboarding_plan`** | ✅ | ❌ | ❌ | ❌ | Server `context.crecheId` |
| **`get_current_user_context`** | ✅ | ✅ | ✅ | ✅ | Server `context.userId` |
| **`get_current_screen_context`** | ✅ | ✅ | ✅ | ✅ | Client route parameter |
| **`search_arkpet_knowledge`** | ✅ | ✅ | ✅ | ✅ | Static knowledge base |
| **`list_my_pets`** | ✅ | ❌ | ✅ | ✅ | Scoped to tenant or tutor |
| **`list_my_bookings`** | ✅ | ❌ | ✅ | ✅ | Scoped to tenant or tutor |

### Strict RBAC Alignment for Tenant Onboarding:
- **`master_admin`**: Denied tenant onboarding tools (`MASTER_ADMIN_TENANT_ONBOARDING_ACCESS = 0`, `MASTER_ADMIN_IMPLICIT_TENANT_SELECTION = 0`). Master Admin manages platform networks and subscription plans, but does not configure day-to-day tenant onboarding.
- **`staff`**: Denied onboarding tools (`STAFF_ONBOARDING_ADMIN_ACCESS = 0`).
- **`tutor`**: Denied onboarding tools (`TUTOR_ONBOARDING_ADMIN_ACCESS = 0`).
- **`creche_admin`**: Authorized exclusively for their own authenticated daycare unit (`CROSS_TENANT_ONBOARDING_ACCESS = 0`).

---

## 2. Server-Authoritative Tenant Isolation

- Under no circumstances does the assistant accept a `crecheId` from model-generated arguments or client query overrides to access tenant onboarding data.
- The `crecheId` is extracted solely from `req.user.crecheId` via signed JWT session authentication.
- Any attempt to query onboarding without an assigned `crecheId` fails immediately with `Usuário não está associado a nenhuma creche`.

---

## 3. Safe Navigation Enforcement

- The assistant cannot emit arbitrary links, redirection URLs, or phishing domains (`ASSISTANT_EXTERNAL_REDIRECT = 0`).
- All candidate navigation paths are parsed and checked against `allowedGuidanceRoutes`:
  ```
  /, /settings, /staff/manage, /tutors, /pets, /bookings, /financial, /chat
  ```
- Any route starting with `http://`, `https://`, `//`, `javascript:`, or `data:` is immediately rejected by `AssistantGuidanceService.isValidRoute`.

---

## 4. Safe Target Element Highlighting

- The assistant cannot inject CSS selectors to inspect or manipulate arbitrary DOM elements (`ARBITRARY_CSS_SELECTOR_FROM_MODEL = 0`).
- Target element identifiers are validated against `allowedGuidanceTargets`:
  ```
  creche-profile-form, staff-create-button, tutor-create-button, pet-create-button, booking-create-button
  ```
- Any identifier containing whitespace, combinators (`>`, `+`, `~`), pseudo-classes (`:`), class selectors (`.`), ID prefixes (`#`), or attribute brackets (`[`) is rejected by `AssistantGuidanceService.isValidTarget`.

---

## 5. Zero Code Execution Boundary

- **`MODEL_GENERATED_JS_EXECUTION = 0`**: The frontend UI never executes model output through `eval()`, `new Function()`, or dynamic `<script>` injection.
- UI actions are interpreted as strongly-typed UI event signals handled by pre-compiled React event listeners.

---

## 6. Zero Mutation Policy (R41.B)

- **`R41_B_DOMAIN_MUTATION_COUNT = 0`**: No tool performs `INSERT`, `UPDATE`, or `DELETE` operations on any database table.
- **`GENERAL_DB_ACCESS_TOOL = 0`**: Any tool invocation name containing `sql`, `querydatabase`, or `genericmutation` is intercepted and blocked with a structured security audit event.
- **`MODEL_SELF_CONFIRMED_ONBOARDING_COMPLETION = 0`**: Completion percentages and step completion flags are derived strictly by `OnboardingService.getCanonicalOnboardingStatus()` against real database facts.
