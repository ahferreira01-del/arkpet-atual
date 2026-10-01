# ARKPET — R41.A CHANGE MANIFEST
## FILE INVENTORY & IMPLEMENTATION ARTIFACTS (R41.A-FINAL.6)

**Release Phase:** `R41.A — FREE PROVIDER ACTIVATION, GROQ INTEGRATION & MULTI-PROVIDER AI CLOSURE (R41.A-FINAL.6)`  
**Git Branch:** `development/arkpet-r41-intelligent-assistant`  
**Base Commit (R40 Frozen RC):** `58b4ff0e5cabd958d0f601af202378900427caab`  
**Parent SHA:** `cdbcafe83207c6ec61189990dedc87a38e796c43`  

---

## 1. Modified Existing Files (Surgical & Non-Breaking)

| File Path | Type | Nature of Change |
| :--- | :--- | :--- |
| `artifacts/api-server/src/routes/index.ts` | Route index | Mounted `assistantRouter` under `/api/assistant`. Zero changes to existing routes. |
| `artifacts/petdaycare/src/components/layout/app-layout.tsx` | Layout | Imported `AssistantContainer` via `React.lazy` wrapped in `<React.Suspense fallback={null}>`. Non-blocking. |
| `artifacts/api-server/src/assistant/assistant.provider.ts` | Provider engine | Evolved into Multi-Provider AI Architecture with `OpenAICompatibleProvider` base, `GroqProvider` (default dev), `OpenAIProvider`, and `MockAIProvider`. |
| `artifacts/api-server/src/assistant/assistant.config.ts` | Config | Dynamic getters for `defaultProvider` (`groq`) and `defaultModel` (`openai/gpt-oss-20b`). |
| `artifacts/api-server/src/assistant/assistant.service.ts` | Service | Injects active provider and model into audit telemetry. |
| `artifacts/api-server/src/assistant/assistant-audit.service.ts` | Audit | Tracks provider in `assistant_message_turn` without exposing keys. |
| `scripts/live-provider-connectivity-smoke.mjs` | Smoke script | Enforces normal TLS certificate validation (`NODE_TLS_REJECT_UNAUTHORIZED_OVERRIDE = 0`). |
| `scripts/live-provider-authenticated-smoke.mjs` | Smoke script | Enforces normal TLS validation, fail-closed without real key. |
| `scripts/live-groq-connectivity-smoke.mjs` | Smoke script | Verifies live HTTPS reachability to `api.groq.com` with TLS validation enabled. |
| `scripts/live-groq-authenticated-smoke.mjs` | Smoke script | Executes live authenticated inference (HTTP 200) and function calling roundtrip. |

---

## 2. New Backend Files (`artifacts/api-server/src/assistant/`)

| File Path | Purpose |
| :--- | :--- |
| `assistant.config.ts` | Assistant configuration, feature flags, constants (`arkpet-v32-r41`, `r41-a-1`). |
| `assistant.types.ts` | TypeScript interfaces for contexts, sessions, tools, messages, and audit payloads. |
| `assistant-audit.service.ts` | Redacted structured audit logging wrapping `lib/logger.ts`. |
| `assistant-knowledge.service.ts` | In-memory search with stopword filtering, section weighting, and `isKnownFeature` detection. |
| `assistant-context.service.ts` | Resolves user, creche, and screen context from server session. |
| `assistant-tools.registry.ts` | Read-only registry containing 6 validated tools (`GENERAL_DB_ACCESS_TOOL = 0`). |
| `assistant.provider.ts` | Multi-provider architecture (`MockAIProvider`, `GroqProvider`, `OpenAIProvider`). |
| `assistant.service.ts` | Assistant orchestration engine, session manager, and boundary guard. |
| `assistant.router.ts` | Express router exposing `/api/assistant` endpoints (`/message`, `/context`, `/onboarding`, `/session`). |

---

## 3. New Domain Knowledge Corpus (`artifacts/api-server/src/assistant/knowledge/`)

| File Path | Topic |
| :--- | :--- |
| `onboarding.md` | 5 onboarding steps, creche profile, capacity, services, Pix payment setup. |
| `reservations.md` | Reservation workflows, statuses (`PENDING`, `CONFIRMED`, `IN_HOUSE`), check-in/out. |
| `pets.md` | Pet registration, breeds, sizes, vaccine tracking, feeding routines, medication notes. |
| `financial.md` | Daily cash flow, POS sales, order reconciliation, closures, payment methods. |
| `chat.md` | Direct messaging between tutors and creche staff, photo sharing, privacy rules. |
| `roles.md` | Permissions matrix for `master_admin`, `creche_admin`, `staff`, and `tutor`. |
| `notifications.md` | Push notifications, idempotency, event types, preferences. |
| `settings.md` | Creche operating hours, business details, Pix keys, security settings. |

