# ARKPET — R41.E SECURITY MODEL SPECIFICATION
## SAFE ACTIONS: IDENTITY-BOUND CAS, ANTI-ENUMERATION, RBAC TRUTH, SANITIZATION & DEFENSE-IN-DEPTH

**Phase:** R41.E — Safe Actions (Finalized & Hardened: R41.E-FINAL.1)  
**Program:** R41 — ArkPet Intelligent Assistant  
**Baseline Commit:** `ab539ae4504d8c18d192e0bd2416805789200f1f` (`R41_D_FINAL_SHA`)  
**Status:** Certified Architecture & Implemented  

---

## 1. Threat Model & Security Perimeter

The introduction of domain mutations via an AI assistant expands the attack surface from read-only data queries to potential unauthorized state manipulation, operational disruption, and cross-tenant data corruption.

ArkPet R41.E enforces a zero-trust model where **the LLM is treated as an untrusted client component**. The security perimeter rests exclusively on the API server's deterministic authentication, authorization, cryptographic hashing, and transaction engines.

```
+-----------------------------------------------------------------------------------+
|                              UNTRUSTED ZONE                                       |
|  User Natural Language / Voice Audio Input                                        |
|  LLM Prompt Interpretation & Intent Parsing                                       |
|  LLM Tool Call Proposals (Name + Parameters)                                      |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼ [POST /api/assistant/actions/preview]
+-----------------------------------------------------------------------------------+
|                         TRUSTED SECURITY PERIMETER                                |
|  1. Bearer Token & Session Validation (req.user)                                  |
|  2. Server-Enforced Canonical RBAC (master_admin, creche_admin, staff, tutor)     |
|  3. Narrow Tool Whitelist (Only 7 safe mutations permitted)                       |
|  4. Zod Schema Validation & Input Sanitization                                    |
|  5. Domain Resource Ownership & Tenant Isolation (creche_id filtering)            |
|  6. Ambiguous Target Rejection (400 ambiguous_target if multiple targets match)   |
|  7. Cryptographic Payload Integrity (SHA-256)                                     |
|  8. Expiring Pending Action Generation (TTL = 300s)                               |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼ [Explicit User Confirmation via UI / Voice]
+-----------------------------------------------------------------------------------+
|                    DETERMINISTIC EXECUTION PERIMETER                              |
|  9. Identity-Bound Atomic CAS Transition                                          |
|     (id = :id AND user_id = :userId AND creche_id = :crecheId                     |
|      AND role = :role AND expires_at > NOW() AND status = 'pending_confirmation') |
| 10. Anti-Enumeration Failure Lookup (Safe 404 for unknown/foreign IDs)            |
| 11. Stale Role Verification (Fail-closed 403 on stale authorization)              |
| 12. Cross-User Idempotency Shield (Cached results returned only to owner)         |
| 13. Canonical Shared Domain Services (BookingDomainService, TaskDomainService)    |
| 14. Immutable Sanitized Audit Trail (Zero credentials, zero stack traces)         |
| 15. Safe Error Sanitization (Generic client messages, internal logging only)     |
+-----------------------------------------------------------------------------------+
```

---

## 2. Threat Vector Mitigation Matrix

