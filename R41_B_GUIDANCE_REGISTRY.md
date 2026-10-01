# ARKPET — R41.B GUIDANCE REGISTRY
## Canonical Onboarding Steps, Routes, UI Targets, and Action Allowlist

**Phase:** R41.B — AI Guided Onboarding  
**Baseline SHA:** `fb8ed90f3b31358464ea22dce07655b46961934b`  
**Date:** 2026-10-01  
**Status:** VERIFIED & IN SYNCHRONY WITH SOURCE CODE  

---

## 1. Canonical Onboarding Steps Registry

| Step ID | Title | Description | Canonical Route | Target Element ID | Action Label |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`creche_details`** | Completar dados da creche | Informe telefone e endereço da creche | `/settings` | `creche-profile-form` | Configurar |
| **`staff`** | Cadastrar equipe | Convide ou adicione membros da equipe | `/staff/manage` | `staff-create-button` | Equipe |
| **`tutors`** | Cadastrar tutor | Cadastre seu primeiro tutor | `/tutors` | `tutor-create-button` | Tutores |
| **`pets`** | Cadastrar primeiro pet | Cadastre um pet vinculado a um tutor | `/pets` | `pet-create-button` | Pets |
| **`bookings`** | Conhecer reservas | Crie sua primeira reserva ou veja a agenda | `/bookings` | `booking-create-button` | Reservas |

---

## 2. Safe Route Allowlist (`allowedGuidanceRoutes`)

Defined in `artifacts/api-server/src/assistant/assistant.config.ts`:
```ts
allowedGuidanceRoutes: [
  "/",
  "/settings",
  "/staff/manage",
  "/tutors",
  "/pets",
  "/bookings",
  "/financial",
  "/chat",
]
```

### Route Sanitizer Validation Rules (`AssistantGuidanceService.isValidRoute`):
- Prohibits external schemes: `http://`, `https://`, `//`.
- Prohibits dangerous scripting schemes: `javascript:`, `data:`.
- Strips query parameters and hashes for exact prefix allowlist matching.
- Any unlisted internal path is rejected (`ARBITRARY_NAVIGATION = 0`).

---

## 3. Safe Target Element Allowlist (`allowedGuidanceTargets`)

Defined in `artifacts/api-server/src/assistant/assistant.config.ts`:
```ts
allowedGuidanceTargets: [
  "creche-profile-form",
  "staff-create-button",
  "tutor-create-button",
  "pet-create-button",
  "booking-create-button",
]
```

### Target Sanitizer Validation Rules (`AssistantGuidanceService.isValidTarget`):
- Rejects arbitrary CSS selector symbols: ` `, `>`, `+`, `~`, `.`, `#`, `[`, `:`, `]`.
- Enforces strict kebab-case identity matching against the allowlist.
- Rejects all dynamic script tags or arbitrary DOM selectors (`ARBITRARY_CSS_SELECTOR_FROM_MODEL = 0`).

---

## 4. UI Action Contract

Valid action types recognized by `AssistantUIAction`:
1. **`navigate`**:
   ```json
   { "type": "navigate", "route": "/tutors" }
   ```
   Renders an interactive navigation chip allowing the user to switch screens with one click.

2. **`highlight`**:
   ```json
   { "type": "highlight", "targetId": "tutor-create-button" }
   ```
   Applies a temporary, non-blocking visual focus ring to the element on the target page.

3. **`scroll_to`**:
   ```json
   { "type": "scroll_to", "targetId": "tutor-create-button" }
   ```
   Scrolls the viewport smoothly to ensure the target element is visible.

---

## 5. Graceful Degradation & Fallback Behavior

- **Missing DOM Element**: If the target element is absent from the DOM (e.g. user collapsed the card, or element rendered conditionally), the highlight action safely no-ops without throwing exceptions (`MISSING_GUIDANCE_TARGET_BREAKS_APP = NO`).
- **Target Timeout**: Highlight focus rings automatically clear after a short duration (2.5 seconds) to avoid persistent visual noise.
- **Independent Onboarding**: Standard manual navigation and onboarding cards in the UI work 100% independently of whether the assistant is open, closed, or disabled (`AI_REQUIRED_FOR_ONBOARDING = NO`).
