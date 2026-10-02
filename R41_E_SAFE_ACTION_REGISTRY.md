# ARKPET — R41.E SAFE ACTION REGISTRY SPECIFICATION
## CANONICAL MUTATION ACTIONS, SCHEMAS, ROLE RBAC & PROHIBITED ACTIONS

**Phase:** R41.E — Safe Actions (Finalized: R41.E-FINAL.2)  
**Program:** R41 — ArkPet Intelligent Assistant  
**Lineage & SHA Tracking:**
- `R41_D_FINAL_SHA`: `ab539ae4504d8c18d192e0bd2416805789200f1f`
- `R41_E_IMPLEMENTATION_SHA`: `55d228e41921302c794a35b4545d5af2efb8f255`
- `R41_E_FINAL1_HARDENING_SHA`: `9dc6583e16ac6e08e44224db5100c61b545f0126`
- `R41_E_FINAL1_CLOSURE_HEAD_SHA`: `9e0f689e7851b3d5fef0f13e42bad7648ae581c7`
- `R41_E_FINAL_SHA`: Forward commit HEAD (FINAL.2 Closure)  
**Status:** Certified & Implemented  

---

## 1. Registry Architecture Overview

Every mutation capable of being proposed by the ArkPet Intelligent Assistant must be explicitly registered in `SAFE_ACTION_REGISTRY` in `artifacts/api-server/src/assistant/assistant-safe-action.registry.ts`.

Generic CRUD tools, generic table mutators, HTTP dispatchers, and eval executors are prohibited:
```text
GENERAL_DB_ACCESS_TOOL = 0
GENERIC_MUTATION_TOOL = 0
AI_DELETE_TOOL_COUNT = 0
AI_FINANCIAL_MUTATION_TOOL_COUNT = 0
STANDALONE_BATH_ACTION_TOOL = 0
MODEL_GENERATED_SQL_EXECUTION = 0
MODEL_GENERATED_CODE_EXECUTION = 0
```

---

## 2. Canonical ArkPet Roles

The runtime roles recognized by the ArkPet application are strictly:
1. `master_admin` — Platform administrator
2. `creche_admin` — Daycare manager/owner administrator
3. `staff` — Daycare operational employee
4. `tutor` — Pet tutor / owner

```text
CANONICAL_ROLE_COUNT = 4
DOCUMENTED_NONEXISTENT_ROLES = 0
DOCUMENTED_ROLE_MODEL_MATCHES_SOURCE = YES
```

No other runtime roles exist in ArkPet source code. Fictitious roles such as `owner`, `client`, `receptionist`, `admin`, `caretaker`, `veterinarian`, or `vet_tech` are strictly non-existent and prohibited from runtime evaluation and documentation.

---

## 3. Tool Inventory Split (15 Tools Total)

```text
R41_E_READ_ONLY_TOOL_COUNT = 8
R41_E_MUTATION_TOOL_COUNT = 7
R41_E_TOTAL_TOOL_COUNT = 15
```

### 3.1. Certified Read-Only Tools (8)
Preserved from R41.D with zero regression:
1. `get_onboarding_status`: Retrieves daycare onboarding progress and required setup steps.
2. `get_current_user_context`: Retrieves authenticated user ID, tenant ID, and active canonical role.
3. `get_current_screen_context`: Returns current frontend route and screen metadata.
4. `search_arkpet_knowledge`: Retrieves domain knowledge base articles and operational FAQs.
5. `list_my_pets`: Returns active pets belonging to the authenticated tutor.
6. `list_my_bookings`: Returns booking history and upcoming reservations for tutor.
7. `get_guided_onboarding_plan`: Generates step-by-step guidance plan for daycare configuration.
8. `get_contextual_product_guide`: Returns role-relevant contextual deep-links and operational advice.

---

## 4. Canonical Safe Mutations Inventory (Exactly 7 Tools)

### 4.1. `cancel_my_booking`
- **Description:** Tutor cancels their own eligible confirmed or pending booking.
- **Mode:** `mutation`
- **Allowed Roles:** `["tutor"]`
- **Target Entity:** `booking`
- **Risk Level:** `medium`
- **Confirmation Required:** `true`
- **Input Schema:**
  ```ts
  z.object({
    bookingId: z.number().int().positive("ID da reserva deve ser um inteiro positivo"),
    reason: z.string().max(500, "Motivo deve ter no máximo 500 caracteres").optional(),
  })
  ```
