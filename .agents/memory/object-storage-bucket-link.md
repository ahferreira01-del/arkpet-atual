---
name: Object storage bucket link
description: Sidecar 401 "no allowed resources" root cause and fix for GCS uploads
---
Sidecar (127.0.0.1:1106) returning 401 "no allowed resources" for /token and /object-storage/signed-object-url means the Repl's identity has no object-storage claim — NOT a code bug.

**Why:** the `[objectStorage] defaultBucketID = "..."` section in `.replit` is what authorizes the container/deployment identity for the bucket. Secrets (DEFAULT_OBJECT_STORAGE_BUCKET_ID etc.) alone are not enough; setupObjectStorage() reports alreadySetUp just because secrets exist.

**How to apply:** verify with `curl http://127.0.0.1:1106/object-storage/default-bucket` (empty bucketId = missing link). Restore the section in `.replit`. Identities are minted at container boot — dev workspace needs a reload and production needs a republish before signing works; waiting does not refresh it. Also note: the storage service's catch-all converts auth errors into ObjectNotFoundError, so "Object not found" logs can mask auth failures.

**Update (Aug 2026):** old bucket was never owned by this Repl; user created a fresh bucket via the App Storage pane (ID replit-objstore-fd9e0fa7-...). The 3 storage secrets are stale (old bucket) and agent cannot delete secrets — so objectStorage.ts now resolves the bucket at runtime from the sidecar `/object-storage/default-bucket` (bucketInit promise) and ignores the env secrets when the sidecar answers. Roundtrip upload/download verified in dev.
