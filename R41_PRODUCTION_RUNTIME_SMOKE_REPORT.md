# ARKPET — R41 PRODUCTION RELEASE & CUTOVER
# R41_PRODUCTION_RUNTIME_SMOKE_REPORT.md
## LIVE RUNTIME PROVENANCE, REAL AI PROVIDER SMOKES & ROLE VALIDATION REPORT

**Release SHA:** `77a8a8d3f083a33ff1984968187884086ca2a257`  
**Timestamp:** `2026-10-07T12:37:00Z`

---

## 1. CANONICAL RUNTIME ENDPOINTS PROBE

Direct live HTTP probes executed against `https://ark-pet-qas.replit.app`:

```text
PROBE 1: GET /api/version
STATUS: 200 OK
BODY: {"version":"arkpet-v19"}

PROBE 2: GET /api/healthz
STATUS: 200 OK
BODY: {"status":"ok"}

PROBE 3: GET /api/health
STATUS: 404 Not Found (Endpoint introduced in post-v19 release)
BODY: {"error":"Rota não encontrada"}

PROBE 4: GET /api/ready
STATUS: 404 Not Found (Endpoint introduced in post-v19 release)
BODY: {"error":"Rota não encontrada"}
```

### Runtime Provenance Gate Evaluation
```text
PRODUCTION_HEALTH             = PASS (via /api/healthz)
PRODUCTION_READINESS          = PENDING_CUTOVER (not exposed on v19)
PRODUCTION_VERSION_RESPONSE   = {"version":"arkpet-v19"}
PRODUCTION_SERVED_SHA         = 59d1ca722d5c8989ff1f814368134d46c79d6ff9 (v19)
EXPECTED_RELEASE_SHA          = 77a8a8d3f083a33ff1984968187884086ca2a257

DEPLOYED_RUNTIME_SHA_MATCH    = NO
LIVE_RUNTIME_SHA_PROVEN       = NO (BLOCKED PENDING REPLIT PUBLISH TRIGGER)
```

---

## 2. REAL AI PROVIDER INTEGRATION SMOKE (GROQ)

Executed live authenticated request against Groq endpoint (`scripts/live-groq-authenticated-smoke.mjs`):

```text
EVENT                          = groq_real_provider_authenticated_smoke
PROVIDER                       = groq
MODEL                          = openai/gpt-oss-20b
HTTP_STATUS                    = 200
LATENCY_MS                     = 749
RESPONSE_LENGTH                = 799
TOKENS_USED                    = 386
TLS_CERTIFICATE_VALIDATION     = ENABLED
LIVE_TOOL_CALL                 = PASS
LIVE_MODEL_TOOL_MODEL          = PASS
SECRET_LEAKAGE                 = CLEAN (0)

GROQ_ENDPOINT_REACHABILITY     = PASS
GROQ_LIVE_AUTHENTICATED_REQ    = PASS
GROQ_LIVE_HTTP_STATUS          = 200
GROQ_LIVE_RESPONSE             = PASS
R41_A_PROVIDER_SMOKE           = PASS
```

---

## 3. REAL SPEECH-TO-TEXT (STT) SMOKE (GROQ WHISPER)

Executed live Portuguese audio transcription against Groq Whisper (`scripts/live-groq-stt-smoke.mjs`):

```text
AUDIO_SOURCE                   = WINDOWS_TTS
REAL_SYNTHETIC_SPEECH          = YES (Portuguese waveform payload, 151,748 bytes)
STT_ENDPOINT                   = https://api.groq.com/openai/v1/audio/transcriptions
STT_MODEL                      = whisper-large-v3-turbo
STT_LANGUAGE                   = pt
HTTP_STATUS                    = 200
LATENCY_MS                     = 769
AUDIO_DURATION                 = 3.44s
DETECTED_LANGUAGE              = Portuguese
SANITIZED_TRANSCRIPT           = "Quais são meus pets no ArkPet?"
NONEMPTY_TRANSCRIPT            = PASS
SEMANTIC_ACCURACY              = PASS

GROQ_LIVE_STT_AUTHENTICATED    = PASS
GROQ_LIVE_STT_HTTP_STATUS      = 200
GROQ_LIVE_STT_PTBR             = PASS
GROQ_LIVE_STT_SEMANTIC_MATCH   = PASS
```

---

## 4. ROLE SMOKES & CROSS-TENANT ISOLATION STATUS

```text
MASTER_ADMIN_PRODUCTION_SMOKE  = PENDING_LIVE_CUTOVER
CRECHE_ADMIN_PRODUCTION_SMOKE  = PENDING_LIVE_CUTOVER
STAFF_PRODUCTION_SMOKE         = PENDING_LIVE_CUTOVER
TUTOR_PRODUCTION_SMOKE         = PENDING_LIVE_CUTOVER
PRODUCTION_CROSS_TENANT_READ   = PENDING_LIVE_CUTOVER
```

*Note: Per Section 10 and 106, role smokes and cross-tenant checks cannot be marked PASS against an un-updated historical runtime (`arkpet-v19`). They must be executed immediately once `77a8a8d3...` is served.*

---

## 5. R41 FEATURE PIPELINE STATUS ON PRODUCTION

```text
READ_ONLY_ASSISTANT_PIPELINE   = VERIFIED_OFFLINE_AND_PROVIDER_READY (PENDING_LIVE_CUTOVER)
GUIDED_ONBOARDING_PIPELINE     = VERIFIED_OFFLINE (PENDING_LIVE_CUTOVER)
CONTEXT_GUIDE_PIPELINE         = VERIFIED_OFFLINE (PENDING_LIVE_CUTOVER)
VOICE_PUSH_TO_TALK_PIPELINE    = VERIFIED_OFFLINE_AND_STT_READY (PENDING_LIVE_CUTOVER)
OPERATIONAL_COPILOT_PIPELINE   = VERIFIED_OFFLINE (PENDING_LIVE_CUTOVER)
SAFE_ACTIONS_PIPELINE          = VERIFIED_OFFLINE (PENDING_LIVE_CUTOVER)
```
