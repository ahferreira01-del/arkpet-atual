# ARKPET — R41.D CHANGE MANIFEST
## File Modification and Addition Inventory

**Phase:** R41.D-FINAL.1 — Voice Assistant Certification Closure  
**Program:** R41 — ArkPet Intelligent Assistant  
**Certified Baseline:** `9afef90d14a1fed6627f1761562ea270cee837ef` (R41.C-FINAL.1)  
**Implementation Baseline:** `ad8411849dd0df573f4c8c9ec65cda079a82ad4c`  
**Date:** 2026-10-02  
**Status:** Certified Change Inventory  

---

## 1. Summary of Changes

Phase R41.D-FINAL.1 reconciles implementation truth, hardens live smoke testing gates, introduces binary audio signature validation, enforces local-only TTS voice selection, and aligns all security, privacy, and architectural documentation without rewriting git history.

| Category | Initial R41.D | FINAL.1 Updates | Net State |
|---|---|---|---|
| **Backend Implementation** | 5 added, 4 modified | 1 added (`live-gate.evaluator.ts`), 1 modified (`voice.router.ts`) | 6 added, 4 modified |
| **Backend Testing & Knowledge** | 3 added, 2 modified | 1 modified (`assistantVoice.unit.test.ts`) | 3 added, 3 modified |
| **Frontend Implementation** | 3 added, 2 modified | 1 modified (`useSpeechSynthesis.ts`) | 3 added, 3 modified |
| **Frontend Testing** | 1 added, 0 modified | 1 modified (`assistant-voice.test.tsx`) | 1 added, 1 modified |
| **Smoke Scripts & Verification** | 1 added, 0 modified | 1 modified (`live-groq-stt-smoke.mjs`) | 1 added, 1 modified |
| **Documentation & Certification** | 6 added, 0 modified | 6 reconciled | 6 reconciled |

---

## 2. Detailed File Inventory (R41.D-FINAL.1)

### 2.1 Backend Implementation & Architecture
- **`artifacts/api-server/src/assistant/voice/live-gate.evaluator.ts` [ADDED in FINAL.1]:**
  - Pure deterministic evaluator `evaluateLiveGates()` verifying:
    - HTTP status 200 and authenticated request.
    - Non-empty transcript.
    - Strict Portuguese language detection (`pt`, `pt-BR`, `portuguese`, `português`).
    - Semantic keyword matching (`pet`, `arkpet`, `quais`).
    - Assistant invocation confirmation.
    - Strict tool call requirement for `list_my_pets`.
    - Strict Model-Tool-Model roundtrip verification requiring returned pet entities ("Rex", "Thor").
    - Fail-closed deterministic boolean result.
- **`artifacts/api-server/src/assistant/voice/voice.router.ts` [MODIFIED in FINAL.1]:**
  - Added binary container detection (`detectAudioContainer`): WAV, OGG, WebM, MP4, MP3.
  - Added binary signature validation (`validateAudioBinarySignature`) rejecting non-audio executables (ELF, DOS/PE, PDF) with HTTP 415 (`VOICE_UNSUPPORTED_MIME_HTTP_STATUS = 415`, `VOICE_BINARY_SIGNATURE_VALIDATION = PASS`).
  - Implemented and reconciled process-local user rate limiting: `VOICE_RATE_LIMIT_SCOPE = PROCESS_LOCAL`, `VOICE_RATE_LIMIT_PER_USER_PER_MINUTE = 30`, `VOICE_RATE_LIMIT_PER_IP = NOT_IMPLEMENTED`.
  - Exported `resetVoiceRateLimits()` helper for clean unit testing isolation.
  - Reconciled kill switch status code (`503` for `AI_ASSISTANT_KILL_SWITCH`, `403` for `AI_VOICE_ENABLED`).
- **`artifacts/api-server/src/assistant/assistant.config.ts` [PRESERVED]:**
  - Voice configuration constants, bounds (10MB, 60s), allowlist.
