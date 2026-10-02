# ARKPET — R41.E AUDIT AND IDEMPOTENCY SPECIFICATION
## CAS STATE MACHINE, IMMUTABLE AUDIT TRAIL, IDEMPOTENCY ENGINE & LIFECYCLE MANAGEMENT

**Phase:** R41.E — Safe Actions  
**Program:** R41 — ArkPet Intelligent Assistant  
**Baseline Commit:** `ab539ae4504d8c18d192e0bd2416805789200f1f` (`R41_D_FINAL_SHA`)  
**Status:** Certified Architecture & Implemented  

---

## 1. System Overview

Safe actions in ArkPet execute operations with direct domain and physical impacts—such as checking in an animal, recording prescribed medication administration, or cancelling reservations. To guarantee financial and operational integrity, the execution layer enforces two foundational guarantees:

1. **Strict Idempotency:** Any execution request can be repeated safely without causing duplicate actions, race conditions, or inconsistent state.
2. **Immutable Auditability:** Every proposed, confirmed, cancelled, expired, or failed action generates an unmodifiable audit trail linking the requesting identity, payload hash, timestamps, and domain outcome.

---

## 2. Drizzle Database Schema

The safe action architecture is backed by two dedicated PostgreSQL tables defined in `@workspace/db`:

### 2.1 Pending Actions (`assistant_pending_actions`)
Tracks the lifecycle of proposed mutations prior to and during execution.

```sql
CREATE TABLE IF NOT EXISTS assistant_pending_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    user_role VARCHAR(32) NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    preview JSONB NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending_confirmation',
    idempotency_key VARCHAR(128),
    execution_result JSONB,
    failure_reason TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assistant_pending_actions_tenant_user 
    ON assistant_pending_actions (tenant_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_assistant_pending_actions_idempotency 
    ON assistant_pending_actions (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_assistant_pending_actions_expires 
    ON assistant_pending_actions (status, expires_at);
```

### 2.2 Immutable Audit Trail (`assistant_safe_action_audit`)
An append-only log capturing all state changes and execution results for regulatory and operational auditing.

```sql
CREATE TABLE IF NOT EXISTS assistant_safe_action_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pending_action_id UUID NOT NULL REFERENCES assistant_pending_actions(id),
    tenant_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    user_role VARCHAR(32) NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    target_entity_type VARCHAR(64) NOT NULL,
    target_entity_id VARCHAR(64) NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    idempotency_key VARCHAR(128),
    execution_status VARCHAR(32) NOT NULL,
    execution_result JSONB,
    failure_reason TEXT,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address VARCHAR(45),
    user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_assistant_audit_tenant_action 
    ON assistant_safe_action_audit (tenant_id, action_type, executed_at);
CREATE INDEX IF NOT EXISTS idx_assistant_audit_entity 
    ON assistant_safe_action_audit (tenant_id, target_entity_type, target_entity_id);
```

---

## 3. Compare-And-Swap (CAS) State Machine

Every action transitions through a deterministic state machine managed by atomic CAS updates in PostgreSQL.

```
       [ Proposal / Preview ]
                 │
                 ▼
     ┌────────────────────────┐
     │  pending_confirmation  │
     └───────────┬────────────┘
                 │
      ┌──────────┼──────────────────────┬──────────────────────┐
      │ (User confirms)                 │ (Explicit cancel)    │ (TTL > 300s)
      ▼                                 ▼                      ▼
┌───────────┐                     ┌───────────┐          ┌───────────┐
│ executing │ (Atomic CAS)        │ cancelled │          │  expired  │
└─────┬─────┘                     └───────────┘          └───────────┘
      │
      ├──────────────────────┐
      ▼                      ▼
┌───────────┐          ┌───────────┐
│ executed  │          │  failed   │
└───────────┘          └───────────┘
```

### State Machine Transition Rules
1. `pending_confirmation` ➔ `executing`:
   - Executed via atomic SQL `UPDATE ... WHERE status = 'pending_confirmation'`.
   - Prevents parallel execution if multiple confirmation requests arrive simultaneously.
2. `executing` ➔ `executed`:
   - Set when canonical domain service completes successfully.
   - Execution result JSON is persisted on the pending action record and recorded in the audit log.
3. `executing` ➔ `failed`:
   - Set if domain service throws an error or constraint violation.
   - Failure reason and stack trace are logged in the audit log.
4. `pending_confirmation` ➔ `cancelled`:
   - Occurs when user clicks "Cancelar" in the UI or cancels via conversation.
   - Sets reason: `"User explicitly cancelled action."`
5. `pending_confirmation` ➔ `expired`:
   - Automatically identified when `NOW() > expires_at` (300s TTL).
   - Rejects confirmation with HTTP 410 Gone.

---

## 4. Idempotency Architecture

### 4.1 Idempotency Key Handling
- **Header:** `Idempotency-Key: <client-generated-uuid>` (optional from frontend, autogenerated if omitted).
- **Lookup Protocol:**
  1. If `idempotency_key` is provided, query `assistant_pending_actions` for an existing record with matching `(tenant_id, idempotency_key)`.
  2. If found and status is `executed`, return the previously stored `execution_result` immediately with HTTP 200 and header `X-Idempotent-Replay: true`.
  3. If found and status is `executing`, return HTTP 409 Conflict with message `"Action execution in progress."`

### 4.2 Double-Click and Network Retry Defense
When a user clicks "Confirmar":
1. Frontend immediately disables both "Confirmar" and "Cancelar" buttons and shows a spinner.
2. If network flakiness causes a duplicate HTTP request:
   - Request 1 transitions `status` from `pending_confirmation` to `executing`.
   - Request 2 fails the CAS update (0 rows affected).
   - Request 2 queries the current record state:
     - If `executing`: returns 409 Conflict.
     - If `executed`: returns 200 OK with cached result.
   - Result: Exactly one domain execution occurs.

---

## 5. Domain Target Resolution & Audit Capture

Each of the 7 safe mutation tools maps to an exact entity type and ID in the audit record:

| Tool Name | `target_entity_type` | `target_entity_id` Extraction |
|---|---|---|
| `cancel_my_booking` | `booking` | `String(payload.bookingId)` |
| `check_in_pet` | `booking` | `String(payload.bookingId)` |
| `check_out_pet` | `booking` | `String(payload.bookingId)` |
| `complete_operational_task` | `operational_task` | `String(payload.taskId)` |
| `complete_feeding_task` | `feeding_log` | `String(payload.feedingId)` |
| `record_medication_administration` | `medication_administration` | `String(payload.prescriptionId)` |
| `complete_walk_task` | `walk_log` | `String(payload.walkId)` |

---

## 6. Audit Trail Compliance & Invariants

| Compliance Requirement | Implementation |
|---|---|
| **Immutable Records** | `assistant_safe_action_audit` does not expose `UPDATE` or `DELETE` endpoints. Database user grants should restrict permissions to `INSERT` and `SELECT`. |
| **Tamper Detection** | Cryptographic hash `payload_hash` in audit matches hash stored at preview generation. |
| **Actor Accountability** | Records `tenant_id`, `user_id`, `user_role`, client IP, and User-Agent. |
| **Non-Repudiation** | Proves user explicit confirmation occurred between preview timestamp and execution timestamp. |
