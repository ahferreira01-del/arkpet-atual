# ARKPET — R41.D AUDIO PRIVACY SPECIFICATION
## Privacy Guarantees, Ephemeral Audio Processing & Telemetry Sanitization

**Phase:** R41.D-FINAL.1 — Voice Assistant Certification Closure  
**Program:** R41 — ArkPet Intelligent Assistant  
**Certified Baseline:** `9afef90d14a1fed6627f1761562ea270cee837ef`  
**Implementation Baseline:** `ad8411849dd0df573f4c8c9ec65cda079a82ad4c`  
**Date:** 2026-10-02  
**Status:** Certified Privacy Specification  

---

## 1. Technical Privacy Safeguards Supporting Privacy Compliance

ArkPet treats user voice data with rigorous data protection practices, implementing technical safeguards designed to support compliance with data protection laws (such as LGPD and GDPR) through strict data minimization, ephemeral processing, zero persistent storage, and telemetry sanitization:

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
6. **Local Spoken Playback & Browser Boundary (`TTS_AUTOPLAY_DEFAULT = NO`):**
   - ArkPet maintains zero server-side speech generation infrastructure (`ARKPET_SERVER_SIDE_TTS_PROVIDER = NONE`).
   - Spoken responses utilize the client browser's native Web Speech API (`window.speechSynthesis`).
   - Standard browser implementations of the Web Speech API may query local OS voices or remote browser provider voices. ArkPet enforces local-only voice selection (`selectPortugueseVoice` with `requireLocalVoice = true`), filtering exclusively for on-device voices (`voice.localService === true`).
   - Under this policy (`TTS_LOCAL_ONLY_ENFORCED = YES`), speech synthesis is suppressed if only remote browser voices exist (`REMOTE_BROWSER_TTS_VOICE_USED = NO`), ensuring text responses continue to render safely without degradation (`NO_LOCAL_TTS_VOICE_BREAKS_ASSISTANT = NO`).
7. **Third-Party Processing Disclosure (`THIRD_PARTY_STT_PROCESSING_DISCLOSED = YES`):**
   - Audio transcription is executed via Groq's Audio Transcriptions API (`whisper-large-v3-turbo`) acting as a sub-processor under standard enterprise API terms.
   - Audio is transmitted via encrypted HTTPS/TLS directly from ArkPet's backend and is discarded immediately post-transcription without persistence on ArkPet systems.

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
  │ Header allowlist and binary container signature inspected.
  ▼
[ STT PROVIDER API (GROQ) ]
  │ Dispatched over secure TLS to Groq Whisper STT (Third-Party Sub-processor).
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
| `ARKPET_SERVER_SIDE_TTS_PROVIDER` | `NONE` | Verified architecture inspection |
| `TTS_LOCAL_ONLY_ENFORCED` | `YES` | `assistant-voice.test.tsx` (R41D-TTS-LOCAL-001, R41D-TTS-LOCAL-002) |
| `REMOTE_BROWSER_TTS_VOICE_USED` | `NO` | `assistant-voice.test.tsx` (R41D-TTS-LOCAL-002) |
| `NO_LOCAL_TTS_VOICE_BREAKS_ASSISTANT` | `NO` | `assistant-voice.test.tsx` (R41D-TTS-LOCAL-002) |
| `THIRD_PARTY_STT_PROCESSING_DISCLOSED` | `YES` | Specification & Knowledge documentation |
