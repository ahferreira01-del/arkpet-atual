# ARKPET — R41.D ARCHITECTURE
## Voice Assistant: Secure Push-to-Talk, Speech-to-Text & Spoken Response

**Phase:** R41.D-FINAL.1 — Voice Assistant Certification Closure  
**Program:** R41 — ArkPet Intelligent Assistant  
**Certified Baseline:** `9afef90d14a1fed6627f1761562ea270cee837ef` (R41.C-FINAL.1)  
**Implementation Baseline:** `ad8411849dd0df573f4c8c9ec65cda079a82ad4c`  
**Date:** 2026-10-02  
**Status:** Certified Architecture & Implementation  

---

## 1. Architectural Mission & Core Principle

Phase **R41.D (Voice Assistant)** introduces natural, mobile-first voice interactions to the ArkPet Intelligent Assistant while preserving the security, RBAC, tenant isolation, and read-only boundaries certified in R41.A, R41.B, and R41.C.

### The Core Voice Invariant
> **Voice is an input/output modality — NOT a new authorization model.**
> Once speech is transcribed to text on the server, the transcription enters the exact same assistant pipeline as typed text. All RBAC rules, tenant isolation barriers, screen context registries, pet entity checks, tool authorization, max tool loop limits (3 rounds), and prompt injection guards apply identically.
>
> `VOICE_BYPASSES_ASSISTANT_SECURITY = 0`  
> `R41_D_DOMAIN_MUTATION_COUNT = 0`  
> `GENERAL_DB_ACCESS_TOOL = 0`

```
   [ USER ACTION ]
         │ (Hold Mic Button / Spacebar)
         ▼
[ BROWSER CAPTURE ] ── MediaRecorder (audio/webm, audio/wav, audio/ogg, audio/mp4)
         │ (Push-to-Talk only; max 60s hard limit)
         ▼
[ SECURE UPLOAD ] ──── POST /api/assistant/voice/transcribe (JWT Auth, Process-Local Rate Limit, 10MB limit)
         │ (In-memory buffer only; Binary signature validation; ZERO DB or Bucket persistence)
         ▼
[ SPEECH-TO-TEXT ] ─── Groq Whisper Large V3 Turbo / Mock Provider (pt, temp=0)
         │
         ▼
[ USER VISIBILITY ] ── Transcript populated in input box before submission
         │
         ▼
[ ASSISTANT CORE ] ─── R41.A/B/C Pipeline (Context + RBAC + 8 Tools + Knowledge Grounding)
         │
         ▼
[ TEXT RESPONSE ] ──── Rendered in chat message list with markdown
         │
         ▼
[ OPTIONAL AUDIO ] ─── Device-Native Web Speech API (window.speechSynthesis, pt-BR, Local-only, default OFF)
```

---

## 2. Frontend Push-to-Talk Architecture

The client-side voice capture is implemented using web standards without external SDK dependencies.

### 2.1 Native Browser Audio Capture (`useVoiceRecorder.ts`)
- **Primitives:** Native `navigator.mediaDevices.getUserMedia({ audio: true })` and `MediaRecorder`.
- **Consent:** Permission is requested **exclusively on explicit user action** (`MIC_PERMISSION_WITHOUT_USER_ACTION = 0`).
- **No Background Listening:** Microphone is active only while the button is actively held or during an active recording session (`BACKGROUND_LISTENING = 0`, `ALWAYS_ON_MICROPHONE = 0`).
- **Stream Hygiene:** When recording finishes, cancels, or when the component unmounts, all audio tracks on the `MediaStream` are systematically stopped (`MICROPHONE_STREAM_LEAK = 0`).
- **Duration Hard Cap:** Automatic 60-second cutoff stops recording safely and triggers processing (`VOICE_MAX_DURATION_SECONDS = 60`).
- **MIME Selection:** Selects `audio/webm;codecs=opus` when supported, falling back gracefully to browser-supported formats (`audio/webm`, `audio/ogg`, `audio/wav`, `audio/mp4`).

### 2.2 Mobile-First Push-to-Talk UI (`VoiceInputButton.tsx`)
- **Touch & Pointer Handling:** Supports both press-and-hold (pointerdown / pointerup / pointercancel) and tap-to-toggle modes for mobile and desktop ergonomics.
- **Accessibility (A11Y):**
  - Semantic button with `aria-label="Gravar mensagem de voz (pressione e segure ou clique)"`.
  - Keyboard accessible: Spacebar and Enter trigger push-to-talk.
  - Live region with `aria-live="polite"` announces recording and transcribing states to screen readers.
  - Respects `prefers-reduced-motion` for pulse animations.
- **Visual Feedback:**
  - Elapsed recording timer (`00:05 / 01:00`).
  - Pulsing animated recording indicator.
  - Spinner during transcription.
  - Toast error notifications on microphone permission denial (`MIC_PERMISSION_DENIAL_BREAKS_ASSISTANT = NO`).

