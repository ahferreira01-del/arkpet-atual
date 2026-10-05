# ArkPet — R41.F Operational Data Model Specification

## 1. Executive Summary

This document specifies the operational read model, data sources, time semantics, bounding constraints, and data completeness protocols for **R41.F — Operational Copilot**.

The assistant does **not** maintain a shadow database (`ASSISTANT_OPERATIONAL_SHADOW_DATABASE = 0`). All operational metrics and facts are derived synchronously and coherently from the canonical domain database (`@workspace/db`).

---

## 2. Temporal & Business Date Semantics

| Parameter | Specification | Invariant Enforcement |
| :--- | :--- | :--- |
| **Server Now Reference** | Canonical server clock timestamp (`new Date()`). | `OPERATIONAL_DATE_SOURCE = CANONICAL_SERVER_TIME` |
| **Snapshot Timestamp** | Exact ISO-8601 string (`asOf`) generated at read time. | `OPERATIONAL_SNAPSHOT_TIMESTAMP = YES` |
| **Business Date** | Resolved using `getBusinessDate("America/Sao_Paulo")` (UTC-3). | Prevents LLM misinterpretation of "hoje" or "agora". |
| **Task Overdue Rule** | `scheduledFor < serverNow AND status == "pending"`. | LLM is forbidden from calculating overdue status. |
| **Completed Tasks** | Completed or cancelled tasks are **never** overdue. | `R41F-OPS-004 = PASS` |

---

## 3. Operational Snapshot Schema (`OperationalSnapshot`)

```typescript
export interface OperationalSourceStatus {
  occupancy: "available" | "unavailable";
  bookings: "available" | "unavailable";
  tasks: "available" | "unavailable";
}

export interface OperationalSnapshot {
  asOf: string;                              // ISO-8601 UTC timestamp
  businessDate: string;                      // YYYY-MM-DD (America/Sao_Paulo)
  crecheId: number;                          // Tenant identifier
  dataCompleteness: "complete" | "partial";  // Integrity indicator
  unavailableSources?: string[];             // List of failed sub-queries ("occupancy", "bookings", "tasks")
  sourceStatus: OperationalSourceStatus;     // Explicit availability indicator per source
  occupancy: {
    current: number | null;                  // Current pets present in creche (null if query failed)
    capacity: number | null;                 // Maximum creche capacity (null if unconfigured or query failed)
  } | null;
  arrivals: {
    totalExpected: number | null;            // Bookings starting today (null if query failed)
    checkedIn: number | null;                // Status 'active'
    pending: number | null;                  // Status 'confirmed'
    completed: number | null;                // Status 'completed'
    cancelled: number | null;                // Status 'cancelled'
    onTheWay: number | null;                 // Has onTheWayAt or onTheWayType
    items: OperationalArrivalItem[];         // Bounded item list
  } | null;
  departures: {
    totalExpected: number | null;            // Bookings ending today or active
    checkedOut: number | null;               // Status 'completed'
    pending: number | null;                  // Status 'active'
  } | null;
  tasks: {
    total: number | null;                    // All scheduled tasks for today (null if query failed)
    pending: number | null;                  // Tasks waiting execution
    completed: number | null;                // Executed tasks
    overdue: number | null;                  // Past scheduled time & pending
    unassigned: number | null;               // AssignedToId == null
    byType: {
      feeding: { total: number | null; pending: number | null; completed: number | null; overdue: number | null };
      medication: { total: number | null; pending: number | null; completed: number | null; overdue: number | null };
      walk: { total: number | null; pending: number | null; completed: number | null; overdue: number | null };
      other: { total: number | null; pending: number | null; completed: number | null; overdue: number | null };
    };
    items: OperationalTaskItem[];            // Bounded task item list
  } | null;
  issues: OperationalIssue[];                // Deterministically prioritized issues
}
```

---

## 4. Sub-Entity Schemas

### 4.1. Operational Arrival Item (`OperationalArrivalItem`)
```typescript
export interface OperationalArrivalItem {
  bookingId: number;
  petId: number;
  petName: string;
  tutorId: number;
  status: "confirmed" | "active" | "completed" | "cancelled";
  serviceType: "daycare" | "hotel";
  onTheWayType?: string | null;
  onTheWayEtaMinutes?: number | null;
  onTheWayAt?: string | null;
}
```