| Threat Vector | Description | R41.E Hardened Mitigation Strategy | Certified Status |
|---|---|---|---|
| **Prompt Injection / Jailbreak** | Attacker crafts a prompt to execute arbitrary mutations or bypass safeguards. | LLMs have **zero execution authority**. The model can only propose a preview token. Execution requires explicit HTTP confirmation with identity binding. | `LLM_IN_MUTATION_EXECUTION_PATH = NO` |
| **CAS State Poisoning (Blocker 1)** | Attacker knowing a valid `pendingActionId` confirms or transitions another user's action to `executing`. | **Identity-Bound CAS**: The atomic SQL update binds `id`, `user_id`, `creche_id`, `role`, and `expires_at > NOW()`. Foreign callers cannot mutate action state. | `CAS_ATOMIC_AUTHORIZATION_BOUND = YES`<br>`FOREIGN_PENDING_ACTION_STATE_MUTATION = 0` |
| **Pending Action ID Guessing** | Attacker guesses pending action IDs to enumerate data or read cached results. | Scoped failure lookup: If CAS affects 0 rows, queries strictly filter by `id AND user_id AND creche_id`. Guessed or foreign IDs return safe 404 without leaking metadata. | `PENDING_ACTION_ID_ENUMERATION = 0`<br>`CROSS_USER_IDEMPOTENT_RESULT_LEAK = 0` |
| **Stale Authorization Escalation** | User's role changes after preview (e.g., demoted from staff to tutor) before confirmation. | Identity-bound CAS fails. Subsequent inspection detects role mismatch and throws 403 (`stale_authorization`) without executing or changing action state. | `STALE_AUTHORIZATION_MUTATION = 0` |
| **Domain Logic Duplication (Blocker 2)** | Assistant implements separate state logic differing from normal application routes. | Both REST routes and assistant delegate to shared `BookingDomainService` and `TaskDomainService`. | `ASSISTANT_DUPLICATE_MUTATION_BUSINESS_RULES = 0`<br>`BOOKING_MUTATION_CANONICAL_SERVICE_REUSE = YES` |
| **Error Message Secret Leak (Blocker 3)** | Internal database connection strings or stack traces leaked to client on errors. | `sendSafeError` sanitizes responses, returning generic `"Ocorreu um erro interno ao processar a ação."` with `requestId`. Strips PostgreSQL URIs and tokens. | `RAW_SAFE_ACTION_ERROR_TO_CLIENT = 0` |
| **Audit Credential Exfiltration** | Sensitive database URIs, JWTs, or stack traces logged in audit table. | `sanitizeAuditString` regex-redacts DB connection strings (`/postgres(ql)?:\/\/[^\s]+/gi`) and bearer tokens. Audit stores zero stack traces. | `AUDIT_SECRET_LEAK = 0`<br>`AUDIT_STACK_TRACE_STORAGE = 0` |
| **Ambiguous Target Mutation** | Assistant executes mutation against wrong pet when multiple pets have pending tasks. | `buildDomainPreview` rejects ambiguous feeding, walk, or medication targets across tenant or pet with 400 (`ambiguous_target`). | `R41E-FINAL1-TARGET-001..003 = PASS` |
| **Destructive / Delete Actions** | Attacker attempts to delete pets, bookings, or operational records. | Zero deletion tools in assistant registry (`AI_DELETE_TOOL_COUNT = 0`). Hardcoded deterministic refusal guards. | `AI_DELETE_TOOL_COUNT = 0` |
| **Financial State Manipulation** | Attacker attempts to modify prices, waive fees, or alter invoice balances. | Zero financial mutation tools (`AI_FINANCIAL_MUTATION_TOOL_COUNT = 0`). Safe cancellation enforces invoice paid item guard (422). | `AI_FINANCIAL_MUTATION_TOOL_COUNT = 0` |
| **Medication Dosage Tampering** | Attacker or model modifies dosage during administration. | Dosage strictly bound to validated veterinary prescription record (`MODEL_OVERRIDES_MEDICATION_DOSAGE = 0`). | `MODEL_OVERRIDES_MEDICATION_DOSAGE = 0` |

---

## 3. Server-Enforced Canonical RBAC Matrix

Authorization rules are strictly enforced server-side using the authenticated caller's verified identity (`req.user`). The runtime roles recognized by ArkPet are strictly:
1. `master_admin`
2. `creche_admin`
3. `staff`
4. `tutor`

```text
CANONICAL_ROLE_COUNT = 4
DOCUMENTED_NONEXISTENT_ROLES = 0
DOCUMENTED_ROLE_MODEL_MATCHES_SOURCE = YES
```

Fictitious roles (`owner`, `client`, `receptionist`, `admin`, `caretaker`, `veterinarian`, `vet_tech`) are strictly prohibited.

