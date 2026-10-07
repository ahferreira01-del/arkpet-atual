# ARKPET — R41 PRODUCTION RELEASE & CUTOVER
# R41_PRODUCTION_ROLLBACK_PLAN.md
## PRODUCTION ROLLBACK STRATEGY, PREVIOUS REVISION RESTORATION & FEATURE LEVEL ISOLATION

**Production Application Release SHA:** `98c547ef6439d944827f8ea83123f2bfc2028596`  
**Rollback Target Source:** `arkpet-v19` (`59d1ca722d5c8989ff1f814368134d46c79d6ff9`)  
**Rollback Revision ID:** `4c7c2f86-0e97-404f-b3ef-8078a7205b30`  
**Timestamp:** `2026-10-07T14:09:00Z`

---

## 1. ROLLBACK BASELINE & SOURCE PROVENANCE

```text
ROLLBACK_SOURCE        = arkpet-v19 (commit 59d1ca722d5c8989ff1f814368134d46c79d6ff9)
ROLLBACK_REVISION_ID   = 4c7c2f86-0e97-404f-b3ef-8078a7205b30
ROLLBACK_AVAILABLE     = YES
PRE_CUTOVER_VERSION    = arkpet-v19
```

---

## 2. GRANULAR FEATURE ROLLBACK (TIER 1 — RUNTIME FLAGS)

In the event of an isolated issue within a specific R41 capability, disable the affected subsystem without redeploying the entire application:

### A. Safe Action Rollback
If any issue occurs with controlled mutations or pending actions:
- Set `AI_SAFE_ACTIONS_ENABLED=false`
- Safe action endpoints immediately return graceful 403/503.
- Assistant continues answering read-only questions normally.

### B. Operational Copilot Rollback
If the real-time operational context engine exhibits latency or issues:
- Set `AI_OPERATIONAL_COPILOT_ENABLED=false`
- Operational queries fall back cleanly to static domain queries.

### C. Voice Assistant Rollback
If audio transcription or STT encounters latency or upstream errors:
- Set `AI_VOICE_ENABLED=false`
- Speech-to-text endpoints reject new audio uploads cleanly. Text chat continues uninterrupted.

### D. Global Assistant Emergency Kill Switch
If the entire AI platform encounters an unexpected issue:
- Set `AI_ASSISTANT_KILL_SWITCH=true`
- Assistant immediately enters dormant mode (returns 503 Service Unavailable).
- Core ArkPet operations (pets, bookings, daycare, staff, financial) remain 100% functional.

```text
SAFE_ACTION_FEATURE_ROLLBACK_AVAILABLE = YES
OPERATIONAL_FEATURE_ROLLBACK_AVAILABLE = YES
VOICE_FEATURE_ROLLBACK_AVAILABLE       = YES
GLOBAL_ASSISTANT_KILL_SWITCH_AVAILABLE = YES
ASSISTANT_FAILURE_ISOLATED_FROM_CORE   = YES
```

---

## 3. FULL APPLICATION ROLLBACK (TIER 2 — REPLIT DEPLOYMENT)

If a critical platform regression occurs requiring complete rollback to the pre-cutover state:

### Step 1: Replit Deployment Pane Rollback
1. Open the Replit workspace for `ark-pet-qas`.
2. Navigate to **Deployments** → **Deploy History / Revisions**.
3. Locate deployment build `4c7c2f86-0e97-404f-b3ef-8078a7205b30` (serving `arkpet-v19`, commit `59d1ca722d5c8989ff1f814368134d46c79d6ff9`).
4. Select **Redeploy / Rollback to Revision**.

### Step 2: Git Fallback Synchronization
If a fresh deployment of the previous git state is required:
```bash
git push arkpet-atual 59d1ca722d5c8989ff1f814368134d46c79d6ff9:main --force-with-lease
```
*Note: Do NOT use git force-push as normal rollback. Use Replit deployment/revision rollback.*

---

## 4. DATABASE INTEGRITY DURING ROLLBACK

```text
DATABASE_ROLLBACK_DESTRUCTIVE_DDL = PROHIBITED
DATA_LOSS_ON_APPLICATION_ROLLBACK = 0
```

- All R41 schema changes (`assistant_pending_actions`, `assistant_safe_action_audit`, and associated indexes) are strictly additive (`CREATE TABLE IF NOT EXISTS`).
- Prior releases (`arkpet-v19`, R39, R40) ignore the existence of these additional tables without errors or incompatibility.
- **Do NOT drop tables or revert schema migrations during application rollback.** Existing booking, pet, and user data will remain completely intact.
