# ArkPet — R41.G Architecture Review
## Integrated Architecture: R41.A through R41.F

---

## 1. Executive Summary

Phase **R41.G** represents the **Integrated Final Certification, Cross-Phase Security Regression, and Release Freeze** for the **ArkPet Intelligent Assistant (R41)** program. R41 delivers an enterprise-grade, privacy-first, multi-role AI assistant deeply integrated into the ArkPet day-care management platform without introducing autonomous mutation risk or bypassing domain logic.

This document reviews the end-to-end architecture across all certified phases:
- **R41.A:** Intelligent Assistant Foundation (Secure LLM Gateway, Tool Dispatch, Fail-Closed Security, Audit Trail)
- **R41.B:** Guided Onboarding (Canonical R40.E Delegation, Role-Adaptive Checklists)
- **R41.C:** Contextual Product Guide (Active Screen & Entity Context, Role-Filtered Assistance)
- **R41.D:** Voice Assistant (Push-to-Talk, Ephemeral Audio, Whisper STT, Audio Privacy)
- **R41.E:** Safe Actions (Two-Phase Preview & Execution, Compare-And-Swap Concurrency, Domain Service Re-Use)
- **R41.F:** Operational Copilot (Deterministic Real-Time Prioritization, Server-Bound Session Deltas)
- **R41.G:** Final Hardening, Cross-Phase Certification, and Release Freeze

---

## 2. System Architecture & Component Model

```mermaid
flowchart TD
    subgraph Client["Frontend Client (PetDayCare / PWA)"]
        UI[Assistant UI Drawer / Modal]
        PTT[Push-to-Talk Audio Capture]
        ScreenContext[Route & Entity Context Hook]
    end

    subgraph Gateway["API Server Gateway (Express 5)"]
        Auth[JWT / Session Authentication]
        Tenancy[Tenant Isolation Middleware]
        RateLimit[IP & User Rate Limiter]
        FeatureFlag[Feature Flags & Kill Switch]
    end

    subgraph AssistantEngine["Assistant Core Engine (R41.A - R41.F)"]
        Orchestrator[AssistantService.processMessage]
        SecContext[AssistantSecurityContext Builder]
        PromptBuilder[System Prompt + Context Aggregator]
        ToolRegistry[20 Strictly Typed Registered Tools]
        SafeActions[SafeActionRegistry: Preview & Execute]
        OpSnapshot[OperationalSnapshotService & Priority Engine]
    end

    subgraph Domain["Canonical Domain Services (Zero Duplication)"]
        BookingSvc[BookingService]
        TaskSvc[OperationalTaskService]
        MedSvc[MedicationService]
        WalkSvc[WalkTaskService]
        OnboardingSvc[OnboardingService - R40.E]
    end

    subgraph Storage["Persistent & Process-Local State"]
        Postgres[(PostgreSQL Database)]
        CacheMemory[(In-Memory Cache: 30s TTL)]
        SessionStore[(Process-Local Session Baselines)]
    end

    subgraph External["External AI Provider"]
        GroqLLM[Groq Chat API: gpt-oss-20b]
        GroqSTT[Groq Whisper API: whisper-large-v3-turbo]
    end

    UI --> Gateway
    PTT -->|audio/webm;codecs=opus <= 25MB| Gateway
    Gateway --> Auth --> Tenancy --> RateLimit --> FeatureFlag
    FeatureFlag --> Orchestrator
    Orchestrator --> SecContext
    SecContext --> PromptBuilder
    PromptBuilder --> GroqLLM
    PTT --> GroqSTT
    GroqLLM -->|Tool Call| ToolRegistry
    ToolRegistry -->|Safe Action Preview| SafeActions
    SafeActions --> Domain
    ToolRegistry -->|Operational Read| OpSnapshot
    OpSnapshot --> Postgres
    OpSnapshot --> CacheMemory
    OpSnapshot --> SessionStore
    SafeActions -->|Confirmed Execution| Domain
    Domain --> Postgres
```