### 2.3 Transcript User Visibility (`VOICE_TRANSCRIPT_VISIBLE_TO_USER = YES`)
- Upon receiving the transcribed text from the backend, the text is populated into the message input field.
- The user can review, edit, or append to the transcribed text before it is submitted to the assistant.
- In automatic submission flow, the transcript is rendered in the chat bubble as the user's explicit message, maintaining an auditable conversation record.

---

## 3. Backend Speech-to-Text Pipeline

### 3.1 Endpoint Contract: `POST /api/assistant/voice/transcribe`
- **Authentication:** Enforced by `authenticateToken`. Unauthenticated requests return `401 Unauthorized`.
- **Rate Limiting (Source Truth):**
  - `VOICE_RATE_LIMIT_SCOPE = PROCESS_LOCAL`
  - `VOICE_RATE_LIMIT_PER_USER_PER_MINUTE = 30`
  - `VOICE_RATE_LIMIT_PER_IP = NOT_IMPLEMENTED`
  - Tracks authenticated requests in an in-memory sliding window per `req.user.id`. The 31st request within 60 seconds returns `429 Too Many Requests`. Not synchronized across multiple server instances.
- **Size Bounds:** Enforces strict maximum payload size of 10MB (`VOICE_MAX_UPLOAD_BYTES = 10 * 1024 * 1024`). Returns `413 Payload Too Large` when exceeded.
- **MIME Allowlist & Binary Magic-Byte Validation:**
  - `VOICE_DECLARED_MIME_ALLOWLIST = YES`
  - `VOICE_BINARY_SIGNATURE_VALIDATION = PASS`
  - `VOICE_UNSUPPORTED_MIME_HTTP_STATUS = 415`
  - Endpoint inspects both declared `Content-Type` header and the raw binary buffer header.
  - Verified audio container signatures:
    - WAV: `RIFF....WAVE`
    - OGG: `OggS`
    - WebM: EBML header `0x1A 0x45 0xDF 0xA3`
    - MP4/M4A: `ftyp` signature box
    - MP3: ID3 header or MPEG audio frame sync
  - Malicious, executable, or non-audio binary signatures (such as ELF `0x7F 'E' 'L' 'F'`, DOS/PE `MZ`, and PDF `%PDF`) are explicitly rejected with `415 Unsupported Media Type`.
- **Kill Switch & Feature Flag:**
  - Global Kill Switch: `AI_ASSISTANT_KILL_SWITCH="true"` returns `503 Service Unavailable` (`assistant_temporarily_unavailable`).
  - Voice Feature Flag: `AI_VOICE_ENABLED="false"` returns `403 Forbidden` (`voice_feature_disabled`).

### 3.2 Transient Audio Guarantee (`VOICE_AUDIO_PERSISTED_BY_DEFAULT = NO`)
- The incoming audio buffer is received and held strictly in RAM memory during the request.
- The buffer is dispatched directly to the Speech-to-Text provider.
- Once transcription completes or errors, the buffer is dereferenced for immediate V8 garbage collection.
- **Zero database writes:** No audio binaries or base64 strings are stored in PostgreSQL.
- **Zero bucket storage:** No files are uploaded to S3, GCS, or disk folders.
- **Zero transcript telemetry leakage:** Server operational logs record `requestId`, `userId`, `role`, `audioBytes`, `mimeType`, and `latencyMs`, but **never** record the raw spoken transcript (`RAW_VOICE_TRANSCRIPT_TELEMETRY_LOGGING = 0`).

### 3.3 Provider Architecture (`SpeechToTextProvider`)
The system follows a clean provider abstraction matching R41.A multi-provider design:
- `SpeechToTextProvider` interface defines:
  ```typescript
  interface SpeechToTextProvider {
    readonly providerName: string;
    transcribe(input: VoiceTranscriptionInput): Promise<VoiceTranscriptionResult>;
  }
  ```
- **`GroqSpeechToTextProvider`:**
  - Uses Groq Audio Transcriptions API (`https://api.groq.com/openai/v1/audio/transcriptions`).
  - Model: `whisper-large-v3-turbo`.
  - Language: `pt` (Portuguese).
  - Temperature: `0` (deterministic transcription).
  - Prompt: Contextual vocabulary injection (`ArkPet, Day Use, Hospedagem, check-in, check-out, tutor, creche, pet, medicação, Thor, Rex`).
  - Security: Uses server-side `GROQ_API_KEY`. Never exposes key to client. Sanitizes error messages to prevent credential leaks.
- **`MockSpeechToTextProvider`:**
  - Deterministic speech-to-text provider used in automated tests (`NODE_ENV === "test"`).
  - Synthesizes mock transcripts without external network dependencies.
- **`SpeechToTextProviderFactory`:**
  - Instantiates the configured STT provider based on environment configuration (`VOICE_STT_PROVIDER`).

