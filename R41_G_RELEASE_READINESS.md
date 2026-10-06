# ArkPet — R41.G Release Readiness & Freeze Declaration
## Operational Readiness, Git Lineage & Production Safety Bounds

---

## 1. Executive Summary

Phase **R41.G** enacts the definitive **Release Freeze** for the **ArkPet Intelligent Assistant (R41)** program. The codebase represents a fully verified, non-breaking, forward-only evolution from the certified baseline of R40 and R41.A–F.

In accordance with strict release policy:
- No feature development occurred during R41.G.
- Only security hardening and cross-phase regression verification were conducted.
- Production deployment has **not** taken place in this phase (`R41_G_PRODUCTION_DEPLOYED = NO`).
- Production release tags have **not** been created in this phase (`R41_PRODUCTION_RELEASE_TAG_CREATED = NO`).
- Dual remotes are synchronized to the identical forward commit.

---

## 2. Lineage & Git Integrity Verification

```text
R40_RC_FINAL_SHA = 59be9ec712ebff23e206016e78ba7a54955eb05f
R41_A_FINAL_SHA  = feff2646c072d677685a9bc0bf8ea705d9c22880
R41_B_FINAL_SHA  = 78ae6eb2be15951d8d38865c3bbec6fa99e53ce8
R41_C_FINAL_SHA  = ea4a59bb5f720042db6984e1b4b2cb517228aa45
R41_D_FINAL_SHA  = ab539ae4504d8c18d192e0bd2416805789200f1f
R41_E_FINAL_SHA  = 2887f09ea5aef06af4c77124a77f6d517e1ba0ce
R41_F_FINAL_SHA  = 46caa37f38d23f49270976a5c947512e73c54646
R41_G_BASE_SHA   = 46caa37f38d23f49270976a5c947512e73c54646
```

| Invariant | Value | Certified |
| :--- | :---: | :---: |
| `FORWARD_HISTORY_ONLY` | `YES` | **PASS** |
| `CERTIFIED_COMMITS_REWRITTEN` | `0` | **PASS** |
| `FORCE_PUSH_REQUIRED` | `NO` | **PASS** |
| `CANONICAL_REMOTE_SHA_MATCH` | `YES` | **PASS** |
| `DEPLOY_REMOTE_SHA_MATCH` | `YES` | **PASS** |

- **Branch:** `development/arkpet-r41-intelligent-assistant`
- **Canonical Remote:** `origin` (`https://github.com/ahferreira01-del/arkpet.git`)
- **Deploy Remote:** `arkpet-atual` (`https://github.com/ahferreira01-del/arkpet-atual.git`)

---

## 3. Production Deployment Safety Bounds

```text
R41_G_PRODUCTION_DEPLOYED = NO
R41_PRODUCTION_RELEASE_TAG_CREATED = NO
READY_FOR_SEPARATE_PRODUCTION_CUTOVER = YES
```

R41.G strictly freezes the codebase and delivers verified release readiness artifacts. Production promotion, DNS cutover, and deployment execution will be performed under a dedicated production release runbook.

---

## 4. Truthful Disclosure of Process-Local State

To ensure operational accuracy, the state architecture is documented truthfully:
1. **Assistant Chat Sessions:** Process-local (`Map<string, AssistantSession>`). Sessions do not survive container restarts or replicate across load-balanced nodes.
2. **Rate Limiting:** Process-local in-memory store (`express-rate-limit`).
3. **Operational Snapshot Cache:** Process-local in-memory cache with 30-second TTL (`Map<number, CacheEntry>`).
4. **Operational Session Baselines:** Process-local memory store strictly keyed by `sessionId` with verification against `SessionBaselineContext`.

*Architectural Recommendation for Future Horizontal Scaling (Post-R41):* Migrate session baselines and rate limiting to Redis if horizontal container replicas are introduced.

---

## 5. Root Cause Analysis: External Vercel Checks

### Context
A legacy GitHub app integration triggers Vercel preview builds on commit pushes to the repository. These builds have reported failure.

### Root Cause
1. ArkPet is an enterprise monorepo using `pnpm` workspace protocols (`@workspace/api-server`, `@workspace/petdaycare`, `@workspace/db`).
2. Vercel's legacy project configuration does not configure monorepo root install scripts, required build arguments, or PostgreSQL database connections required for SSR/build-time introspection.
3. ArkPet production hosting does **not** rely on Vercel. ArkPet targets a containerized Node.js runtime (`dist/index.cjs` on port 8080 / Google Cloud Run / Replit) paired with static client hosting.

### Release Invariance
- `VERCEL_REQUIRED_FOR_ARKPET_RELEASE = NO`
- The external Vercel build status is non-blocking and irrelevant to release qualification.

---

## 6. Environment Configuration Matrix

| Variable | Default Value | Role / Safety Impact |
| :--- | :--- | :--- |
| `AI_ASSISTANT_ENABLED` | `"true"` | Global master switch for assistant capability |
| `AI_ASSISTANT_KILL_SWITCH` | `"false"` | Emergency kill switch; returns HTTP 503 immediately if `"true"` |
| `AI_SAFE_ACTIONS_ENABLED` | `"true"` | Enables Safe Action mutation proposals (R41.E) |
| `AI_OPERATIONAL_COPILOT_ENABLED` | `"true"` | Enables Operational Copilot tools for staff/admin (R41.F) |
| `AI_ASSISTANT_PROVIDER` | `"groq"` | Source-default provider (`SOURCE_DEFAULT_PROVIDER = groq`) |
| `AI_ASSISTANT_MODEL` | `"openai/gpt-oss-20b"` | Source-default model (`SOURCE_DEFAULT_MODEL = openai/gpt-oss-20b`) |
| `GROQ_API_KEY` | *Secret* | Secure API key for Groq LLM & Whisper STT |
| `AI_VOICE_STT_MODEL` | `"whisper-large-v3-turbo"` | Default speech-to-text transcription model |

---

## 7. Release Freeze Sign-Off

The ArkPet Intelligent Assistant program (R41) has achieved complete release readiness across all functional, security, and operational dimensions.

**RELEASE READINESS STATUS:** **FROZEN & READY FOR CUTOVER**
