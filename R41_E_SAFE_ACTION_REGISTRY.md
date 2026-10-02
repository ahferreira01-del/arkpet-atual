# ARKPET — R41.E SAFE ACTION REGISTRY SPECIFICATION
## CANONICAL MUTATION ACTIONS, SCHEMAS, ROLE RBAC & PROHIBITED ACTIONS

**Phase:** R41.E — Safe Actions  
**Program:** R41 — ArkPet Intelligent Assistant  
**Status:** Certified & Implemented  

---

## 1. Registry Architecture Overview

Every mutation capable of being proposed by the ArkPet Intelligent Assistant must be explicitly registered in `SAFE_ACTION_REGISTRY` in `artifacts/api-server/src/assistant/assistant-safe-action.registry.ts`.

Generic CRUD tools, generic table mutators, HTTP dispatchers, and eval executors are prohibited:
```
GENERAL_DB_ACCESS_TOOL = 0
GENERIC_MUTATION_TOOL = 0
MODEL_GENERATED_SQL_EXECUTION = 0
MODEL_GENERATED_CODE_EXECUTION = 0
```

---

## 2. Canonical Safe Mutations Inventory (Exactly 7 Tools)

### 2.1. `cancel_my_booking`
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
- **Domain Verification:** Revalidates booking ownership (`tutorId === context.userId`), tenant isolation (`crecheId === context.crecheId`), status in `["pending", "confirmed"]`, and paid invoice items check (`paidItems.length === 0`).
- **Domain Side Effects:** Updates booking status to `cancelled`, restores package credits via `restoreBookingPackageCredits`, releases marketing campaign reservations via `CrecheCampaignReservationService.releaseBookingCampaigns`, logs financial audit.

---

### 2.2. `check_in_pet`
- **Description:** Staff or creche admin marks a pet as checked-in for today's active booking.
- **Mode:** `mutation`
- **Allowed Roles:** `["staff", "creche_admin"]`
- **Target Entity:** `pet`
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
- **Domain Verification:** Pet exists in creche, status is active, eligible booking for today exists in status `confirmed`.
- **Domain Side Effects:** Updates booking status to `checked_in`, sets checkInTime to `NOW()`.

---

### 2.3. `check_out_pet`
- **Description:** Staff or creche admin marks a pet as checked-out.
- **Mode:** `mutation`
- **Allowed Roles:** `["staff", "creche_admin"]`
- **Target Entity:** `pet`
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
- **Domain Verification:** Pet exists in creche, active booking is currently `checked_in`.
- **Domain Side Effects:** Updates booking status to `checked_out`, sets checkOutTime to `NOW()`.

---

### 2.4. `complete_feeding_task`
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
- **Domain Verification:** Task exists in creche with type `feeding` and status `pending`.
- **Domain Side Effects:** Updates task status to `completed`, records `completedAt: NOW()`.

---

### 2.5. `record_medication_administration`
- **Description:** Records administration of a doctor-prescribed medication task.
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
    medicationId: z.number().int().positive().optional(),
    dosageGiven: z.string().max(200).optional(),
    notes: z.string().max(500).optional(),
  })
  ```
- **Domain Safety Rule:** Medical dosage and frequency are loaded strictly from the system prescription/task record. The model and assistant cannot override dosage (`MODEL_OVERRIDES_MEDICATION_DOSAGE = 0`).
- **Domain Side Effects:** Updates task status to `completed`, stores administration timestamp.

---

### 2.6. `complete_walk_task`
- **Description:** Records completion of a scheduled pet walk.
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
    durationMinutes: z.number().int().positive().optional(),
    notes: z.string().max(500).optional(),
  })
  ```
- **Domain Verification:** Task exists in creche with type `walk` and status `pending`.
- **Domain Side Effects:** Updates task status to `completed`, stores duration and notes.

---

### 2.7. `complete_operational_task`
- **Description:** Marks a general operational task (cleaning, maintenance) as completed.
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
- **Domain Verification:** Task exists in creche, belongs to safe category (`operational`), status is `pending`.
- **Domain Side Effects:** Updates task status to `completed`.

---

## 3. Prohibited Actions & Strict Exclusions

The following tools and actions are **explicitly prohibited** and mathematically verified absent:

| Prohibited Category | Metric | Architecture Enforcement |
|---|---|---|
| Standalone Bath Action | `STANDALONE_BATH_ACTION_TOOL = 0` | Banho is not an isolated module; add-on inside booking only |
| Entity Deletions | `AI_DELETE_TOOL_COUNT = 0` | Assistant cannot delete database records |
| Financial Mutations | `AI_FINANCIAL_MUTATION_TOOL_COUNT = 0` | Charges, invoices, Stripe, and refunds are forbidden |
| Medical Dosage Override | `MODEL_OVERRIDES_MEDICATION_DOSAGE = 0` | Dosages loaded strictly from canonical medical records |
| Raw Database Access | `GENERAL_DB_ACCESS_TOOL = 0` | No raw queries or dynamic table manipulation |
| Arbitrary Tool Invocation| `UNREGISTERED_TOOL_EXECUTION = 0` | Only registered tools can execute |

---

## 4. Total Tool Registry Scorecard

```
Certified Read-Only Tools (R41.D):  8
Certified Mutation Tools (R41.E):   7
Total Registered Assistant Tools:  15
```
