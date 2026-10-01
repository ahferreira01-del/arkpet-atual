# ARKPET — R41.A TOOL REGISTRY SPECIFICATION
## READ-ONLY CAPABILITY CONTRACTS & EXECUTION SANDBOX

**Program:** R41 — ArkPet Intelligent Assistant  
**Phase:** R41.A — Assistant Foundation  
**Release Base SHA:** `58b4ff0e5cabd958d0f601af202378900427caab`  

---

## 1. REGISTRY DESIGN & CONTRACTS

Every tool registered in `AssistantToolsRegistry` implements the following standard interface:

```typescript
export interface AssistantToolDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  allowedRoles: Array<"master_admin" | "creche_admin" | "staff" | "tutor">;
  inputSchema: z.ZodType<TInput>;
  confirmationRequired: boolean;
  auditEvent: string;
  execute: (input: TInput, context: AssistantSecurityContext) => Promise<TOutput>;
}
```

### Invariants:
1. **Zero Generic Database Tools (`GENERAL_DB_ACCESS_TOOL = 0`)**: No `executeSQL`, `queryDatabase`, or generic mutations.
2. **Whitelist Only (`UNREGISTERED_TOOL_EXECUTION = 0`)**: Unknown tools throw immediately before execution.
3. **No Mutations in R41.A**: All tools are strictly read-only inspection tools.
4. **No Self-Confirmation (`MODEL_SELF_CONFIRMATION = 0`)**: Models cannot confirm actions; confirmations must be initiated by human user interaction.

---

## 2. R41.A READ-ONLY TOOL SPECIFICATIONS

### 2.1 `get_onboarding_status`
- **Description:** Returns the official canonical onboarding progress for the current daycare.
- **Allowed Roles:** `creche_admin`, `master_admin`
- **Confirmation Required:** No
- **Audit Event:** `assistant_tool_get_onboarding_status`
- **Input Schema:**
  ```typescript
  z.object({})
  ```
- **Output Contract:**
  ```typescript
  {
    crecheId: number;
    isComplete: boolean;
    completedCount: number;
    totalSteps: number;
    steps: Array<{
      id: "creche_details" | "staff" | "tutors" | "pets" | "bookings";
      title: string;
      description: string;
      completed: boolean;
      route: string;
      actionLabel?: string;
    }>;
  }
  ```
- **Source of Truth:** Canonical domain logic matching `creches.ts` (`getCrecheOnboardingHandler`). Zero duplicate JSON state (`ASSISTANT_DUPLICATE_ONBOARDING_STATE = 0`).

---

### 2.2 `get_current_user_context`
- **Description:** Returns authenticated profile information for the active user session.
- **Allowed Roles:** `master_admin`, `creche_admin`, `staff`, `tutor`
- **Confirmation Required:** No
- **Audit Event:** `assistant_tool_get_user_context`
- **Input Schema:**
  ```typescript
  z.object({})
  ```
- **Output Contract:**
  ```typescript
  {
    userId: number;
    name: string;
    email: string;
    role: "master_admin" | "creche_admin" | "staff" | "tutor";
    crecheId: number | null;
  }
  ```

---

### 2.3 `get_current_screen_context`
- **Description:** Returns information regarding the user's current route and screen within the ArkPet PWA.
- **Allowed Roles:** `master_admin`, `creche_admin`, `staff`, `tutor`
- **Confirmation Required:** No
- **Audit Event:** `assistant_tool_get_screen_context`
- **Input Schema:**
  ```typescript
  z.object({})
  ```
- **Output Contract:**
  ```typescript
  {
    route: string;
    feature: string;
    allowedActions: string[];
  }
  ```

---

### 2.4 `search_arkpet_knowledge`
- **Description:** Queries the versioned ArkPet documentation corpus for guides, features, and domain rules.
- **Allowed Roles:** `master_admin`, `creche_admin`, `staff`, `tutor`
- **Confirmation Required:** No
- **Audit Event:** `assistant_tool_search_knowledge`
- **Input Schema:**
  ```typescript
  z.object({
    query: z.string().min(1).max(200),
    category: z.string().optional(),
  })
  ```
- **Output Contract:**
  ```typescript
  {
    knowledgeVersion: "arkpet-v32-r41";
    results: Array<{
      title: string;
      category: string;
      snippet: string;
      path: string;
      relevanceScore: number;
    }>;
  }
  ```

---

### 2.5 `list_my_pets`
- **Description:** Lists authorized pets. For tutors, returns pets they own. For creche_admin/staff, returns active pets in their daycare.
- **Allowed Roles:** `tutor`, `creche_admin`, `staff`
- **Confirmation Required:** No
- **Audit Event:** `assistant_tool_list_pets`
- **Input Schema:**
  ```typescript
  z.object({
    limit: z.number().int().min(1).max(50).default(10).optional(),
    search: z.string().max(100).optional(),
  })
  ```
- **Output Contract:**
  ```typescript
  Array<{
    id: number;
    name: string;
    breed: string | null;
    species: string;
    avatarUrl: string | null;
    status: string;
  }>
  ```
- **Security Scoping:**
  - `tutor`: `WHERE ownerId = req.user.id` (strictly isolated from other tutors).
  - `creche_admin` / `staff`: `WHERE crecheId = req.user.crecheId`.

---

### 2.6 `list_my_bookings`
- **Description:** Lists authorized reservations. For tutors, returns bookings for their own pets. For creche_admin/staff, returns bookings in their daycare.
- **Allowed Roles:** `tutor`, `creche_admin`, `staff`
- **Confirmation Required:** No
- **Audit Event:** `assistant_tool_list_bookings`
- **Input Schema:**
  ```typescript
  z.object({
    limit: z.number().int().min(1).max(50).default(10).optional(),
    status: z.enum(["pending", "confirmed", "checked_in", "checked_out", "cancelled"]).optional(),
  })
  ```
- **Output Contract:**
  ```typescript
  Array<{
    id: number;
    petId: number;
    petName: string;
    serviceType: "daycare" | "hotel";
    startDate: string;
    endDate: string;
    status: string;
  }>
  ```
- **Security Scoping:**
  - `tutor`: Joins `petsTable` `WHERE petsTable.ownerId = req.user.id`.
  - `creche_admin` / `staff`: `WHERE bookingsTable.crecheId = req.user.crecheId`.
