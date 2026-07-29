## Booking Module Constraints\n- NEVER revert \src/pages/bookings/index.tsx\ to use a Modal for creating bookings. The booking creation logic was migrated to \/bookings/new\. Ensure the 'Nova Reserva' button always redirects to this route via \setLocation('/bookings/new')\.

## Strict Rules for Workspace Changes and Reversions

> [!IMPORTANT]
> **CRITICAL RULE FOR ALL AGENTS:**
> 1. You MUST NEVER execute commands that discard local uncommitted changes (such as `git checkout`, `git restore`, `git reset`, or similar destructive commands) on any codebase files without first checking `git diff` or `git status`.
> 2. If there are local changes, you MUST use `git stash` to preserve the user's progress temporarily, or explicitly ask the user for permission before overwriting their files.
> 3. Never downgrade component implementations, routing redirects, or pages to outdated/historical states found in older backups/commits unless explicitly instructed by the user.

## Object Storage & Upload Constraints

> [!WARNING]
> **CRITICAL RULE FOR ALL AGENTS:**
> The application's Object Storage architecture was intentionally migrated from Replit's Google Cloud Storage (GCS) sidecar to a **Local File System** architecture to resolve chronic `ECONNREFUSED` and `401 Unauthorized` errors on port 1106.
> 
> 1. You MUST NEVER revert `artifacts/api-server/src/lib/objectStorage.ts` to use `@google-cloud/storage`.
> 2. You MUST NEVER re-introduce `signObjectURL` or any logic that attempts to communicate with the Replit sidecar at `http://127.0.0.1:1106`.
> 3. The `uploadToStorage` function in the frontend (`upload.service.ts`) MUST remain configured to use the `/api/storage/uploads/direct` endpoint via XHR (which bypasses presigned URLs entirely).
> 4. All uploaded files must be saved to and served from the `artifacts/api-server/storage/` directory via Node.js `fs`.