- **Domain Verification:** Revalidates booking ownership (`tutorId === context.userId`), tenant isolation (`crecheId === context.crecheId`), status in `["pending", "confirmed"]`, state machine invariant check (active and completed bookings cannot be cancelled, returning 400), and paid invoice items check (`paidItems.length === 0`, returning 422).
- **Domain Side Effects (via `BookingDomainService.cancelBooking`):**
  - Restores package credits via `restoreBookingPackageCredits`;
  - Restores service credits via `restoreBookingServiceCredits`;
  - Cancels add-ons and restores credits via `cancelBookingAddonsAndRestoreCredits`;
  - Logs financial audit log `credits_deduct` where credits are returned;
  - Releases marketing campaign reservations via `CrecheCampaignReservationService.releaseBookingCampaigns`;
  - Updates booking status to `cancelled`;
  - Sends tutor push notification via `NotificationService.sendTutorBookingNotification`.

---

### 4.2. `check_in_pet`
- **Description:** Staff or creche admin marks a pet as checked-in for today's confirmed booking.
- **Mode:** `mutation`
- **Allowed Roles:** `["staff", "creche_admin"]`
- **Target Entity:** `booking`
- **Risk Level:** `medium`
- **Confirmation Required:** `true`
- **Input Schema:**
  ```ts
  z.object({
    petId: z.number().int().positive("ID do pet deve ser um inteiro positivo"),
    bookingId: z.number().int().positive("ID da reserva deve ser um inteiro positivo").optional(),
    notes: z.string().max(500).optional(),
  })
  ```
- **Domain Verification:** Pet exists in creche, eligible booking for today exists in status `confirmed`.
- **Domain Side Effects (via `BookingDomainService.checkInBooking`):**
  - Updates booking status to `active` (ArkPet semantic check-in);
  - Sets `isCheckedIn = true`;
  - Sets `checkInTime = NOW()`;
  - Creates pet log entry;
  - Updates tenant occupancy count safely.

---

### 4.3. `check_out_pet`
- **Description:** Staff or creche admin marks a pet as checked-out from today's active booking.
- **Mode:** `mutation`
- **Allowed Roles:** `["staff", "creche_admin"]`
- **Target Entity:** `booking`
- **Risk Level:** `medium`
- **Confirmation Required:** `true`
- **Input Schema:**
  ```ts
  z.object({
    petId: z.number().int().positive("ID do pet deve ser um inteiro positivo"),
    bookingId: z.number().int().positive("ID da reserva deve ser um inteiro positivo").optional(),
    notes: z.string().max(500).optional(),
  })
  ```
- **Domain Verification:** Pet exists in creche, booking is currently `active` and `isCheckedIn = true`.
- **Domain Side Effects (via `BookingDomainService.checkOutBooking`):**
  - Updates booking status to `completed`;
  - Sets `isCheckedIn = false`;
  - Sets `checkOutTime = NOW()`;
  - Computes and settles consumable charges;
  - Creates pet log entry.

---

### 4.4. `complete_operational_task`
- **Description:** Records completion of a routine operational/daycare task.
- **Mode:** `mutation`
- **Allowed Roles:** `["staff", "creche_admin"]`
- **Target Entity:** `task`
- **Risk Level:** `low`
- **Confirmation Required:** `true`
- **Input Schema:**
  ```ts
  z.object({
    taskId: z.number().int().positive("ID da tarefa deve ser um inteiro positivo"),
    notes: z.string().max(500).optional(),
  })
  ```
- **Domain Verification:** Task exists in creche, belongs to creche, status is `pending`.
- **Domain Side Effects (via `TaskDomainService.completeTask`):**
  - Acquires tenant-level operational lock;
  - Executes atomic CAS `status = 'pending' -> 'completed'`;
  - Sets `completedBy = actorId`, `completedAt = NOW()`;
  - Idempotent replay: returns `isNewCompletion: false` if already completed.

---