### 4.2. Operational Task Item (`OperationalTaskItem`)
```typescript
export interface OperationalTaskItem {
  id: number;
  type: "feeding" | "medication" | "walk" | "cleaning" | "operational" | string;
  title: string;
  status: "pending" | "completed" | "skipped" | string;
  scheduledFor: string;
  petId?: number | null;
  petName?: string | null;
  assignedToId?: number | null;
  assignedToName?: string | null;
  priority: string | null;
  isOverdue: boolean;
  delayMinutes: number;
}
```

### 4.3. Operational Issue (`OperationalIssue`)
```typescript
export interface OperationalIssue {
  id: string;                                // Stable identifier (e.g., "task_medication_11")
  category: "medication" | "feeding" | "walk" | "arrival" | "departure" | "task";
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  reason: string;
  reasonCode: string;                        // Deterministic classification code
  targetType: "task" | "booking" | "pet";
  targetId: number;
  petId?: number;
  petName?: string;
  scheduledFor?: string;
  delayMinutes?: number;
  detectedAt: string;
  suggestedAction?: {
    tool: string;                            // Must be in AssistantSafeActionRegistry
    taskId?: number;
    bookingId?: number;
    petId?: number;
    targetId: number;
    label: string;
  };
}
```

---

## 5. Data Completeness & Degradation Protocol

When any database query encounters an error (e.g., query timeout, network glitch):
1. **Never Assume Zero:** The error is **not** swallowed or coerced to 0 (`DATA_RETRIEVAL_FAILURE_INTERPRETED_AS_ZERO = 0`). Submodels become `null`.
2. **No Fake Default Capacity:** Capacity is never defaulted to 20 (`FAKE_OPERATIONAL_CAPACITY_FALLBACK = 0`). Only genuine database values are accepted.
3. **No Synthetic Model Counts:** Model payload receives null/unavailable status instead of synthetic zero counts (`UNAVAILABLE_OPERATIONAL_SOURCE_NUMERIC_FALLBACK = 0`).
4. **Flag Completeness:** `snapshot.dataCompleteness` is set to `"partial"`.
5. **Record Unavailable Source:** The failed subsystem is added to `snapshot.unavailableSources` (e.g., `["tasks"]`) and reflected in `sourceStatus`.
6. **User Transparency:** Assistant output and frontend cards surface a prominent warning badge and render `Indisponível` for failed metrics.
7. **True Zero vs Unknown Distinction:** A successful query with 0 rows returns genuine 0 counts (`dataCompleteness = "complete"`), definitively distinguished from an unavailable source.

---

## 6. Result Bounding & Count Parity

To prevent unbounded payload generation and token overflow:
- All returned arrays (`arrivals.items`, `tasks.items`, `priorities`) are capped by `ASSISTANT_CONFIG.operationalMaxListLimit` (default: 25 items).
- Aggregated counts (`totalExpected`, `totalPending`, `totalIssues`) always reflect the true mathematical count across the entire dataset.
- Invariant `UNBOUNDED_OPERATIONAL_TOOL_RESULT = 0` is strictly maintained.

---

## 7. Session Baseline Security Binding

Session baselines for change detection (`get_recent_operational_changes`) are strictly process-local and securely bound:
```typescript
export interface SessionBaselineContext {
  sessionId: string;
  userId: number;
  crecheId: number;
  role: AssistantRole;
}
```
- `MODEL_SUPPLIED_OPERATIONAL_SESSION_ID = 0`: The model cannot supply an arbitrary session ID. Session identity is injected from the server security context.
- Cross-tenant and cross-user leaks are strictly blocked (`OPERATIONAL_BASELINE_USER_BOUND = YES`, `OPERATIONAL_BASELINE_TENANT_BOUND = YES`, `OPERATIONAL_BASELINE_ROLE_BOUND = YES`).
- If no baseline exists in the active session, the system returns: `"Nenhum resumo operacional anterior nesta sessão para comparação."`.
