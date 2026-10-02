# ARKPET — R41.E SECURITY MODEL SPECIFICATION
## SAFE ACTIONS: RBAC, TWO-PHASE PROTOCOL, TOKEN INTEGRITY & DEFENSE-IN-DEPTH

**Phase:** R41.E — Safe Actions  
**Program:** R41 — ArkPet Intelligent Assistant  
**Baseline Commit:** `ab539ae4504d8c18d192e0bd2416805789200f1f` (`R41_D_FINAL_SHA`)  
**Status:** Certified Architecture & Implemented  

---

## 1. Threat Model & Security Perimeter

The introduction of domain mutations via an AI assistant interface expands the attack surface from read-only data exfiltration to potential unauthorized state manipulation, operational disruption, and data corruption. 

The ArkPet R41.E security architecture enforces a zero-trust model where **the LLM is treated as an untrusted client component**. The security perimeter rests exclusively on the API server's deterministic authentication, authorization, cryptographic hashing, and transaction engines.

```
+-----------------------------------------------------------------------------------+
|                              UNTRUSTED ZONE                                       |
|  User Natural Language / Voice Audio Input                                        |
|  LLM Prompt Interpretation & Intent Parsing                                       |
|  LLM Function Call Arguments (Proposal)                                           |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼ [REST /api/assistant/actions/preview]
+-----------------------------------------------------------------------------------+
|                         TRUSTED SECURITY PERIMETER                                |
|  1. Bearer Token & Session Validation (req.user)                                  |
|  2. Server-Enforced RBAC & Tenant Isolation (tenant_id binding)                   |
|  3. Narrow Tool Whitelist (Only 7 safe mutations permitted)                       |
|  4. Zod Schema Validation & Input Sanitization                                    |
|  5. Domain Resource Ownership & State Verification                                |
|  6. Cryptographic Payload Integrity (SHA-256)                                     |
|  7. Expiring Pending Action Token Generation (TTL = 300s)                         |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼ [Explicit User Confirmation]
+-----------------------------------------------------------------------------------+
|                    DETERMINISTIC EXECUTION PERIMETER                              |
|  8. Action ID & User/Tenant Binding Verification                                  |
|  9. Payload Integrity Hash Matching (Anti-Tampering)                              |
| 10. Atomic CAS State Transition (pending_confirmation -> executing)               |
| 11. Concurrency & Idempotency Key Lock (Anti-Replay)                              |
| 12. Row-Level Domain Locking & State Revalidation                                 |
| 13. Canonical Domain Service Invocation (ZERO LLM INVOLVEMENT)                    |
| 14. Immutable Audit Trail Persistence (assistant_safe_action_audit)               |
+-----------------------------------------------------------------------------------+
```

---

## 2. Threat Vector Mitigation Matrix

| Threat Vector | Description | R41.E Mitigation Strategy | Architectural Verification |
|---|---|---|---|
| **Prompt Injection / Jailbreak** | Attacker crafts a prompt to execute arbitrary mutations or bypass safeguards. | LLMs have **zero execution authority**. The model can only propose a preview token. Even if hijacked, the model cannot execute mutations. | `LLM_IN_MUTATION_EXECUTION_PATH = NO` |
| **Role & Privilege Escalation** | Client/Owner attempts to execute caretaker or receptionist actions (e.g. check-in, medication). | RBAC is enforced purely in server-side TypeScript code against `req.user.role`. LLM cannot elevate user roles or bypass RBAC checks. | 403 Forbidden on unauthorized roles |
| **Cross-Tenant Data Tampering** | Attacker references an entity ID belonging to another tenant/organization. | Every entity lookup strictly filters by `eq(table.tenantId, tenantId)`. Cross-tenant references yield 404/403 errors. | Tenant boundary enforced in SQL |
| **Ownership Spoofing** | Pet owner attempts to cancel another owner's booking. | Ownership validation checks `booking.ownerId === req.user.id`. Receptionists/Admins may cancel within policy, but owners cannot cancel others' bookings. | Server-side ownership match check |
| **Parameter Tampering** | Attacker tampers with the action payload between preview generation and confirmation. | SHA-256 cryptographic hash of canonical payload is stored at preview time and re-verified on confirmation. Any mismatch triggers `TAMPERED_ACTION`. | Hash verification before execution |
| **Replay & Double-Click Attacks** | Rapid repeated clicks or network retries causing double-mutations (e.g., double task completion). | Atomic CAS state transition (`pending_confirmation` -> `executing`) and idempotency key registry prevent duplicate runs. | HTTP 409 Conflict / Cached outcome |
| **Stale State Execution** | Action confirmed minutes later after operational conditions have changed (e.g., booking already cancelled). | 5-minute strict TTL (300 seconds), plus domain row-lock revalidation before mutation. | Action marked `expired`; domain state rechecked |
| **Destructive Mutation Prohibitions** | Attacker requests deletion of records, database wipes, or arbitrary SQL execution. | Prohibited tools list: `AI_DELETE_TOOL_COUNT = 0`, `GENERAL_DB_ACCESS_TOOL = 0`. Refusal guards reject destructive keywords. | Deterministic refusal guard |
| **Financial State Manipulation** | Attacker attempts to apply discounts, waive invoices, or process refunds. | `AI_FINANCIAL_MUTATION_TOOL_COUNT = 0`. System prompt, registry, and service reject financial writes. | Direct refusal with administrative guidance |

---

## 3. Server-Enforced RBAC Matrix

