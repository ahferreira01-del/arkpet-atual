# ArkPet — R41.F Operational Priority Engine Specification

## 1. Engine Purpose & Core Principles

The `OperationalPriorityEngine` is a **pure, deterministic, algorithmic scoring and ranking engine** for daycare operations.

The LLM is strictly prohibited from inventing priority levels or deciding criticality from random or subjective criteria. All urgency scores and ordering are derived from canonical business facts according to established operational rules.

```text
OPERATIONAL_PRIORITY_RULE_SOURCE = "CANONICAL_TASK_PRIORITY_AND_SCHEDULE"
```

---

## 2. Priority Levels & Numerical Weights

The engine defines explicit, deterministic priority tiers based strictly on canonical task schedule and task priority attributes:

| Priority Level | Weight | Semantics |
| :--- | :---: | :--- |
| `critical` | **4** | Reserved strictly for conditions explicitly designated as critical by canonical domain sources. Ordinary delays are never fabricated as critical (`UNSUPPORTED_CRITICAL_HEALTH_RISK_CLASSIFICATION = 0`). Returns 0 items in absence of canonical critical flag. |
| `high` | **3** | Urgent operational pendencies: overdue medication, overdue feeding, arrival on-the-way with active ETA, or task with canonical `priority === 'high'`. |
| `medium` | **2** | Normal overdue task, overdue routine walk, confirmed pending arrival awaiting check-in, future medication/feeding scheduled for today. |
| `low` | **1** | Routine future scheduled task (walk or general task scheduled for later in the shift). |

---

## 3. Deterministic Domain Evaluation Rules (Zero Fabricated SLAs)

No artificial time thresholds (`60m`, `90m`, `120m`) are invented (`INVENTED_OPERATIONAL_SLA = 0`). Priority derives strictly from task category, canonical `priority` field, and schedule state:

### 3.1. Medication Tasks (`type === "medication"`)
- **Base Condition:** `status === "pending"`.
- **Classification:**
  - If overdue (`delayMinutes > 0`): Priority = `high`.
  - If scheduled for today but not yet overdue: Priority = `medium`.
- **Action Linkage:** `record_medication_administration` (Registered R41.E tool).

### 3.2. Feeding Tasks (`type === "feeding"`)
- **Base Condition:** `status === "pending"`.
- **Classification:**
  - If overdue (`delayMinutes > 0`): Priority = `high`.
  - If scheduled for today but not yet overdue: Priority = `medium`.
- **Action Linkage:** `complete_feeding_task` (Registered R41.E tool).

### 3.3. Walk Tasks (`type === "walk"`)
- **Base Condition:** `status === "pending"`.
- **Classification:**
  - If overdue (`delayMinutes > 0`): Priority = `medium`.
  - If scheduled for today: Priority = `low`.
- **Action Linkage:** `complete_walk_task` (Registered R41.E tool).

### 3.4. General Routine Tasks (`type === "operational" | "cleaning" | etc.`)
- **Base Condition:** `status === "pending"`.
- **Classification:**
  - Respects canonical `task.priority`: if `task.priority === "high"`, overdue is `high`, future is `medium`.
  - Standard general tasks: overdue is `medium`, future is `low`.
- **Action Linkage:** `complete_operational_task` (Registered R41.E tool).

### 3.5. Arrivals / Check-ins (`category === "arrival"`)
- **Base Condition:** Booking `status === "confirmed"` on `startDate === businessDate`.
- **Classification:**
  - If pet is flagged `onTheWayAt` or has `onTheWayEtaMinutes`: Priority = `high`.
  - If confirmed but not yet reported on-the-way: Priority = `medium`.
- **Action Linkage:** `check_in_pet` (Registered R41.E tool).

---

## 4. Deterministic Multi-Tier Tie-Breaking Algorithm

When multiple operational issues are evaluated, ordering is guaranteed to be 100% deterministic using a 3-tier comparator:

```typescript
return issues.sort((a, b) => {
  // Tier 1: Priority numerical weight descending (high > medium > low)
  const weightDiff = PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority];
  if (weightDiff !== 0) return weightDiff;

  // Tier 2: Delay duration descending (longest overdue first)
  const delayDiff = (b.delayMinutes || 0) - (a.delayMinutes || 0);
  if (delayDiff !== 0) return delayDiff;

  // Tier 3: Stable identifier string ascending (alphabetical tie-breaker)
  return a.id.localeCompare(b.id);
});
```

---

## 5. Safe Action Linkage & Integrity Verification

To prevent hallucinations of nonexistent or autonomous actions:
- Every recommended action attaches to a concrete issue with:
  - `tool`: The exact canonical tool name.
  - `label`: Human-readable description.
  - `targetId` / `taskId` / `petId`: Contextual entity identifiers.
- **Invariant `UNREGISTERED_RECOMMENDED_ACTION = 0`:**
  Before returning any issue, the engine verifies `AssistantSafeActionRegistry.isRegistered(toolName)`. If the tool is not in the certified registry, the `suggestedAction` object is stripped completely.
- **Zero Autonomous Execution:**
  The attachment of a `suggestedAction` only renders a proposal prompt or button in the UI. It **never** mutates the database without human confirmation.
