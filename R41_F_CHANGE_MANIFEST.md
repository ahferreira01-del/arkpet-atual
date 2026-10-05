# ArkPet — R41.F Change Manifest

## 1. Release Identification

- **Phase:** `R41.F — OPERATIONAL COPILOT`
- **Program:** `R41 — ARKPET INTELLIGENT ASSISTANT`
- **Base Commit:** `2887f09ea5aef06af4c77124a77f6d517e1ba0ce` (Certified R41.E Final)
- **Branch:** `development/arkpet-r41-intelligent-assistant`
- **Target Repositories:**
  - Canonical: `ahferreira01-del/arkpet`
  - Deploy: `ahferreira01-del/arkpet-atual`

---

## 2. Modified Files

### 2.1. Backend API Server (`artifacts/api-server`)

| File Path | Description of Changes |
| :--- | :--- |
| `src/assistant/assistant.config.ts` | Added `isOperationalCopilotEnabled` getter guarded by kill switch; bumped `promptVersion: "r41-f-1"`; added `operationalCacheTtlSeconds: 30`, `operationalMaxListLimit: 25`, `operationalUpcomingWindowMinutes: 60`. |
| `src/assistant/assistant.types.ts` | Added `OperationalIssue`, `OperationalIssuePriority`, `OperationalIssueCategory`, `OperationalArrivalItem`, `OperationalTaskItem`, `OperationalSnapshot`, `OperationalCopilotResponse`; updated `AssistantMessage` with optional `operational` payload; added `completed` counter to task types. |
| `src/assistant/assistant-safe-action.service.ts` | Added `OperationalSnapshotService.invalidateCache(action.crecheId)` on successful confirmation to ensure real-time cache synchronization (`SAFE_ACTION_OPERATIONAL_CACHE_INVALIDATION = PASS`). |
| `src/assistant/assistant-tools.registry.ts` | Registered 5 canonical operational read tools (`get_operational_overview`, `get_operational_priorities`, `get_today_arrivals`, `get_pending_operational_tasks`, `get_recent_operational_changes`); defined `CANONICAL_OPERATIONAL_READ_TOOL_NAMES`; updated tool listing methods to preserve baseline 15 tools when flag is off and 20 tools when on. |
| `src/assistant/assistant.service.ts` | Added operational copilot guidelines to system prompt; stored session snapshot baseline on overview execution; attached operational response payload to assistant message. |
| `src/assistant/assistant.provider.ts` | Added operational parameter schemas in `OpenAICompatibleProvider`; added deterministic operational query handlers in `MockAIProvider` (overview, priorities, feedings, medications, walks, arrivals, changes, bulk mutation guard, ambiguity guard, financial boundary guard). |
| `src/__tests__/assistantKnowledge.unit.test.ts` | Updated expected prompt version to `"r41-f-1"`. |
| `src/__tests__/assistantEvals.unit.test.ts` | Enabled `AI_OPERATIONAL_COPILOT_ENABLED = "true"`; updated dataset size assertion to 142 cases. |
| `src/__tests__/assistant-evals.json` | Added 25 operational copilot evaluation test cases (EVAL-118 through EVAL-142) covering all operational question categories and safety boundaries. |

### 2.2. Frontend Web Application (`artifacts/petdaycare`)

| File Path | Description of Changes |
| :--- | :--- |
| `src/features/assistant/assistant.types.ts` | Added `OperationalCopilotUI` and optional `operational` field to `AssistantUIMessage`. |
| `src/features/assistant/AssistantPanel.tsx` | Mapped `data.message.operational` into assistant message state. |
| `src/features/assistant/AssistantConversation.tsx` | Added operational quick suggestion pills for `staff` and `creche_admin`; added operational card rendering with occupancy, arrivals, tasks metrics, priority badges, and action suggestion dispatch buttons. |
| `vitest.config.ts` | Configured `pool: "threads"` for reliable test execution on Windows. |

---

## 3. Newly Created Files