### 4.5. `complete_feeding_task`
- **Description:** Records completion of a scheduled pet feeding task.
- **Mode:** `mutation`
- **Allowed Roles:** `["staff", "creche_admin"]`
- **Target Entity:** `task`
- **Risk Level:** `low`
- **Confirmation Required:** `true`
- **Input Schema:**
  ```ts
  z.object({
    taskId: z.number().int().positive().optional(),
    petId: z.number().int().positive().optional(),
    notes: z.string().max(500).optional(),
  })
  ```
- **Domain Verification:** Resolves single unambiguous feeding task for pet in `pending` state. Fails closed with 400 (`ambiguous_target`) if multiple matching tasks exist.
- **Domain Side Effects (via `TaskDomainService.completeTask`):**
  - Atomic CAS `status = 'pending' -> 'completed'`;
  - Sets `completedBy = actorId`, `completedAt = NOW()`.

---

### 4.6. `record_medication_administration`
- **Description:** Records administration of a veterinary prescribed medication to a pet.
- **Mode:** `mutation`
- **Allowed Roles:** `["staff", "creche_admin"]`
- **Target Entity:** `task`
- **Risk Level:** `high`
- **Confirmation Required:** `true`
- **Input Schema:**
  ```ts
  z.object({
    taskId: z.number().int().positive().optional(),
    petId: z.number().int().positive().optional(),
    medicationName: z.string().min(1).max(100).optional(),
    dosageGiven: z.string().max(100).optional(),
    notes: z.string().max(500).optional(),
  })
  ```
- **Domain Verification:** Pet is checked in. Resolves exact medication task. Fails closed with 400 (`ambiguous_target`) if multiple pending medications match without explicit taskId (`BROAD_MEDICATION_UPDATE = 0`). Prescribed dosage cannot be modified by model (`MODEL_OVERRIDES_MEDICATION_DOSAGE = 0`).
- **Domain Side Effects (via `TaskDomainService.recordMedicationAdministration`):**
  - Atomic CAS `status = 'pending' -> 'completed'`;
  - Appends administration record with exact dosage, administered time, and notes.

---

### 4.7. `complete_walk_task`
- **Description:** Records completion of an exercise or dog walking task.
- **Mode:** `mutation`
- **Allowed Roles:** `["staff", "creche_admin"]`
- **Target Entity:** `task`
- **Risk Level:** `low`
- **Confirmation Required:** `true`
- **Input Schema:**
  ```ts
  z.object({
    taskId: z.number().int().positive().optional(),
    petId: z.number().int().positive().optional(),
    notes: z.string().max(500).optional(),
  })
  ```
- **Domain Verification:** Pet checked in. Resolves single unambiguous walk task in `pending` status. Fails closed with 400 (`ambiguous_target`) if multiple pending walks match.
- **Domain Side Effects (via `TaskDomainService.completeTask`):**
  - Atomic CAS `status = 'pending' -> 'completed'`;
  - Sets `completedBy = actorId`, `completedAt = NOW()`.

---

## 5. Prohibited Actions & Invariant Guarantees

| Prohibited Category | Enforcement Mechanism | Failure Code |
|---|---|---|
| Direct SQL Execution | No DB execution tools registered (`GENERAL_DB_ACCESS_TOOL = 0`) | Deterministic Block |
| Generic Mutations | No untyped mutation tools (`GENERIC_MUTATION_TOOL = 0`) | Tool Not Found |
| Deletions | Zero delete tools registered (`AI_DELETE_TOOL_COUNT = 0`) | Deterministic Block |
| Financial Writes | Invoices/billing mutations blocked (`AI_FINANCIAL_MUTATION_TOOL_COUNT = 0`) | Tool Not Found |
| Standalone Bath | Bath only available via service booking add-ons (`STANDALONE_BATH_ACTION_TOOL = 0`) | Guided Redirection |
| Unconfirmed Mutations | Two-phase handshake strictly required (`MUTATION_WITHOUT_CONFIRMATION = 0`) | 400 bad_request |
| Dosage Modification | Prescriptions strictly immutable to assistant (`MODEL_OVERRIDES_MEDICATION_DOSAGE = 0`) | 400 invalid_dosage |
| Foreign Pending Action Mutation | Identity-Bound CAS condition (`FOREIGN_PENDING_ACTION_STATE_MUTATION = 0`) | 404 not_found |