| Safe Mutation Tool | Allowed Canonical Roles | Ownership & Context Constraints | Risk Level |
|---|---|---|---|
| `cancel_my_booking` | `["tutor"]` | Booking `tutorId === context.userId` and `crecheId === context.crecheId`. Status must be `pending` or `confirmed`. Paid invoice items guard (`paidItems.length === 0`). | `medium` |
| `check_in_pet` | `["staff", "creche_admin"]` | Pet exists in creche. Confirmed booking for today exists in creche. Transitions booking to `active` (isCheckedIn = true). | `medium` |
| `check_out_pet` | `["staff", "creche_admin"]` | Pet exists in creche. Booking is active in creche. Transitions booking to `completed` (isCheckedIn = false). Settles consumables. | `medium` |
| `complete_operational_task` | `["staff", "creche_admin"]` | Task belongs to creche, status is `pending`. | `low` |
| `complete_feeding_task` | `["staff", "creche_admin"]` | Task belongs to creche, status is `pending`. Pet must have single unambiguous pending feeding task. | `low` |
| `record_medication_administration` | `["staff", "creche_admin"]` | Task belongs to creche, pet checked in, status `pending`. Single unambiguous medication task. Exact dosage preserved. | `high` |
| `complete_walk_task` | `["staff", "creche_admin"]` | Task belongs to creche, pet checked in, status `pending`. Single unambiguous walk task. | `low` |

---

## 4. Two-Phase Cryptographic Handshake & CAS Execution

```
Client / Assistant UI                        API Server                                PostgreSQL
        │                                        │                                         │
        │─── 1. POST /actions/preview ──────────>│                                         │
        │    (actionType, payload)               │─── 2. Auth & Canonical RBAC Check ─────>│
        │                                        │─── 3. Domain Prerequisite Check ───────>│
        │                                        │─── 4. Ambiguous Target Check ──────────>│
        │                                        │─── 5. Compute SHA-256 Payload Hash ────>│
        │                                        │─── 6. INSERT pending_confirmation ─────>│
        │                                        │       (TTL = 300s)                      │
        │<── 7. Preview Response ────────────────│                                         │
        │    (pa_id, preview, hash, expiresAt)   │                                         │
        │                                        │                                         │
        ▼ [Explicit User Confirmation]           │                                         │
        │                                        │                                         │
        │─── 8. POST /actions/:id/confirm ──────>│                                         │
        │                                        │─── 9. Identity-Bound Atomic CAS Lock ──>│
        │                                        │       UPDATE assistant_pending_actions  │
        │                                        │       SET status = 'executing'          │
        │                                        │       WHERE id = :id AND user_id = :uid │
        │                                        │         AND creche_id = :cid            │
        │                                        │         AND role = :role                │
        │                                        │         AND expires_at > NOW()          │
        │                                        │         AND status = 'pending_...'      │
        │                                        │<── 10. Exactly 1 row returned? ─────────│
        │                                        │                                         │
        │                                        │─── 11. Canonical Domain Execution ─────>│
        │                                        │        (BookingDomain / TaskDomain)     │
        │                                        │─── 12. INSERT Audit Record ────────────>│
        │                                        │        (Sanitized, zero stack traces)   │
        │                                        │─── 13. UPDATE status = 'executed' ─────>│
        │<── 14. Safe Executed Result ───────────│                                         │
```

---

## 5. Security Invariant Certification Summary

```text
MUTATION_WITHOUT_CONFIRMATION = 0
LLM_IN_MUTATION_EXECUTION_PATH = NO
CAS_ATOMIC_AUTHORIZATION_BOUND = YES
FOREIGN_PENDING_ACTION_STATE_MUTATION = 0
PENDING_ACTION_ID_ENUMERATION = 0
CROSS_USER_IDEMPOTENT_RESULT_LEAK = 0
STALE_AUTHORIZATION_MUTATION = 0
RAW_SAFE_ACTION_ERROR_TO_CLIENT = 0
AUDIT_SECRET_LEAK = 0
AUDIT_STACK_TRACE_STORAGE = 0
APPLICATION_APPEND_ONLY_AUDIT = YES
DATABASE_ENFORCED_AUDIT_IMMUTABILITY = NOT_PROVEN
GENERAL_DB_ACCESS_TOOL = 0
GENERIC_MUTATION_TOOL = 0
AI_DELETE_TOOL_COUNT = 0
AI_FINANCIAL_MUTATION_TOOL_COUNT = 0
STANDALONE_BATH_ACTION_TOOL = 0
MODEL_OVERRIDES_MEDICATION_DOSAGE = 0
```
