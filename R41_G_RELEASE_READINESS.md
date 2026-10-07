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
R40_RC_FINAL_SHA                = 58b4ff0e5cabd958d0f601af202378900427caab
R41_A_FINAL_SHA                 = fb8ed90f3b31358464ea22dce07655b46961934b
R41_B_FINAL_SHA                 = ba2052fa9a88ca9a9dfd1afe302f528d88db120c
R41_C_FINAL_SHA                 = 9afef90d14a1fed6627f1761562ea270cee837ef
R41_D_FINAL_SHA                 = ab539ae4504d8c18d192e0bd2416805789200f1f
R41_E_FINAL_SHA                 = 2887f09ea5aef06af4c77124a77f6d517e1ba0ce
R41_F_FINAL_SHA                 = 46caa37f38d23f49270976a5c947512e73c54646
R41_G_IMPLEMENTATION_FREEZE_SHA = 1942475bae4d5108deeabaf2c8350f48f7b6446c
R41_G_FINAL1_CLOSURE_SHA        = 8efa9a8a30fc9f49fd37c778bc904cb3b91179d7
R41_G_FINAL2_CLOSURE_SHA        = <reported after commit>
```

| Invariant | Value | Certified |
| :--- | :---: | :---: |
| `FORWARD_HISTORY_ONLY` | `YES` | **PASS** |
| `CERTIFIED_COMMITS_REWRITTEN` | `0` | **PASS** |
| `FORCE_PUSH_REQUIRED` | `NO` | **PASS** |
| `CANONICAL_REMOTE_SHA_MATCH` | `YES` | **PASS** |
| `DEPLOY_REMOTE_SHA_MATCH` | `YES` | **PASS** |
| `DOCUMENTED_NONEXISTENT_LINEAGE_SHA` | `0` | **PASS** |
| `DOCUMENTED_LINEAGE_MATCHES_GIT_ANCESTRY` | `YES` | **PASS** |

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

## 5. Status & Root Cause: External Vercel Checks

### Status
```text
VERCEL_STATUS = FAILURE
VERCEL_REQUIRED_FOR_ARKPET_RELEASE = NO
VERCEL_FAILURE_ROOT_CAUSE = NOT_FULLY_PROVEN
```

### Context & Analysis
1. A legacy GitHub webhook trigger attempts Vercel preview builds on commit pushes to the repository. These builds have reported failure.
2. ArkPet is an enterprise monorepo using `pnpm` workspace protocols (`@workspace/api-server`, `@workspace/petdaycare`, `@workspace/db`).
3. The exact configuration error on Vercel has not been fully verified or proven in source; however, ArkPet does not use Vercel for hosting or staging.
4. ArkPet production hosting targets a containerized Node.js runtime (`dist/index.cjs` on port 8080 / container runtime) paired with static client hosting.
5. Vercel deployment is strictly non-blocking and irrelevant to release qualification.

---

## 6. Environment Configuration Matrix (Source-Verified)

Derived strictly from `artifacts/api-server/src/assistant/assistant.config.ts`:

| Variable | Default Value | Role / Safety Impact |
| :--- | :--- | :--- |
| `AI_ASSISTANT_ENABLED` | `"true"` (false only if `"false"`) | Global master switch for assistant capability |
| `AI_ASSISTANT_KILL_SWITCH` | `"false"` (true only if `"true"`) | Emergency kill switch; returns HTTP 503 immediately if `"true"` |
| `AI_SAFE_ACTIONS_ENABLED` | `"false"` (true only if `"true"`) | Opt-in switch for Safe Action mutation proposals (R41.E) |
| `AI_OPERATIONAL_COPILOT_ENABLED` | `"false"` (true only if `"true"`) | Opt-in switch for Operational Copilot tools for staff/admin (R41.F) |
| `AI_VOICE_ENABLED` | `"false"` (true only if `"true"`) | Opt-in switch for Push-to-Talk voice transcription (R41.D) |
| `AI_PROVIDER` | `"groq"` | Source-default provider (`SOURCE_DEFAULT_PROVIDER = groq`) |
| `AI_MODEL` | `"openai/gpt-oss-20b"` | Source-default model (`SOURCE_DEFAULT_MODEL = openai/gpt-oss-20b`; `"gpt-4o-mini"` if `AI_PROVIDER=openai`) |
| `VOICE_STT_PROVIDER` | `"groq"` | Default speech-to-text transcription provider |
| `VOICE_STT_MODEL` | `"whisper-large-v3-turbo"` | Default speech-to-text transcription model |
| `VOICE_STT_LANGUAGE` | `"pt"` | Default speech-to-text language |
| `GROQ_API_KEY` | *Secret* | Secure API key for Groq LLM & Whisper STT |

*Note on Configuration Truth:* Former references to fictitious variable names have been eliminated. Only the authoritative source variables above are recognized.

---

## 7. Release Freeze Sign-Off

The ArkPet Intelligent Assistant program (R41) has achieved complete release readiness across all functional, security, and operational dimensions.

**RELEASE READINESS STATUS:** **FROZEN & READY FOR CUTOVER**
