# ARKPET — R41.C CHANGE MANIFEST
## File Modification and Creation Manifest

**Phase:** R41.C — Contextual Product Guide  
**Baseline SHA:** `ba2052fa9a88ca9a9dfd1afe302f528d88db120c`  
**Date:** 2026-10-02  
**Status:** FULLY CERTIFIED  

---

## 1. Newly Created Files

| File Path | Component | Purpose |
|---|---|---|
| `artifacts/api-server/src/assistant/assistant-context-registry.service.ts` | Backend Context Registry | Maps 20 source-verified routes to structured metadata, actions, targets, and role guidance |
| `artifacts/api-server/src/assistant/knowledge/dashboard.md` | Product Knowledge | Authoritative product documentation on Dashboard KPIs, onboarding, and quick actions |
| `artifacts/api-server/src/assistant/knowledge/operations.md` | Product Knowledge | Authoritative operational documentation on check-in, check-out, feeding, walks, and bath service semantics |
| `artifacts/api-server/src/__tests__/assistantContextualGuide.unit.test.ts` | Backend Unit Tests | 24 unit and security tests covering context resolution, RBAC, anti-bypass, pronouns, and state transitions |
| `artifacts/petdaycare/src/test/assistant-contextual-guide.test.tsx` | Frontend Unit Tests | 9 tests validating hook extraction, context header rendering, entity badge, and message transmission |
| `R41_C_ARCHITECTURE.md` | Documentation | Architecture specification for Contextual Product Guide |
| `R41_C_CONTEXT_REGISTRY.md` | Documentation | Inventory of 20 verified routes, action allowlists, and fallback specs |
| `R41_C_SECURITY_MODEL.md` | Documentation | Zero-trust security model, boundary defenses, and invariant scorecard |
| `R41_C_TEST_REPORT.md` | Documentation | Comprehensive verification report across all test suites and builds |
| `R41_C_CHANGE_MANIFEST.md` | Documentation | Inventory of all modified and newly created files |
| `R41_C_CERTIFICATION_REPORT.md` | Documentation | Final certification sign-off report |

---

## 2. Modified Backend Files (`artifacts/api-server`)

| File Path | Summary of Modifications |
|---|---|
| `src/assistant/assistant.types.ts` | Added `ScreenEntityContext`, enriched `ScreenContext` with `routeId`, `title`, `description`, `allowedActions`, `availableActionIds`, `guidanceTargets`, `knowledgeCategories`, `entity`. Added `ProductScreenDefinition`. |
| `src/assistant/assistant-context.service.ts` | Re-architected with server-side database entity validation (`petsTable`), cross-tenant defense, tutor ownership guards, role RBAC enforcement, and input string sanitization against script injection. |
| `src/assistant/assistant.config.ts` | Bumped `promptVersion` to `"r41-c-1"`, `knowledgeVersion` to `"arkpet-v32-r41c"`. Expanded `allowedGuidanceRoutes` (19 routes) and `allowedGuidanceTargets` (12 targets). |
| `src/assistant/assistant-tools.registry.ts` | Enriched Tool 3 (`get_current_screen_context`) with structured screen & entity metadata. Added Tool 8 (`get_contextual_product_guide`). Hardened tool normalization against generic database tools (`query_database`, etc.). |
| `src/assistant/assistant.router.ts` | Updated `messageBodySchema` to accept optional `entity` and `availableActionIds` in `screen` payload. |
| `src/assistant/assistant.service.ts` | Updated system prompt to `r41-c-1` with contextual screen, entity, pronoun ("ele", "dele"), and role-guidance instructions. |
| `src/assistant/assistant.provider.ts` | Enriched `MockAIProvider` with contextual handlers for all 20 screens, status semantics (`pendente`), pronoun resolution (`Thor`), ambiguous pronoun clarification, bath non-standalone module, cross-tenant rejection, and master admin scoping. |
| `src/__tests__/assistant-evals.json` | Added 22 new contextual evaluation cases (EVAL-59 through EVAL-80, totaling 80 golden evals). |
| `src/__tests__/assistantEvals.unit.test.ts` | Updated assertions and schema validation to support 80 eval cases and R41.C versions. |
| `src/__tests__/assistantKnowledge.unit.test.ts` | Updated version assertions to expect `"arkpet-v32-r41c"` and `"r41-c-1"`. |

---

## 3. Modified Frontend Files (`artifacts/petdaycare`)

| File Path | Summary of Modifications |
|---|---|
| `src/features/assistant/assistant.types.ts` | Added `ScreenEntityInfo` and optional `entity` property to `ScreenContextInfo`. |
| `src/features/assistant/useAssistantContext.ts` | Added route parameter parsing to extract entity IDs for `/pets/:id`, `/bookings/:id`, `/tutors/:id`. |
| `src/features/assistant/AssistantPanel.tsx` | Transmits `entity` in `POST /api/assistant/message` body. Added subtle context title and entity indicator badge in header. Synchronized `ALLOWED_GUIDANCE_ROUTES` and `ALLOWED_GUIDANCE_TARGETS`. |

---

## 4. Preservation of Certified Prior Phases

- `R41.A` multi-provider architecture (`MockAIProvider`, `GroqProvider`, `OpenAIProvider`) preserved without regression.
- `R41.B` guided onboarding copilot, `AssistantGuidanceService`, canonical single source of truth (`onboarding.service.ts`), and 5 onboarding steps preserved intact.
- Zero breaking changes to existing REST endpoints or database schemas.
