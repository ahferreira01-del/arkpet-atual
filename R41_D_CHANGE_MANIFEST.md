# ARKPET — R41.D CHANGE MANIFEST
## File Modification and Addition Inventory

**Phase:** R41.D — Voice Assistant  
**Program:** R41 — ArkPet Intelligent Assistant  
**Certified Baseline:** `9afef90d14a1fed6627f1761562ea270cee837ef`  
**Date:** 2026-10-02  
**Status:** Certified Change Inventory  

---

## 1. Summary of Changes

Phase R41.D introduces secure push-to-talk voice recording, transient speech-to-text processing, and optional device-native spoken responses without altering business logic, RBAC rules, or database schemas.

| Category | Files Added | Files Modified | Files Deleted |
|---|---|---|---|
| **Backend Implementation** | 5 | 4 | 0 |
| **Backend Testing & Knowledge** | 3 | 2 | 0 |
| **Frontend Implementation** | 3 | 2 | 0 |
| **Frontend Testing** | 1 | 0 | 0 |
| **Smoke Scripts & Verification** | 1 | 0 | 0 |
| **Documentation & Certification** | 6 | 0 | 0 |
| **Total** | **19** | **8** | **0** |

---

## 2. Detailed File Inventory

### 2.1 Backend Implementation & Architecture
- **`artifacts/api-server/src/assistant/assistant.config.ts` [MODIFIED]:**
  - Added `isVoiceEnabled`: bound to `process.env.AI_VOICE_ENABLED === "true"` and kill switch.
  - Added `voiceSttProvider`: defaults to `process.env.VOICE_STT_PROVIDER || "groq"`.
  - Added `voiceSttModel`: defaults to `process.env.VOICE_STT_MODEL || "whisper-large-v3-turbo"`.
  - Added `voiceSttLanguage`: defaults to `"pt"`.
  - Added `voiceMaxDurationSeconds`: 60 seconds.
  - Added `voiceMaxUploadBytes`: 10 * 1024 * 1024 (10MB).
  - Added `allowedAudioMimeTypes`: allowlist of 5 audio types (`audio/webm`, `audio/ogg`, `audio/wav`, `audio/mpeg`, `audio/mp4`).
  - Bumped `promptVersion` to `"r41-d-1"`.
- **`artifacts/api-server/src/assistant/voice/stt-provider.types.ts` [ADDED]:**
  - Declares `VoiceTranscriptionInput`, `VoiceTranscriptionResult`, `SpeechToTextProvider`, and typed `VoiceError`.
- **`artifacts/api-server/src/assistant/voice/mock-stt.provider.ts` [ADDED]:**
  - Deterministic speech-to-text provider for automated tests and CI environments.
- **`artifacts/api-server/src/assistant/voice/groq-stt.provider.ts` [ADDED]:**
  - Groq Whisper STT adapter targeting `https://api.groq.com/openai/v1/audio/transcriptions`.
  - Sends multipart form data with server-side `GROQ_API_KEY`.
  - Redacts credentials and sanitizes provider error responses.
- **`artifacts/api-server/src/assistant/voice/stt-provider.factory.ts` [ADDED]:**
  - Factory pattern providing configured STT provider instance; defaults to `mock` in `test` environment.
- **`artifacts/api-server/src/assistant/voice/voice.router.ts` [ADDED]:**
  - Express router mounting `POST /transcribe`.
  - Authentication check (`authenticateToken`), rate limiters, size bounds, MIME checks, kill switch check.
  - Transient memory buffer processing; zero DB or bucket persistence.
  - Operational telemetry with zero raw transcript logging (`RAW_VOICE_TRANSCRIPT_TELEMETRY_LOGGING = 0`).
- **`artifacts/api-server/src/assistant/assistant.router.ts` [MODIFIED]:**
  - Mounts `voiceRouter` under `/voice` (`POST /api/assistant/voice/transcribe`).
- **`artifacts/api-server/src/assistant/assistant-tools.registry.ts` [MODIFIED]:**
  - Added `getAllRegisteredToolNames()` helper.
- **`artifacts/api-server/src/assistant/assistant.provider.ts` [MODIFIED]:**
  - Refined mock fallback for prompt injection refusal text to include standard Portuguese denial phrases.

### 2.2 Backend Tests & Knowledge
- **`artifacts/api-server/src/assistant/knowledge/voice.md` [ADDED]:**
  - Comprehensive Portuguese knowledge base documentation describing voice assistant capabilities, push-to-talk instructions, supported audio formats, and privacy guarantees.
- **`artifacts/api-server/src/__tests__/assistantVoice.unit.test.ts` [ADDED]:**
  - 23 unit tests verifying functional, STT, privacy, and security invariants.
- **`artifacts/api-server/src/__tests__/assistant-evals.json` [MODIFIED]:**
  - Extended golden evaluation dataset with 12 new voice-specific cases (EVAL-81 to EVAL-92, bringing total to 92 evals).
- **`artifacts/api-server/src/__tests__/assistantKnowledge.unit.test.ts` [MODIFIED]:**
  - Updated expected knowledge count to include `voice.md`.

### 2.3 Frontend Implementation
- **`artifacts/petdaycare/src/features/assistant/useVoiceRecorder.ts` [ADDED]:**
  - Custom React hook managing `MediaRecorder` lifecycle, push-to-talk press-and-hold, cancellation, 60s hard cutoff, and stream track cleanup (`MICROPHONE_STREAM_LEAK = 0`).
- **`artifacts/petdaycare/src/features/assistant/useSpeechSynthesis.ts` [ADDED]:**
  - Custom React hook managing `window.speechSynthesis`, `pt-BR` voice selection, markdown stripping, interruption control, and default-off toggle.
- **`artifacts/petdaycare/src/features/assistant/VoiceInputButton.tsx` [ADDED]:**
  - Push-to-talk button component with touch pointer handlers, keyboard control (Space/Enter), animated pulse, live timer, and screen reader announcements.
- **`artifacts/petdaycare/src/features/assistant/AssistantConversation.tsx` [MODIFIED]:**
  - Integrated `VoiceInputButton` beside message input.
  - Automatically populates transcribed text into input field (`VOICE_TRANSCRIPT_VISIBLE_TO_USER = YES`).
- **`artifacts/petdaycare/src/features/assistant/AssistantPanel.tsx` [MODIFIED]:**
  - Integrated TTS toggle button in header.
  - Cancels spoken playback upon panel closing or user interruption.

### 2.4 Frontend Tests
- **`artifacts/petdaycare/src/test/assistant-voice.test.tsx` [ADDED]:**
  - 10 unit tests covering push-to-talk recording, permission denials, track cleanup, TTS markdown stripping, touch ergonomics, and accessibility.

### 2.5 Verification & Smoke Scripts
- **`scripts/live-groq-stt-smoke.mjs` [ADDED]:**
  - Live authenticated verification script testing Groq Whisper Large V3 Turbo with synthetic Portuguese speech and Model-Tool-Model roundtrip.

### 2.6 Certification & Architecture Documentation
- **`R41_D_ARCHITECTURE.md` [ADDED]**
- **`R41_D_VOICE_SECURITY_MODEL.md` [ADDED]**
- **`R41_D_AUDIO_PRIVACY.md` [ADDED]**
- **`R41_D_TEST_REPORT.md` [ADDED]**
- **`R41_D_CHANGE_MANIFEST.md` [ADDED]**
- **`R41_D_CERTIFICATION_REPORT.md` [ADDED]**
