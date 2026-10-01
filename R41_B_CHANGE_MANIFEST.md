# ARKPET — R41.B CHANGE MANIFEST
## Cumulative Change Manifest: R41.B Implementation & FINAL.1 Closure

**Phase:** R41.B — AI Guided Onboarding  
**Baseline SHA:** `fb8ed90f3b31358464ea22dce07655b46961934b`  
**Implementation SHA:** `e76e704d5bd1ae9e22d6c6f9eb5f1320b7971d05`  
**Branch:** `development/arkpet-r41-intelligent-assistant`  
**Date:** 2026-10-01  

---

## 1. Commit Chain Provenance

```
fb8ed90f3b31358464ea22dce07655b46961934b (R41.A Certified Baseline)
  │
  ▼
e76e704d5bd1ae9e22d6c6f9eb5f1320b7971d05 (R41.B Initial Implementation)
  │
  ▼
[FINAL.1 CLOSURE COMMIT] (Single Canonical Onboarding Service, RBAC Alignment & 6 Artifacts)
```

---

## 2. Commit 1: R41.B Initial Implementation (`e76e704d5bd1ae9e22d6c6f9eb5f1320b7971d05`)

| Type | Path | Description |
| :--- | :--- | :--- |
| **NEW** | `artifacts/api-server/src/assistant/assistant-guidance.service.ts` | Guidance planner, route/target sanitizers |
| **NEW** | `artifacts/api-server/src/__tests__/assistantGuidedOnboarding.unit.test.ts` | 20 unit tests for guided onboarding logic |
| **NEW** | `artifacts/petdaycare/src/test/assistant-guided-onboarding.test.tsx` | 7 component tests for UI actions and highlights |
| **MOD** | `artifacts/api-server/src/assistant/assistant.config.ts` | Bumped prompt to `r41-b-1`, defined route/target allowlists |
| **MOD** | `artifacts/api-server/src/assistant/assistant.types.ts` | Added `CanonicalOnboardingStepId`, `GuidedOnboardingStatus`, `AssistantUIAction` |
| **MOD** | `artifacts/api-server/src/assistant/assistant-tools.registry.ts` | Added Tool 7: `get_guided_onboarding_plan` |
| **MOD** | `artifacts/api-server/src/assistant/assistant.service.ts` | Injected screenContext, updated system prompt, attached uiActions |
| **MOD** | `artifacts/api-server/src/assistant/assistant.provider.ts` | Added onboarding plan handling in `MockAIProvider` |
| **MOD** | `artifacts/api-server/src/assistant/assistant-audit.service.ts` | Added `logOnboardingEvent` telemetry |
| **MOD** | `artifacts/api-server/src/__tests__/assistant-evals.json` | Added 6 onboarding golden evaluation cases (total 58) |
| **MOD** | `artifacts/api-server/src/__tests__/assistantEvals.unit.test.ts` | Updated golden evals count expectation |
| **MOD** | `artifacts/api-server/src/__tests__/assistantKnowledge.unit.test.ts` | Bumped expected prompt version to `r41-b-1` |
| **MOD** | `artifacts/petdaycare/src/components/onboarding/creche-onboarding-card.tsx` | Added "Continuar com Assistente" trigger button |
| **MOD** | `artifacts/petdaycare/src/features/assistant/AssistantConversation.tsx` | Render navigation chips and element highlight triggers |
| **MOD** | `artifacts/petdaycare/src/features/assistant/AssistantPanel.tsx` | Trigger safe route navigation and element focus ring |
| **MOD** | `artifacts/petdaycare/src/features/assistant/assistant.types.ts` | Added frontend UI action and onboarding types |
| **MOD** | `artifacts/petdaycare/src/features/assistant/index.tsx` | Auto-expand panel on `arkpet:open-assistant` event |
| **MOD** | `artifacts/petdaycare/src/pages/settings/index.tsx` | Tagged `id="creche-profile-form"` |
| **MOD** | `artifacts/petdaycare/src/pages/staff/manage.tsx` | Tagged `id="staff-create-button"` |
| **MOD** | `artifacts/petdaycare/src/pages/tutors/index.tsx` | Tagged `id="tutor-create-button"` |
| **MOD** | `artifacts/petdaycare/src/pages/pets/index.tsx` | Tagged `id="pet-create-button"` |
| **MOD** | `artifacts/petdaycare/src/pages/bookings/index.tsx` | Tagged `id="booking-create-button"` |

---

## 3. Commit 2: R41.B-FINAL.1 Closure Commit

| Type | Path | Purpose / Blocker Addressed |
| :--- | :--- | :--- |
| **NEW** | `artifacts/api-server/src/services/onboarding.service.ts` | **Blocker 1**: Single server-side source of truth (`getCanonicalOnboardingStatus`) |
| **MOD** | `artifacts/api-server/src/routes/creches.ts` | **Blocker 1**: `getCrecheOnboardingHandler` refactored to consume shared service |
| **MOD** | `artifacts/api-server/src/assistant/assistant-tools.registry.ts` | **Blocker 1 & 2**: Consumes shared service; `allowedRoles: ["creche_admin"]` |
| **MOD** | `artifacts/api-server/src/assistant/assistant-guidance.service.ts` | **Blocker 1 & 2**: Exports `CANONICAL_ONBOARDING_TARGETS`; role guard `creche_admin` |
| **MOD** | `artifacts/api-server/src/assistant/assistant.router.ts` | **Blocker 2**: GET `/onboarding` restricted strictly to `creche_admin` |
| **MOD** | `artifacts/api-server/src/assistant/assistant.provider.ts` | **Blocker 2**: `MockAIProvider` onboarding queries restricted strictly to `creche_admin` |
| **MOD** | `artifacts/api-server/src/__tests__/assistantGuidedOnboarding.unit.test.ts` | **Blocker 1 & 2**: Expanded to 30 tests covering canonical parity and RBAC |
| **NEW** | `R41_B_ARCHITECTURE.md` | **Blocker 3**: Architecture documentation committed in repo root |
| **NEW** | `R41_B_GUIDANCE_REGISTRY.md` | **Blocker 3**: Guidance registry committed in repo root |
| **NEW** | `R41_B_SECURITY_MODEL.md` | **Blocker 3**: Security and RBAC model committed in repo root |
| **NEW** | `R41_B_TEST_REPORT.md` | **Blocker 3**: Full test execution report committed in repo root |
| **NEW** | `R41_B_CHANGE_MANIFEST.md` | **Blocker 3**: Cumulative change manifest committed in repo root |
| **NEW** | `R41_B_CERTIFICATION_REPORT.md` | **Blocker 3**: Official certification report committed in repo root |
