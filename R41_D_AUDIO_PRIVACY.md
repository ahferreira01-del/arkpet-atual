# ARKPET — R41.D AUDIO PRIVACY SPECIFICATION
## Privacy Guarantees, Ephemeral Audio Processing & Telemetry Sanitization

**Phase:** R41.D — Voice Assistant  
**Program:** R41 — ArkPet Intelligent Assistant  
**Certified Baseline:** `9afef90d14a1fed6627f1761562ea270cee837ef`  
**Date:** 2026-10-02  
**Status:** Certified Privacy Specification  

---

## 1. Core Privacy Commitments (LGPD / GDPR Compliant)

ArkPet treats user biometric voice data as sensitive personal information. The R41.D voice architecture enforces strict data minimization, ephemeral processing, zero persistent storage, and telemetry sanitization:

1. **Transient Audio Only (`VOICE_AUDIO_PERSISTED_BY_DEFAULT = NO`):**
   Audio recordings are NEVER saved to database tables, local filesystem disks, or cloud storage buckets (S3, GCS, Azure Blob).
2. **Zero Raw Transcript Logging (`RAW_VOICE_TRANSCRIPT_TELEMETRY_LOGGING = 0`):**
   Spoken words transcribed from user speech are NEVER written to operational telemetry or application server log files.
3. **Explicit User Consent & Agency (`MIC_PERMISSION_WITHOUT_USER_ACTION = 0`):**
   The browser microphone is never queried or accessed during page load or component mounting. Access occurs strictly following explicit user touch/click on the push-to-talk button.
4. **No Passive Eavesdropping (`BACKGROUND_LISTENING = 0`, `ALWAYS_ON_MICROPHONE = 0`):**
   ArkPet contains zero wake-word engines or background audio listeners. The microphone operates exclusively while actively engaged by the user.
5. **No Microphone Stream Leaks (`MICROPHONE_STREAM_LEAK = 0`):**
   When recording concludes, is cancelled, or the assistant panel is closed, all MediaStream audio tracks are explicitly stopped, immediately releasing the operating system microphone lock.
6. **Local Spoken Playback (`TTS_AUTOPLAY_DEFAULT = NO`):**
   Spoken responses are synthesized on-device via the browser's native Web Speech API (`window.speechSynthesis`). Response text is never transmitted to third-party TTS audio generators.

---

## 2. Ephemeral Audio Processing Lifecycle

```
[ USER RECORDING ]
  │ User pushes and holds mic button.
  ▼
[ CLIENT MEMORY BLOB ]
  │ Audio captured in browser RAM as temporary Blob.
  ▼
[ TLS INGESTION ]
  │ Sent over HTTPS/TLS to POST /api/assistant/voice/transcribe.
  ▼
[ SERVER RAM BUFFER ]
  │ Converted to transient Buffer in Node.js process memory.
  ▼
[ STT PROVIDER API ]
  │ Dispatched over secure TLS to Groq Whisper STT.
  ▼
[ BUFFER GARBAGE COLLECTION ]
  │ Immediately de-referenced upon receiving STT response.
  │ ZERO bytes written to disk, database, or object storage.
  ▼
[ TRANSCRIPT TO CLIENT ]
  │ Returned to user's browser to display in the input box.
```

---

## 3. Operational Telemetry vs. Privacy Boundaries

Server logs strictly record operational metrics necessary for system reliability, performance monitoring, and rate limiting, while redacting all content payloads:

### What Is Logged:
- `requestId`: Random UUID for distributed tracing.
- `userId`: Numeric identifier of the authenticated user.
- `role`: User role (`master_admin`, `creche_admin`, `staff`, `tutor`).
- `crecheId`: Associated tenant identifier.
- `audioBytes`: Byte length of the received audio snippet.
- `mimeType`: Content-Type (e.g., `audio/webm;codecs=opus`).
- `provider`: Configured STT provider name (`groq` or `mock`).
- `model`: Configured STT model name (`whisper-large-v3-turbo`).
- `latencyMs`: Total processing roundtrip duration in milliseconds.
- `status`: Processing outcome (`success` or error code).

### What Is NEVER Logged:
- ❌ Raw audio bytes or waveforms.
- ❌ Audio transcription text or spoken fragments.
- ❌ Sensitive PII mentioned in voice queries (names, phone numbers, addresses).
- ❌ User voice biometric embeddings or acoustic fingerprints.
- ❌ Server-side `GROQ_API_KEY` or authentication tokens.

---

## 4. Privacy Invariant Verification Matrix

| Privacy Invariant | Guaranteed State | Test Verification Evidence |
|---|---|---|
| `VOICE_AUDIO_PERSISTED_BY_DEFAULT` | `NO` | `assistantVoice.unit.test.ts` (R41D-PRIVACY-001) |
| `RAW_VOICE_TRANSCRIPT_TELEMETRY_LOGGING` | `0` | `assistantVoice.unit.test.ts` (R41D-PRIVACY-002) |
| `MIC_PERMISSION_WITHOUT_USER_ACTION` | `0` | `assistant-voice.test.tsx` (R41D-VOICE-001) |
| `BACKGROUND_LISTENING` | `0` | `assistant-voice.test.tsx` (R41D-VOICE-003) |
| `ALWAYS_ON_MICROPHONE` | `0` | `assistant-voice.test.tsx` (R41D-VOICE-003) |
| `MICROPHONE_STREAM_LEAK` | `0` | `assistant-voice.test.tsx` (R41D-VOICE-004) |
| `TTS_AUTOPLAY_DEFAULT` | `NO` | `assistant-voice.test.tsx` (R41D-TTS-002) |
| `VOICE_INPUT_DEPENDS_ON_TTS` | `NO` | `assistant-voice.test.tsx` (R41D-TTS-003) |