- **`artifacts/api-server/src/assistant/voice/groq-stt.provider.ts` [PRESERVED]:**
  - Groq Whisper Large V3 Turbo adapter with sanitized error output.
- **`artifacts/api-server/src/assistant/voice/mock-stt.provider.ts` [PRESERVED]:**
  - Deterministic STT provider for unit test execution.
- **`artifacts/api-server/src/assistant/voice/stt-provider.factory.ts` [PRESERVED]:**
  - Provider factory instantiation.
- **`artifacts/api-server/src/assistant/assistant.router.ts` [PRESERVED]:**
  - Router mounting `/voice`.

### 2.2 Frontend Implementation
- **`artifacts/petdaycare/src/features/assistant/useSpeechSynthesis.ts` [MODIFIED in FINAL.1]:**
  - Added `selectPortugueseVoice()` prioritizing on-device voices (`localService === true`).
  - Added `requireLocalVoice = true` option (`TTS_LOCAL_ONLY_ENFORCED = YES`).
  - Safely suppresses speech synthesis if only remote browser voices exist (`REMOTE_BROWSER_TTS_VOICE_USED = NO`).
  - Preserves assistant text responses completely (`NO_LOCAL_TTS_VOICE_BREAKS_ASSISTANT = NO`).
- **`artifacts/petdaycare/src/features/assistant/useVoiceRecorder.ts` [PRESERVED]:**
  - Push-to-talk recording, 60s hard cap, stream track cleanup.
- **`artifacts/petdaycare/src/features/assistant/VoiceInputButton.tsx` [PRESERVED]:**
  - Push-to-talk button with touch/keyboard ergonomics and live timer.

### 2.3 Smoke Testing & Verification Scripts
- **`scripts/live-groq-stt-smoke.mjs` [MODIFIED in FINAL.1]:**
  - Uses Windows Speech Synthesis API (`System.Speech.Synthesis.SpeechSynthesizer`) for realistic synthetic Portuguese utterance ("Quais são meus pets no ArkPet?").
  - Verifies `LIVE_TEST_AUDIO_SOURCE = WINDOWS_TTS`, `LIVE_TEST_AUDIO_CONTAINS_REAL_SYNTHETIC_SPEECH = YES`.
  - Integrates `evaluateLiveGates()` for strict multi-gate validation.
  - Eliminates false-pass direct model text bypass.
  - Enforces fail-closed `process.exit(1)` and `R41_D_FINAL_CERTIFICATION = BLOCKED` if any gate fails.
  - Prints `R41_D_FINAL_CERTIFICATION = PASS` only when all gates pass.

### 2.4 Testing Suites
- **`artifacts/api-server/src/__tests__/assistantVoice.unit.test.ts` [MODIFIED in FINAL.1]:**
  - Added tests R41D-MIME-001, R41D-AUDIO-SIGNATURE-001, R41D-AUDIO-SIGNATURE-002, R41D-RATE-001, and R41D-LIVE-GATE-001..006 (total 33 tests, 100% green).
- **`artifacts/petdaycare/src/test/assistant-voice.test.tsx` [MODIFIED in FINAL.1]:**
  - Added tests R41D-TTS-LOCAL-001 and R41D-TTS-LOCAL-002 (total 12 tests, 100% green).

### 2.5 Documentation & Certification Artifacts
- **`R41_D_ARCHITECTURE.md` [RECONCILED]**
- **`R41_D_VOICE_SECURITY_MODEL.md` [RECONCILED]**
- **`R41_D_AUDIO_PRIVACY.md` [RECONCILED]**
- **`R41_D_TEST_REPORT.md` [RECONCILED]**
- **`R41_D_CHANGE_MANIFEST.md` [RECONCILED]**
- **`R41_D_CERTIFICATION_REPORT.md` [RECONCILED]**