---

## 4. New Backend Test Suites & Data (`artifacts/api-server/src/__tests__/`)

| File Path | Content |
| :--- | :--- |
| `groqProviderSmoke.unit.test.ts` | 11 unit tests covering Groq HTTP contract, Model→Tool→Model roundtrip, role boundaries, loop limiter, prompt injection defense, rate-limiting, and fail-closed routing. |
| `realProviderSmoke.unit.test.ts` | 8 unit tests covering OpenAI wire contract, Model→Tool→Model roundtrip, and error sanitization. |
| `assistantSecurity.unit.test.ts` | 14 unit tests covering injection, PII redaction, RBAC, isolation, and rate-limiting. |
| `assistantKnowledge.unit.test.ts` | 8 unit tests covering knowledge indexing, retrieval scoring, and citations. |
| `assistantEvals.unit.test.ts` | 53 unit tests executing 52 golden cases across all 4 roles. |
| `assistant-evals.json` | 52 golden question test cases with role contexts, expected concepts, and boundary checks. |

---

## 5. New Frontend Components (`artifacts/petdaycare/src/features/assistant/`)

| File Path | Purpose |
| :--- | :--- |
| `index.tsx` | Main feature container managing panel visibility, minimize state, and lazy mounting. |
| `assistant.types.ts` | Frontend UI types, message contracts, and visual state definitions. |
| `useAssistantContext.ts` | Hook extracting current route and view semantics for screen context awareness. |
| `AssistantLauncher.tsx` | Accessible floating button with pulse indicator and first-access greeting banner. |
| `AssistantPanel.tsx` | Responsive drawer (desktop) / bottom sheet (mobile) with ARIA dialog & focus trap. |
| `AssistantConversation.tsx` | Message list, quick suggestions, typing status, and privacy warning banner. |
| `AssistantTypingState.tsx` | Animated, accessible typing indicator dots. |
| `AssistantKnowledgeCitation.tsx` | Source badges linking answers to specific ArkPet knowledge documents. |
| `AssistantFeedback.tsx` | Helpful/unhelpful feedback controls persisted locally. |

---

## 6. New Frontend Test Suite (`artifacts/petdaycare/src/test/`)

| File Path | Purpose |
| :--- | :--- |
| `assistant-ux.test.tsx` | 9 UX tests covering desktop/mobile dialogs, focus trap, Escape key, offline fallback, persistence. |

---

## 7. Live Smoke Scripts (`scripts/`)

| File Path | Purpose |
| :--- | :--- |
| `scripts/live-groq-connectivity-smoke.mjs` | Verifies live HTTPS reachability to `api.groq.com` with TLS validation enabled. |
| `scripts/live-groq-authenticated-smoke.mjs` | Performs live authenticated model inference on Groq endpoint (HTTP 200) and function calling roundtrip. |
| `scripts/live-provider-connectivity-smoke.mjs` | Verifies live HTTPS reachability to `api.openai.com` with TLS validation enabled. |
| `scripts/live-provider-authenticated-smoke.mjs` | Performs live authenticated model inference on OpenAI endpoint; fails closed if no credential. |

---

## 8. Architecture & Certification Documentation (`artifacts directory` & root)

| File Name | Description |
| :--- | :--- |
| `R41_A_ARCHITECTURE.md` | Complete end-to-end architecture specification for R41.A including multi-provider design. |
| `R41_A_SECURITY_MODEL.md` | Security boundaries, RBAC matrix, prompt injection defenses. |
| `R41_A_PRIVACY_MODEL.md` | Data privacy, PII scrubbing, zero multi-tenant leakage. |
| `R41_A_TOOL_REGISTRY.md` | Catalog of 6 read-only tools with parameter schemas and access levels. |
| `R41_A_KNOWLEDGE_ARCHITECTURE.md` | Domain knowledge ingestion, versioning, search, and citation model. |
| `R41_A_ASSISTANT_SYSTEM_PROMPT.md` | Master system prompt definition with role-specific operational parameters. |
| `R41_A_EVAL_REPORT.md` | Results of the 52 golden question domain evaluations. |
| `R41_A_TEST_REPORT.md` | Complete automated test report across backend (716 tests), frontend (524 tests), and build gates. |
| `R41_A_CHANGE_MANIFEST.md` | This file inventory. |
| `R41_A_CERTIFICATION_REPORT.md` | Final certification scorecard and release sign-off. |