---

## 3. Subsystem Architectural Reviews

### 3.1 R41.A — Intelligent Assistant Foundation
- **Provider Layer:** Defaults to Groq (`openai/gpt-oss-20b`) in source code. Fully fails closed on provider error (`PROVIDER_FAILURE_DOMAIN_MUTATION = 0`, `PROVIDER_FAILURE_FAKE_SUCCESS = 0`). Zero autonomous fallback to secondary providers that might violate privacy boundaries.
- **Prompt Engineering:** Strict system instructions enforcing tone, domain terminology, canonical roles, anti-hallucination protocols, and fail-closed security.
- **Streaming & Non-Streaming:** Supports chunked SSE streaming with guaranteed audit log emission upon stream termination.

### 3.2 R41.B — Guided Onboarding
- **Canonical Delegation:** Does not reimplement onboarding logic (`DUPLICATE_ONBOARDING_COMPLETION_ENGINE = 0`). Delegates entirely to the canonical R40.E `OnboardingService`.
- **Role-Adaptive Progress:** Tutors receive pet registration checklists; creche admins receive facility configuration guidance; staff receive operational duty checklists.

### 3.3 R41.C — Contextual Product Guide
- **Real Route Binding:** Maps strictly to active routes (`/`, `/pets`, `/calendar`, `/tutors`, `/creche/settings`, `/staff`, `/dashboard`). Zero fictitious routes (`FICTITIOUS_CONTEXT_ROUTE_COUNT = 0`).
- **Entity Safety:** Active pet context is authenticated against tenant ownership. Tutor cannot pass another tutor's pet ID to acquire unauthorized context (`R41_G_CROSS_TENANT_READ = 0`).

### 3.4 R41.D — Voice Assistant
- **Microphone Permission:** Explicit user consent required on client (`VOICE_PERMISSION_EXPLICIT = YES`).
- **Push-to-Talk Exclusivity:** Zero background listening or continuous recording (`BACKGROUND_LISTENING = 0`).
- **Bounded Audio:** Payload limit enforced at 25MB (`AUDIO_PAYLOAD_BOUND_MB = 25`), safe MIME type whitelist (`audio/webm`, `audio/mp4`, `audio/wav`, `audio/ogg`).
- **Audio Privacy:** Audio chunks are held strictly in memory during STT transit and discarded immediately. Zero raw sensitive audio stored in logs or database (`AUDIO_STORAGE_RETENTION = 0`).

### 3.5 R41.E — Safe Actions
- **Two-Phase Commit:** Every domain mutation requires explicit preview followed by authenticated human confirmation (`MUTATION_WITHOUT_CONFIRMATION = 0`).
- **LLM Decoupled from Execution:** The LLM only proposes the action; execution occurs via deterministic TypeScript handler validating canonical domain invariants without AI in the execution path (`LLM_IN_MUTATION_EXECUTION_PATH_AFTER_CONFIRMATION = NO`).
- **Compare-And-Swap (CAS):** Concurrency conflicts are prevented using entity version checks and user/tenant binding (`CAS_ATOMIC_AUTHORIZATION_BOUND = YES`).
- **Idempotency:** Action execution requires an idempotency token ensuring at-most-once execution.

### 3.6 R41.F — Operational Copilot
- **Deterministic Prioritization:** Operational priority is determined strictly by canonical task schedules, overdue status, and facility thresholds—never by LLM subjective judgment (`INVENTED_OPERATIONAL_SLA = 0`).
- **Truthful Data Interpretation:** Missing data or failed sub-queries are explicitly marked as unavailable; they are never defaulted to zero (`DATA_RETRIEVAL_FAILURE_INTERPRETED_AS_ZERO = 0`, `FAKE_OPERATIONAL_CAPACITY_FALLBACK = 0`).
- **Process-Local State:** Session baselines and 30-second operational snapshot caches are maintained in process memory and correctly documented as non-distributed.

