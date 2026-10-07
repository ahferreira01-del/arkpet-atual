# ARKPET — R41 PRODUCTION RELEASE & CUTOVER
# R41_PRODUCTION_CHANGE_MANIFEST.md
## PROGRAM LINEAGE, SUBSYSTEM DELIVERABLES, SCHEMA & CONFIGURATION MANIFEST

**Certified Release SHA:** `77a8a8d3f083a33ff1984968187884086ca2a257`  
**Timestamp:** `2026-10-07T12:38:30Z`

---

## 1. CANONICAL GIT ANCESTRY

Source-proven git commit lineage:

```text
R40_RC_FINAL_SHA               = 58b4ff0e5cabd958d0f601af202378900427caab
R41_A_FINAL_SHA                = fb8ed90f3b31358464ea22dce07655b46961934b
R41_B_FINAL_SHA                = ba2052fa9a88ca9a9dfd1afe302f528d88db120c
R41_C_FINAL_SHA                = 9afef90d14a1fed6627f1761562ea270cee837ef
R41_D_FINAL_SHA                = ab539ae4504d8c18d192e0bd2416805789200f1f
R41_E_FINAL_SHA                = 2887f09ea5aef06af4c77124a77f6d517e1ba0ce
R41_F_FINAL_SHA                = 46caa37f38d23f49270976a5c947512e73c54646
R41_G_IMPLEMENTATION_FREEZE_SHA = 1942475bae4d5108deeabaf2c8350f48f7b6446c
R41_G_FINAL1_CLOSURE_SHA       = 8efa9a8a30fc9f49fd37c778bc904cb3b91179d7
R41_G_FINAL2_CLOSURE_SHA       = 77a8a8d3f083a33ff1984968187884086ca2a257

DOCUMENTED_NONEXISTENT_LINEAGE_SHA      = 0
DOCUMENTED_LINEAGE_MATCHES_GIT_ANCESTRY = YES
```

---

## 2. R41 SUBSYSTEM DELIVERABLES IN RELEASE SHA

| Subsystem | Key Files / Modules | Purpose |
| :--- | :--- | :--- |
| **R41.A** | `assistant.service.ts`, `assistant-provider.service.ts`, `assistant-tools.registry.ts` | Intelligent Assistant core engine, Groq LLM integration, tool registry |
| **R41.B** | `assistant-guided-onboarding.service.ts` | Guided onboarding state machine and RBAC workflows |
| **R41.C** | `assistant-context-registry.service.ts` | Contextual product guide with 20 canonical route definitions |
| **R41.D** | `assistant-voice.controller.ts`, `assistant-stt.service.ts` | Secure push-to-talk voice pipeline with Groq Whisper STT |
| **R41.E** | `assistant-safe-actions.service.ts`, `assistantSafeActions.ts` | Controlled mutations, CAS validation, audit trail, idempotency |
| **R41.F** | `assistant-operational-copilot.service.ts` | Real-time operational engine, priority sorting, zero-drift telemetry |
| **R41.G** | `assistantR41GIntegrated.unit.test.ts` | Cross-phase integration test harness & unified system certification |

---

## 3. DATABASE SCHEMA ADDITIONS

All schema modifications are strictly additive and idempotent:

### Table: `assistant_pending_actions`
- `id` (VARCHAR(64) PRIMARY KEY)
- `user_id` (INTEGER NOT NULL)
- `creche_id` (INTEGER NOT NULL)
- `role` (VARCHAR(32) NOT NULL)
- `action_type` (VARCHAR(64) NOT NULL)
- `target_type` (VARCHAR(64) NOT NULL)
- `target_id` (INTEGER NOT NULL)
- `validated_payload` (JSONB NOT NULL)
- `payload_hash` (VARCHAR(64) NOT NULL)
- `status` (VARCHAR(32) NOT NULL DEFAULT 'pending_confirmation')
- `preview_data` (JSONB NOT NULL)
- `summary` (TEXT NOT NULL)
- `request_id` (VARCHAR(64))
- `created_at` (TIMESTAMP NOT NULL DEFAULT NOW())
- `expires_at` (TIMESTAMP NOT NULL)
- `confirmed_at` (TIMESTAMP)
- `executed_at` (TIMESTAMP)
- `result_reference` (JSONB)
- `error_message` (TEXT)
- Indexes: `apa_user_status_idx`, `apa_creche_idx`, `apa_expires_idx`, `apa_target_idx`

### Table: `assistant_safe_action_audit`
- `id` (SERIAL PRIMARY KEY)
- `action_type` (VARCHAR(64) NOT NULL)
- `actor_user_id` (INTEGER NOT NULL)
- `actor_role` (VARCHAR(32) NOT NULL)
- `creche_id` (INTEGER NOT NULL)
- `target_type` (VARCHAR(64) NOT NULL)
- `target_id` (INTEGER NOT NULL)
- `pending_action_id` (VARCHAR(64))
- `request_id` (VARCHAR(64))
- `timestamp` (TIMESTAMP NOT NULL DEFAULT NOW())
- `result` (VARCHAR(32) NOT NULL)
- `before_state` (JSONB)
- `after_state` (JSONB)
- `idempotency_key` (VARCHAR(128) NOT NULL)
- `details` (TEXT)
- `denial_reason` (TEXT)
- Indexes: `asaa_actor_idx`, `asaa_creche_idx`, `asaa_pending_action_idx`, `asaa_idempotency_idx`, `asaa_timestamp_idx`

---

## 4. ENVIRONMENT VARIABLES & FEATURE FLAGS MANIFEST

```text
AI_ASSISTANT_ENABLED           = true (Default enabled)
AI_ASSISTANT_KILL_SWITCH       = false (Operational emergency kill switch)
AI_SAFE_ACTIONS_ENABLED        = false (Controlled rollout gate)
AI_OPERATIONAL_COPILOT_ENABLED = false (Controlled rollout gate)
AI_VOICE_ENABLED               = false (Controlled rollout gate)

AI_PROVIDER                    = groq
AI_MODEL                       = openai/gpt-oss-20b

VOICE_STT_PROVIDER             = groq
VOICE_STT_MODEL                = whisper-large-v3-turbo
VOICE_STT_LANGUAGE             = pt
```
