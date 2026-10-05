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
export interface OperationalSnapshot {
  asOf: string;                              // ISO-8601 UTC timestamp
  businessDate: string;                      // YYYY-MM-DD (America/Sao_Paulo)
  crecheId: number;                          // Tenant identifier
  dataCompleteness: "complete" | "partial";  // Integrity indicator
  unavailableSources?: string[];             // List of failed sub-queries
  occupancy: {
    current: number;                         // Current pets present in creche
    capacity: number;                        // Maximum creche capacity
  };
  arrivals: {
    totalExpected: number;                   // Bookings starting today
    checkedIn: number;                       // Status 'active'
    pending: number;                         // Status 'confirmed'
    completed: number;                       // Status 'completed'
    cancelled: number;                       // Status 'cancelled'
    onTheWay: number;                        // Has onTheWayAt or onTheWayType
    items: OperationalArrivalItem[];         // Bounded item list
  };
  departures: {
    totalExpected: number;                   // Bookings ending today or active
    checkedOut: number;                      // Status 'completed'
    pending: number;                         // Status 'active'
  };
  tasks: {
    total: number;                           // All scheduled tasks for today
    pending: number;                         // Tasks waiting execution
    completed: number;                       // Executed tasks
    overdue: number;                         // Past scheduled time & pending
    unassigned: number;                      // AssignedToId == null
    byType: {
      feeding: { total: number; pending: number; completed: number; overdue: number };
      medication: { total: number; pending: number; completed: number; overdue: number };
      walk: { total: number; pending: number; completed: number; overdue: number };
      other: { total: number; pending: number; completed: number; overdue: number };
    };
    items: OperationalTaskItem[];            // Bounded task item list
  };
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
1. **Never Assume Zero:** The error is **not** swallowed or coerced to 0 (`DATA_RETRIEVAL_FAILURE_INTERPRETED_AS_ZERO = 0`).
2. **Flag Completeness:** `snapshot.dataCompleteness` is set to `"partial"`.
3. **Record Unavailable Source:** The failed subsystem is added to `snapshot.unavailableSources` (e.g., `["tasks"]`).
4. **User Transparency:** Assistant output surfaces a prominent warning notice (`⚠️ Aviso: Os dados de tasks estão temporariamente indisponíveis`).

---

## 6. Result Bounding & Count Parity

To prevent unbounded payload generation and token overflow:
- All returned arrays (`arrivals.items`, `tasks.items`, `priorities`) are capped by `ASSISTANT_CONFIG.operationalMaxListLimit` (default: 25 items).
- Aggregated counts (`totalExpected`, `totalPending`, `totalIssues`) always reflect the true mathematical count across the entire dataset.
- Invariant `UNBOUNDED_OPERATIONAL_TOOL_RESULT = 0` is strictly maintained.
