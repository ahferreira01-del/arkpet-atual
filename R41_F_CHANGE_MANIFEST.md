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
| `artifacts/petdaycare/src/test/assistant-operational-copilot.test.tsx` | Frontend unit suite testing suggestion pills, operational cards, priority badges, action button dispatching, and partial data warning rendering. |
| `R41_F_ARCHITECTURE.md` | Architectural specification of the Operational Copilot. |
| `R41_F_OPERATIONAL_DATA_MODEL.md` | Operational snapshot schema and temporal semantics specification. |
| `R41_F_PRIORITY_ENGINE.md` | Priority rules, scoring weights, tie-breakers, and action linking specification. |
| `R41_F_SECURITY_MODEL.md` | Security and RBAC model across 4 canonical roles. |
| `R41_F_TEST_REPORT.md` | Test execution results across all suites. |
| `R41_F_CHANGE_MANIFEST.md` | Complete inventory of changes in R41.F. |
| `R41_F_CERTIFICATION_REPORT.md` | Formal certification report and verification checklist. |