| File Path | Purpose |
| :--- | :--- |
| `artifacts/api-server/src/assistant/operational-snapshot.service.ts` | Canonical read service compiling coherent operational snapshots from database with error isolation, partial data tracking, 30s tenant-isolated cache, and baseline delta comparisons. |
| `artifacts/api-server/src/assistant/operational-priority.engine.ts` | Pure deterministic priority evaluation engine scoring operational issues (`critical`, `high`, `medium`, `low`) with multi-tier tie-breakers and registered safe action linking. |
| `artifacts/api-server/src/__tests__/assistantOperationalCopilot.unit.test.ts` | Comprehensive 30-test unit suite covering tool contracts, snapshot compilation, priority determinism, temporal integrity, data completeness, RBAC, cache isolation, and safety guards. |
| `artifacts/petdaycare/src/test/assistant-operational-copilot.test.tsx` | Frontend unit suite testing suggestion pills, operational cards, priority badges, action button dispatching, partial data warning rendering, and Indisponível fallbacks. |
| `R41_F_ARCHITECTURE.md` | Architectural specification of the Operational Copilot. |
| `R41_F_OPERATIONAL_DATA_MODEL.md` | Operational snapshot schema, nullable submodels, and temporal semantics specification. |
| `R41_F_PRIORITY_ENGINE.md` | Truthful priority rules without invented SLA, scoring weights, tie-breakers, and action linking specification. |
| `R41_F_SECURITY_MODEL.md` | Security, RBAC model, and session baseline boundaries across 4 canonical roles. |
| `R41_F_TEST_REPORT.md` | Test execution results across all suites (1,545 automated tests passed). |
| `R41_F_CHANGE_MANIFEST.md` | Complete inventory of changes in R41.F and R41.F-FINAL.1. |
| `R41_F_CERTIFICATION_REPORT.md` | Formal certification report and verification checklist. |

---

## 4. R41.F-FINAL.1 Blocker Resolutions

1. **Blocker 1 — Invented Priority SLA Thresholds Eliminated:**
   - Removed hardcoded 60, 90, 120-minute escalation thresholds (`INVENTED_OPERATIONAL_SLA = 0`).
   - Removed unsupported critical classifications (`UNSUPPORTED_CRITICAL_HEALTH_RISK_CLASSIFICATION = 0`).
   - Cites true rule source: `OPERATIONAL_PRIORITY_RULE_SOURCE = CANONICAL_TASK_PRIORITY_AND_SCHEDULE`.
   - Verified by `R41F-FINAL1-PRIORITY-001` through `005`.

2. **Blocker 2 — Unknown vs True Zero Integrity:**
   - Query failures yield `null` submodels rather than fake zero counters (`DATA_RETRIEVAL_FAILURE_INTERPRETED_AS_ZERO = 0`).
   - Removed default capacity fallback 20 (`FAKE_OPERATIONAL_CAPACITY_FALLBACK = 0`).
   - Model receives null indicators instead of synthetic zero counts (`UNAVAILABLE_OPERATIONAL_SOURCE_NUMERIC_FALLBACK = 0`).
   - Distinguishes true zero (successful query with 0 rows) from unknown/failed queries.
   - Frontend renders `Indisponível` for failed sources.
   - Verified by `R41F-FINAL1-DATA-001` through `004` and `R41F-UI-006`.

3. **Blocker 3 — Session-Bound Delta Security Boundary:**
   - Removed `sessionId` from public schema of `get_recent_operational_changes` (`MODEL_SUPPLIED_OPERATIONAL_SESSION_ID = 0`).
   - Process-local session baseline bound to `SessionBaselineContext` (`sessionId`, `userId`, `crecheId`, `role`).
   - Cross-tenant and cross-user leaks blocked (`OPERATIONAL_BASELINE_TENANT_BOUND = YES`, `OPERATIONAL_BASELINE_USER_BOUND = YES`).
   - Safe explanation when no baseline exists: `"Nenhum resumo operacional anterior nesta sessão para comparação."`.
   - Verified by `R41F-FINAL1-SESSION-001` through `004`.

4. **Blocker 4 — Full Test Evidence & Package Reconciliation:**
   - Backend unit suite: 51 files, 980 tests passed, 0 failed.
   - Frontend unit suite: 43 files, 565 tests passed, 0 failed.
   - Reconciled `WORKSPACE_PACKAGE_COUNT = 8` vs `TYPECHECK_TSC_PROJECT_COUNT = 3` (projects declaring tsconfig build: `api-server`, `petdaycare`, `scripts`).
