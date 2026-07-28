/**
 * One-time idempotent migration: promote legacy base64 mediaUrl values in
 * timeline_events to object-storage paths.
 *
 * V1 stored photos as raw base64 data URIs in the media_url column.
 * V2 filters those out so the Service Worker never crashes on a huge string,
 * which means old posts now render without their photo.
 *
 * This job:
 *   1. Finds all rows where media_url is set but does NOT start with "/objects/"
 *   2. Strips the data-URI prefix, decodes to Buffer, re-encodes as WebP
 *   3. Uploads to object storage scoped to the row's creche_id
 *   4. Updates the row's media_url to the new /objects/… path
 *
 * Safe to re-run: the WHERE clause only matches un-migrated rows.
 */

import sharp from "sharp";
import { db, timelineEventsTable } from "@workspace/db";
import { notLike, eq } from "drizzle-orm";
import { ObjectStorageService } from "./objectStorage.js";

const objectStorage = new ObjectStorageService();

/** How many rows to process per batch (avoids loading all base64 into RAM). */
const BATCH_SIZE = 20;

export async function migrateV1MediaUrls(): Promise<void> {
  let processed = 0;
  let totalFailed = 0;

  // Because successfully migrated rows disappear from the result set
  // (their media_url now starts with "/objects/"), we always query from
  // offset 0.  Only failed/skipped rows accumulate an offset so we don't
  // loop on them forever.
  let skipOffset = 0;

  while (true) {
    const rows = await db
      .select({
        id: timelineEventsTable.id,
        crecheId: timelineEventsTable.crecheId,
        mediaUrl: timelineEventsTable.mediaUrl,
        mediaType: timelineEventsTable.mediaType,
      })
      .from(timelineEventsTable)
      .where(
        // NULL LIKE … evaluates to NULL (falsy) in Postgres, so null rows are
        // automatically excluded — no explicit isNotNull guard needed.
        notLike(timelineEventsTable.mediaUrl, "/objects/%")
      )
      .limit(BATCH_SIZE)
      .offset(skipOffset);

    if (rows.length === 0) break;

    let batchFailed = 0;

    for (const row of rows) {
      const rawMediaUrl = row.mediaUrl;

      // Defensive null check (shouldn't occur given WHERE, but be safe).
      if (!rawMediaUrl) {
        batchFailed++;
        continue;
      }

      // Already migrated — shouldn't reach here due to WHERE, but skip silently.
      if (rawMediaUrl.startsWith("/objects/")) {
        continue;
      }

      try {
        if (!rawMediaUrl.startsWith("data:")) {
          // Not a data URI and not /objects/ — could be an external URL or
          // garbage.  Skip to avoid fetching arbitrary URLs.
          console.warn(
            `[migrateV1Media] row ${row.id}: unrecognised mediaUrl format, skipping`
          );
          batchFailed++;
          continue;
        }

        // Extract base64 payload from:  data:<mime>;base64,<payload>
        const commaIdx = rawMediaUrl.indexOf(",");
        if (commaIdx === -1) {
          console.warn(`[migrateV1Media] row ${row.id}: malformed data URI, skipping`);
          batchFailed++;
          continue;
        }

        const base64Payload = rawMediaUrl.slice(commaIdx + 1);
        const imageBuffer = Buffer.from(base64Payload, "base64");

        // Convert to WebP for smaller storage footprint.
        const webpBuffer = await sharp(imageBuffer)
          .webp({ quality: 80 })
          .toBuffer();

        // Upload scoped to the row's creche so the GET /storage/objects/* ACL
        // check grants access to all members of that creche.
        const objectPath = await objectStorage.uploadBuffer(
          webpBuffer,
          "image/webp",
          undefined,           // ownerId — not needed; creche-scoped ACL is sufficient
          String(row.crecheId),
        );

        // Update the row — this makes it disappear from future batches.
        await db
          .update(timelineEventsTable)
          .set({ mediaUrl: objectPath, mediaType: "photo" })
          .where(eq(timelineEventsTable.id, row.id));

        processed++;
        console.log(`[migrateV1Media] row ${row.id}: migrated → ${objectPath}`);
      } catch (err) {
        console.error(`[migrateV1Media] row ${row.id}: error —`, err);
        batchFailed++;
      }
    }

    // Advance offset only for rows that failed/were skipped so we don't
    // loop on them indefinitely while still re-querying from the top for
    // rows that haven't been attempted yet.
    totalFailed += batchFailed;
    skipOffset += batchFailed;
  }

  if (processed > 0 || totalFailed > 0) {
    console.log(
      `[migrateV1Media] done — ${processed} migrated, ${totalFailed} skipped/failed`
    );
  } else {
    console.log("[migrateV1Media] no legacy media found, nothing to migrate");
  }
}