---

## 4. Spoken Response Architecture (Optional Local TTS)

### 4.1 Device-Native Local Playback (`useSpeechSynthesis.ts`)
- **Technology:** Browser-native `window.speechSynthesis` and `SpeechSynthesisUtterance`.
- **Server-Side TTS Provider:** `ARKPET_SERVER_SIDE_TTS_PROVIDER = NONE`. ArkPet operates zero server-side speech generation infrastructure.
- **Default State:** Default is **OFF** (`TTS_AUTOPLAY_DEFAULT = NO`). Requires explicit user activation via header toggle.
- **Language & Local-Only Voice Selection:**
  - Helper `selectPortugueseVoice()` selects `pt-BR` / `pt` voices.
  - Option `requireLocalVoice = true` enforces `TTS_LOCAL_ONLY_ENFORCED = YES`.
  - When active, voices are filtered strictly to local, on-device voices (`voice.localService === true`).
  - If only remote browser synthesis voices are available, spoken playback is safely suppressed (`REMOTE_BROWSER_TTS_VOICE_USED = NO`).
  - Text response rendering in the chat remains completely unaffected (`NO_LOCAL_TTS_VOICE_BREAKS_ASSISTANT = NO`).
- **Text Normalization:** Markdown syntax is cleaned prior to speech synthesis (strips bold, italics, markdown links, code blocks, lists, and headers) so speech output sounds natural.
- **Interruption Control:**
  - Speech immediately stops when the user toggles TTS off, closes the assistant panel, starts a new voice recording, or navigates away.
- **Decoupled Architecture:** Voice input operates completely independently from TTS (`VOICE_INPUT_DEPENDS_ON_TTS = NO`). Users can speak to the assistant and read text responses without audio output.

---

## 5. Architectural Invariant Compliance Matrix

| Invariant | Target | Architecture Provision |
|---|---|---|
| `VOICE_BYPASSES_ASSISTANT_SECURITY` | `0` | Transcripts enter standard Assistant pipeline with full RBAC & checks |
| `BACKGROUND_LISTENING` | `0` | Mic is active exclusively during push-to-talk |
| `ALWAYS_ON_MICROPHONE` | `0` | No continuous recording or auto-reactivation |
| `MIC_PERMISSION_WITHOUT_USER_ACTION` | `0` | `getUserMedia` triggered only by user click/key |
| `MICROPHONE_STREAM_LEAK` | `0` | All `MediaStream` tracks stopped on stop/cancel/unmount |
| `VOICE_AUDIO_PERSISTED_BY_DEFAULT` | `NO` | Transient in-memory processing only; 0 DB / 0 bucket writes |
| `RAW_VOICE_TRANSCRIPT_TELEMETRY_LOGGING` | `0` | Raw text excluded from operational logs |
| `VOICE_RATE_LIMIT_SCOPE` | `PROCESS_LOCAL` | In-memory sliding window on single process |
| `VOICE_RATE_LIMIT_PER_USER_PER_MINUTE` | `30` | Enforces 30 reqs/min per authenticated user |
| `VOICE_RATE_LIMIT_PER_IP` | `NOT_IMPLEMENTED` | Process-local user rate limiting only |
| `VOICE_DECLARED_MIME_ALLOWLIST` | `YES` | Explicit audio MIME allowlist |
| `VOICE_BINARY_SIGNATURE_VALIDATION` | `PASS` | Container magic-byte validation (WAV, OGG, WEBM, MP4, MP3) |
| `VOICE_UNSUPPORTED_MIME_HTTP_STATUS` | `415` | Invalid MIME or magic byte mismatch returns 415 |
| `ARKPET_SERVER_SIDE_TTS_PROVIDER` | `NONE` | Zero server-side TTS infrastructure |
| `TTS_LOCAL_ONLY_ENFORCED` | `YES` | Restricts synthesis to localService voices |
| `REMOTE_BROWSER_TTS_VOICE_USED` | `NO` | Remote browser voices suppressed |
| `NO_LOCAL_TTS_VOICE_BREAKS_ASSISTANT` | `NO` | Assistant functions normally when TTS is suppressed |
| `THIRD_PARTY_STT_PROCESSING_DISCLOSED` | `YES` | Groq STT processing explicitly disclosed |
| `ANDROID_PHYSICAL_VOICE_CERTIFICATION` | `NOT_AVAILABLE` | Physical device testing environment not provisioned |
| `IOS_PHYSICAL_VOICE_CERTIFICATION` | `NOT_AVAILABLE` | Physical device testing environment not provisioned |
| `TTS_AUTOPLAY_DEFAULT` | `NO` | Speech synthesis toggle defaults to false |
| `VOICE_INPUT_DEPENDS_ON_TTS` | `NO` | Input and output modalities are fully decoupled |
| `GROQ_API_KEY_FRONTEND` | `0` | Groq key is strictly server-side |
