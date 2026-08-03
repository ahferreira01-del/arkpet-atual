---
name: GitHub remote divergence (Render lineage)
description: origin/master diverged — remote targets Render/Vercel with local-fs storage; do not blindly push/pull
---
origin/master (ahferreira01-del/arkpet) contains a divergent lineage made outside Replit: commits targeting Render/Vercel deployment that REVERTED objectStorage to local filesystem, plus unrelated fixes (strict MIME/realExt in uploads, feed layout, pix, receipt logo).

**Why:** the user works on the same repo with another tool. Rebasing Replit's GCS-based master onto it conflicts fundamentally (local-fs vs GCS storage).

**How to apply:** never force-push or auto-rebase to origin/master. Local Replit commits after "Published your App" (b87639d/7bfc62f era) may be unpushed. Reconciling requires a deliberate merge keeping GCS objectStorage while porting remote's MIME/realExt and frontend fixes — ask the user which lineage is canonical first.
