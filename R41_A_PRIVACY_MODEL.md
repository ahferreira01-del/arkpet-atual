# ARKPET — R41.A PRIVACY MODEL & DATA PROTECTION POLICY
## CUSTOMER PRIVACY, DATA MINIMIZATION & RETENTION CONTROLS

**Program:** R41 — ArkPet Intelligent Assistant  
**Phase:** R41.A — Assistant Foundation  
**Release Base SHA:** `58b4ff0e5cabd958d0f601af202378900427caab`  

---

## 1. PRIVACY COMMITMENTS & INVARIANTS

ArkPet AI is engineered to protect commercial and personal data belonging to daycare administrators, staff members, and pet tutors.

| Commitment | Invariant / Target | Technical Enforcement |
| :--- | :--- | :--- |
| **No Model Training** | `CUSTOMER_CONVERSATION_MODEL_TRAINING = NO` | Customer conversations and tenant records are never used to train or fine-tune public or third-party AI models. |
| **Data Minimization** | `FULL_TENANT_DATA_SENT_TO_MODEL = NO` | The assistant backend never dumps full database tables or entire tenant catalogs into model context. Only targeted, tool-retrieved snippets are provided. |
| **Zero Mic Capture in R41.A**| `BACKGROUND_MIC_CAPTURE = 0` | Realtime voice capture is completely unmounted in R41.A (`R41_A_VOICE_RUNTIME = NOT_IMPLEMENTED`). No microphone streams exist. |
| **Zero Credential Solicitation** | No passwords, tokens, or cards requested | System prompt instructs the model to immediately refuse and warn against collecting passwords, CVVs, or secret tokens. |
| **Clear UI Privacy Notice** | Transparent user warning displayed | UI displays prominent notice: *"Não informe senhas ou dados bancários ao assistente."* |

---

## 2. DATA MINIMIZATION MATRIX

| Data Category | Transmitted to Model Context? | Justification & Safeguards |
| :--- | :---: | :--- |
| **User ID & Role** | Yes (minimal metadata) | Required for the assistant to address the user by name and provide role-appropriate explanations. |
| **Current Route & Screen** | Yes (sanitized route string) | Enables contextual help (e.g. knowing user is on `/bookings/new`). |
| **Full Database Dumps** | ❌ **Strictly Forbidden** | Only records returned by specific read-only tools (e.g. list of user's own pets) are provided. |
| **Passwords / Password Hashes** | ❌ **Strictly Forbidden** | Never loaded into memory by the assistant service; excluded from all schemas. |
| **Stripe Keys / Webhook Secrets** | ❌ **Strictly Forbidden** | Retained exclusively in backend process environment; zero model access. |
| **Medical / Clinical Raw Records** | ❌ **Strictly Minimized** | Only specific pet dietary/medication notes relevant to today's tasks when explicitly requested. |

---

## 3. SESSION LIFECYCLE & RETENTION POLICY

1. **In-Memory Ephemeral Sessions**:
   - Conversations are maintained in an ephemeral in-memory session store.
   - Sessions expire automatically after 2 hours of inactivity.
   - Users can trigger a "Nova conversa" (reset session) at any time from the UI without affecting persistent daycare data.
2. **Audit Log Data**:
   - Structured audit records store metadata: `timestamp`, `requestId`, `userId`, `crecheId`, `role`, `toolName`, `status`.
   - The conversational content of user questions is **not** persisted in long-term application audit logs.
3. **Right to Erasure**:
   - Closing the assistant session clears client-side cache and drops the active conversation context.
