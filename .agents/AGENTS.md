## Booking Module Constraints\n- NEVER revert \src/pages/bookings/index.tsx\ to use a Modal for creating bookings. The booking creation logic was migrated to \/bookings/new\. Ensure the 'Nova Reserva' button always redirects to this route via \setLocation('/bookings/new')\.

## Strict Rules for Workspace Changes and Reversions

> [!IMPORTANT]
> **CRITICAL RULE FOR ALL AGENTS:**
> 1. You MUST NEVER execute commands that discard local uncommitted changes (such as `git checkout`, `git restore`, `git reset`, or similar destructive commands) on any codebase files without first checking `git diff` or `git status`.
> 2. If there are local changes, you MUST use `git stash` to preserve the user's progress temporarily, or explicitly ask the user for permission before overwriting their files.
> 3. Never downgrade component implementations, routing redirects, or pages to outdated/historical states found in older backups/commits unless explicitly instructed by the user.