### 3.7 R41.G — Final Hardening
- **Unbound Session Elimination:** Removed legacy `setSessionBaseline(string, ...)` and `getSessionBaseline(string)` overloads from `OperationalSnapshotService`. Only fully qualified `SessionBaselineContext` (`sessionId`, `userId`, `crecheId`, `role`) is accepted (`UNBOUND_OPERATIONAL_SESSION_API = 0`).

---

## 4. Current Tool Inventory (Exact 20 Tools Certified)

ArkPet R41 provides exactly 20 tools across 3 categories. Zero generic database access or arbitrary query tools exist (`GENERAL_DB_ACCESS_TOOL = 0`, `DOCUMENTED_NONEXISTENT_TOOL_NAMES = 0`).

### Category A: Baseline Read-Only Tools (8 Tools)
1. `get_onboarding_status`: Retrieves R40.E guided onboarding progress.
2. `get_current_user_context`: Inspects authenticated user role and identity.
3. `get_current_screen_context`: Returns contextual guidance for the current frontend view.
4. `search_arkpet_knowledge`: Queries versioned static knowledge (`arkpet-v32-r41c`).
5. `list_my_pets`: Returns tenant/user-owned pets with health summaries.
6. `list_my_bookings`: Returns scheduled day-care bookings for the authenticated scope.
7. `get_guided_onboarding_plan`: Returns full step-by-step onboarding plan.
8. `get_contextual_product_guide`: Returns detailed system guide for active view.

### Category B: Operational Read Tools (5 Tools)
9. `get_operational_overview`: Real-time census, occupancy, task counts, and alerts.
10. `get_operational_priorities`: Deterministically ranked urgent tasks and schedule deadlines.
11. `get_today_arrivals`: Scheduled, checked-in, and departing pets for the current date.
12. `get_pending_operational_tasks`: Pending feeding, walking, and care tasks.
13. `get_recent_operational_changes`: Compares current operational state with session baseline.

### Category C: Safe Action Mutation Tools (7 Tools)
14. `cancel_my_booking`: Tutor-facing cancellation subject to cancellation policy.
15. `check_in_pet`: Staff-facing pet arrival check-in with booking verification.
16. `check_out_pet`: Staff-facing departure check-out.
17. `complete_operational_task`: General care task completion.
18. `complete_feeding_task`: Pet feeding administration recording.
19. `record_medication_administration`: Medication administration logging with strict dosage enforcement.
20. `complete_walk_task`: Pet walk activity recording.

---

## 5. Deployment Architecture & Hosting Environment

### 5.1 Production Hosting Architecture
ArkPet uses a containerized full-stack deployment model:
- **Backend API:** Built to `dist/index.cjs` (2.9 MB bundle) executed via Node.js on port 8080 (`server.mjs` / Cloud Run / Replit container).
- **Frontend SPA:** Built to `artifacts/petdaycare/dist` and served statically or via Express static middleware.
- **Database:** Managed PostgreSQL instance accessed via Drizzle ORM.

### 5.2 Clarification on External Vercel Checks
- **Root Cause:** An external GitHub webhook trigger exists for Vercel. Because ArkPet is a pnpm monorepo requiring specific root scripts, environment configurations, and PostgreSQL connectivity that are not defined in Vercel's legacy configuration, the Vercel check reports failure.
- **Release Invariance:** Vercel is **NOT** the production deployment target or staging target for ArkPet. Vercel deployment is obsolete and strictly non-blocking (`VERCEL_REQUIRED_FOR_ARKPET_RELEASE = NO`).

---

## 6. Architecture Review Sign-Off

The integrated architecture of R41.A through R41.F, as hardened in R41.G, complies with all security, privacy, performance, and stability guidelines.

**ARCHITECTURE STATUS:** **APPROVED & CERTIFIED**