Authorization rules are strictly enforced by `assistant-safe-action.service.ts` using the authenticated caller's identity (`req.user`). The LLM cannot override, suppress, or modify these checks.

| Safe Mutation Tool | Minimum Allowed Roles | Ownership / Context Constraint | Risk Level |
|---|---|---|---|
| `cancel_my_booking` | `owner`, `client`, `receptionist`, `admin` | For `owner`/`client`: `booking.ownerId === user.id`. For `receptionist`/`admin`: within tenant. | `medium` |
| `check_in_pet` | `receptionist`, `admin` | Booking must be `confirmed`, within tenant, matching target date. | `low` |
| `check_out_pet` | `receptionist`, `admin` | Booking must be `checked_in`, within tenant. | `low` |
| `complete_operational_task` | `caretaker`, `staff`, `receptionist`, `admin` | Task must belong to tenant and be in `pending` or `in_progress` state. | `low` |
| `complete_feeding_task` | `caretaker`, `staff`, `admin` | Feeding log/schedule must belong to tenant, pet must be checked in. | `low` |
| `record_medication_administration` | `veterinarian`, `vet_tech`, `admin` | Prescription must exist, pet checked in, dosage **strictly from prescription**. | `high` |
| `complete_walk_task` | `caretaker`, `staff`, `admin` | Walk log/task must belong to tenant, pet checked in. | `low` |

### Role Hierarchy Enforcement Rules
1. **Owners & Clients:** Exclusively limited to their own bookings (`cancel_my_booking`). Any attempt to invoke operational, feeding, medication, or intake tools returns `403 Forbidden` (`FORBIDDEN_ACTION_FOR_ROLE`).
2. **Caretakers & Operational Staff:** Limited to operational tasks (`complete_operational_task`, `complete_feeding_task`, `complete_walk_task`). Prohibited from administering medication without veterinary credentials or checking in/out pets.
3. **Veterinarians:** Authorized for `record_medication_administration` and operational tasks. May not cancel client bookings without administrative role.
4. **Receptionists & Admins:** Authorized for client intake/discharge (`check_in_pet`, `check_out_pet`), operational booking adjustments, and administrative overrides.

---

## 4. Two-Phase Cryptographic Handshake

The two-phase protocol prevents premature or unauthorized state modifications by enforcing an explicit preview handshake with cryptographic integrity.

```
Client / Assistant                       API Server                          Database
       │                                     │                                  │
       │─── 1. POST /actions/preview ───────>│                                  │
       │    (actionType, payload)            │─── 2. Auth & RBAC Check ────────>│
       │                                     │─── 3. Domain Prereq Check ──────>│
       │                                     │─── 4. Compute SHA-256 Hash ─────>│
       │                                     │─── 5. Insert Pending Action ────>│
       │<── 6. 200 OK (id, preview, hash) ───│       (status: 'pending',        │
       │       [Renders Confirmation UI]     │        ttl: 300s)                │
       │                                     │                                  │
  [User Reviews Details & Clicks 'Confirm']  │                                  │
       │                                     │                                  │
       │─── 7. POST /actions/:id/confirm ───>│                                  │
       │    (headers: Idempotency-Key)       │─── 8. Validate User & Tenant ───>│
       │                                     │─── 9. Check Expiration (TTL) ───>│
       │                                     │─── 10. Verify SHA-256 Hash ─────>│
       │                                     │─── 11. Atomic CAS Transition ───>│
       │                                     │        ('pending' -> 'executing')│
       │                                     │─── 12. Run Domain Service ──────>│
       │                                     │─── 13. Write Audit Log ─────────>│
       │                                     │─── 14. Update Status 'executed' ─>│
       │<── 15. 200 OK (result, auditId) ────│                                  │
```

### Cryptographic Hash Construction
```typescript
function calculatePayloadHash(actionType: string, payload: Record<string, unknown>): string {
  const sortedPayload = Object.keys(payload)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = payload[key];
      return acc;
    }, {});
  return createHash("sha256")
    .update(`${actionType}:${JSON.stringify(sortedPayload)}`)
    .digest("hex");
}
```

If an adversary intercepts the confirmation request and modifies any payload parameter, the re-computed hash diverges from the stored hash, immediately terminating execution with HTTP 400 (`TAMPERED_ACTION`).

---

## 5. Defense-in-Depth & Anti-Tampering Protections

1. **Atomic CAS Locking:**
   To eliminate race conditions, the execution transition is an atomic SQL query:
   ```sql
   UPDATE assistant_pending_actions
   SET status = 'executing', updated_at = NOW()
   WHERE id = :id 
     AND tenant_id = :tenantId 
     AND user_id = :userId 
     AND status = 'pending_confirmation'
   RETURNING id;
   ```
   If zero rows are updated, the request is either already executing, already completed, expired, or cancelled, preventing double execution.

2. **Idempotency Key Cache:**
   Clients send a unique `Idempotency-Key` header with confirmation calls. If a network retry occurs for a completed action, the cached JSON execution response is returned with HTTP 200, guaranteeing idempotent behavior without second mutations.

3. **Time-To-Live (TTL) Eviction:**
   Pending actions are valid for exactly 300 seconds (5 minutes). After expiration, any confirmation attempt returns HTTP 410 (`ACTION_EXPIRED`) and marks the record `expired`.

4. **Kill Switches:**
   - `AI_SAFE_ACTIONS_ENABLED=false`: Completely halts the actions router (`/api/assistant/actions/*`). Read-only guidance remains available.
   - `AI_ASSISTANT_KILL_SWITCH=true`: Globally disables all assistant endpoints.
