# ARKPET — R41.C CHANGE MANIFEST
## File Modification and Creation Manifest (including FINAL.1 Reconciliation)

**Phase:** R41.C — Contextual Product Guide  
**Baseline SHA:** `ba2052fa9a88ca9a9dfd1afe302f528d88db120c` (R41.B-FINAL.1)  
**Implementation SHA:** `5bba0bf23d9c1b09901fa45c0b548d76e74c2006`  
**Date:** 2026-10-02  
**Status:** IMPLEMENTATION CERTIFIED (NOT DEPLOYED)  

---

## 1. R41.C-FINAL.1 Reconciliation Changes

| File Path | Component | Description of FINAL.1 Fix |
|---|---|---|
| `artifacts/api-server/src/assistant/assistant-context-registry.service.ts` | Context Registry | Aligned `/settings` screen metadata `allowedRoles` to `["creche_admin", "staff", "tutor"]` matching `NAVIGATION_CONFIG` and `App.tsx`. Added role-specific guidance for staff and tutors. |
| `artifacts/petdaycare/src/features/assistant/useAssistantContext.ts` | Frontend Context Hook | Removed dead entity route parsers for nonexistent `/bookings/:id` and `/tutors/:id`. Preserved real `/pets/:id` pet entity extraction (`FRONTEND_FICTITIOUS_ENTITY_ROUTE_PARSERS = 0`). |
| `artifacts/petdaycare/src/test/assistant-contextual-guide.test.tsx` | Frontend Unit Tests | Removed assertions on nonexistent `/bookings/42` and `/tutors/50`. Added tests for real `/bookings` and `/settings` routes. |
| `artifacts/api-server/src/__tests__/assistantContextualGuide.unit.test.ts` | Backend Unit Tests | Added `R41C-TOOL-CONTRACT-001` (8 exact tool names), `R41C-ROUTE-TRUTH-001` (20 real routes, 0 fictitious), `R41C-MODEL-CONFIG-001` (Groq default model), and `R41C-RBAC-004` (settings RBAC). |
| `R41_C_ARCHITECTURE.md` | Architecture Documentation | Reconciled 8 canonical tool names, Groq source default model `openai/gpt-oss-20b`, entity runtime scope (`pet`), and certification status. |
| `R41_C_CONTEXT_REGISTRY.md` | Context Documentation | Rebuilt 1:1 from `AssistantProductContextRegistry.screens`. Removed fictitious `/bookings/:id` and `/tutors/:id`. Accurately documented 20 screens, route matchers, and aliases. |
| `R41_C_SECURITY_MODEL.md` | Security Documentation | Clarified supported entity runtime (`pet`), advisory client inputs, and server-authoritative role/tenant checks. |
| `R41_C_TEST_REPORT.md` | Test Documentation | Documented final test execution results (801 backend, 540 frontend, 80 evals, typecheck clean, dual builds clean, PWA audit 27/27). |
| `R41_C_CHANGE_MANIFEST.md` | Manifest Documentation | Tracked implementation SHA and FINAL.1 reconciliation changes. |
| `R41_C_CERTIFICATION_REPORT.md` | Certification Documentation | Updated sign-off status to `IMPLEMENTATION CERTIFIED (NOT DEPLOYED)`, updated tool names, model defaults, and invariant scorecard. |

---

## 2. Core R41.C Implementation Files (from SHA `5bba0bf`)

| File Path | Component | Summary |
|---|---|---|
| `artifacts/api-server/src/assistant/assistant-context-registry.service.ts` | Backend Context Registry | 20 source-verified screen definitions, role guidance, and fallback handling |
| `artifacts/api-server/src/assistant/assistant-context.service.ts` | Backend Context Resolver | Database entity validation (`petsTable`), tenant boundary checks, tutor ownership guards, script sanitization |
| `artifacts/api-server/src/assistant/assistant.config.ts` | Configuration | Bumped `promptVersion` to `"r41-c-1"`, `knowledgeVersion` to `"arkpet-v32-r41c"`, allowlists for routes and targets |
| `artifacts/api-server/src/assistant/assistant-tools.registry.ts` | Tool Registry | Enriched Tool 3 (`get_current_screen_context`), added Tool 8 (`get_contextual_product_guide`), hardened against SQL tools |
| `artifacts/api-server/src/assistant/assistant.router.ts` | API Router | Accepts `entity` in `screen` payload |
| `artifacts/api-server/src/assistant/assistant.service.ts` | Assistant Service | Updated system prompt for contextual screens, active pet entity, and pronoun resolution |
| `artifacts/api-server/src/assistant/assistant.provider.ts` | Mock Provider | Contextual responses for all screens, status semantics, pronoun resolution, and cross-tenant rejections |
| `artifacts/api-server/src/assistant/knowledge/dashboard.md` | Knowledge Document | Authoritative documentation on dashboard KPIs and quick actions |
| `artifacts/api-server/src/assistant/knowledge/operations.md` | Knowledge Document | Authoritative operational documentation; asserts bath as service, not standalone module |
| `artifacts/api-server/src/__tests__/assistant-evals.json` | Eval Dataset | Expanded to 80 golden evaluation cases |
| `artifacts/petdaycare/src/features/assistant/AssistantPanel.tsx` | Frontend Panel | Header context title and entity indicator, transmits `entity` payload, synchronized allowlists |

---

## 3. Preservation of Prior Phases

- `R41.A` multi-provider architecture (`MockAIProvider`, `GroqProvider`, `OpenAIProvider`) preserved with zero regression (`R41_A_REGRESSION = 0`).
- `R41.B` guided onboarding copilot, single canonical onboarding service (`onboarding.service.ts`), and 5 onboarding steps preserved with zero regression (`R41_B_REGRESSION = 0`).
- Zero domain mutations (`R41_C_DOMAIN_MUTATION_COUNT = 0`).
