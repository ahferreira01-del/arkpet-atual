import {
  crechesTable,
  storageFilesTable,
  tenantStorageLedgerTable,
} from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

export interface GcsObjectItem {
  name: string;
  size?: number | string | null;
  contentType?: string | null;
  metadata?: Record<string, any>;
}

export interface GcsInventoryProvider {
  listObjects(prefix?: string): AsyncIterable<GcsObjectItem> | Promise<GcsObjectItem[]>;
}

export type InventoryCategory =
  | "MAPPED"
  | "TENANT_MAPPED_ENTITY_UNKNOWN"
  | "TENANT_UNKNOWN"
  | "MISSING_METADATA"
  | "DUPLICATE";

export interface InventoryReport {
  scanStartedAt: string;
  scanCompletedAt: string;
  mode: "dry-run" | "backfill";
  totalObjects: number;
  totalPhysicalBytes: number;
  categories: {
    MAPPED: { count: number; bytes: number };
    TENANT_MAPPED_ENTITY_UNKNOWN: { count: number; bytes: number };
    TENANT_UNKNOWN: { count: number; bytes: number };
    MISSING_METADATA: { count: number; bytes: number };
    DUPLICATE: { count: number; bytes: number };
  };
  tenants: Record<number, { count: number; bytes: number }>;
  existingMappedCount: number;
  newBackfilledCount: number;
  duplicateKeysSkipped: number;
  tenantUnknownCount: number;
  missingMetadataCount: number;
  databaseBytesAdded: number;
  databaseFilesAdded: number;
  enforceReady: boolean;
}

export interface RunInventoryOptions {
  mode?: "dry-run" | "backfill";
  bucketName?: string;
  prefix?: string;
  provider?: GcsInventoryProvider;
  items?: GcsObjectItem[];
  db?: any;
}

const TENANT_LIFECYCLE_ADVISORY_NAMESPACE = -9812;

/**
 * Normalizes GCS object name to canonical file_key.
 */
export function normalizeFileKey(name: string): string {
  if (!name || typeof name !== "string") return "";
  return name.trim().replace(/^\/+/, "");
}

/**
 * Extracts crecheId from a file key if structured under tenant hierarchy:
 * - uploads/c<crecheId>/...
 * - objects/uploads/c<crecheId>/...
 * - c<crecheId>/...
 */
export function extractTenantIdFromKey(fileKey: string): number | null {
  const match =
    fileKey.match(/(?:^|\/)(?:objects\/)?uploads\/c([1-9]\d*)\//) ||
    fileKey.match(/(?:^|\/)c([1-9]\d*)\//);
  if (!match) return null;
  const id = parseInt(match[1], 10);
  return Number.isNaN(id) || id <= 0 ? null : id;
}

/**
 * Validates physical byte size.
 * Returns positive integer or null if metadata is missing or non-positive.
 */
export function validateObjectSizeBytes(size: unknown): number | null {
  if (size === undefined || size === null || size === "") return null;
  const num = Number(size);
  if (isNaN(num) || !Number.isInteger(num) || num <= 0) return null;
  return num;
}

/**
 * Executes historical GCS storage inventory and optional atomic tenant backfill.
 * - GCS operations are strictly READ ONLY (list & metadata only).
 * - dry-run performs ZERO database mutations.
 * - backfill mutates only database storage accounting tables under tenant operational lock.
 */
export async function runStorageInventory(
  options: RunInventoryOptions = {},
): Promise<InventoryReport> {
  const mode = options.mode === "backfill" ? "backfill" : "dry-run";
  let db = options.db;
  if (!db) {
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
  }
  const scanStartedAt = new Date().toISOString();

  const report: InventoryReport = {
    scanStartedAt,
    scanCompletedAt: "",
    mode,
    totalObjects: 0,
    totalPhysicalBytes: 0,
    categories: {
      MAPPED: { count: 0, bytes: 0 },
      TENANT_MAPPED_ENTITY_UNKNOWN: { count: 0, bytes: 0 },
      TENANT_UNKNOWN: { count: 0, bytes: 0 },
      MISSING_METADATA: { count: 0, bytes: 0 },
      DUPLICATE: { count: 0, bytes: 0 },
    },
    tenants: {},
    existingMappedCount: 0,
    newBackfilledCount: 0,
    duplicateKeysSkipped: 0,
    tenantUnknownCount: 0,
    missingMetadataCount: 0,
    databaseBytesAdded: 0,
    databaseFilesAdded: 0,
    enforceReady: false,
  };

  // Resolve object source
  let objects: GcsObjectItem[] = [];
  if (options.items) {
    objects = options.items;
  } else if (options.provider) {
    const res = options.provider.listObjects(options.prefix);
    if (Symbol.asyncIterator in res) {
      for await (const item of res as AsyncIterable<GcsObjectItem>) {
        objects.push(item);
      }
    } else {
      objects = await (res as Promise<GcsObjectItem[]>);
    }
  } else {
    // Default GCS client loader
    try {
      const { Storage } = await import("@google-cloud/storage");
      const storage = new Storage();
      const bucketName = options.bucketName || process.env.GCS_BUCKET_NAME || process.env.PRIVATE_OBJECT_DIR?.split("/")[1];
      if (!bucketName) {
        throw new Error("GCS bucket name not configured. Set GCS_BUCKET_NAME or pass --bucket.");
      }
      const [files] = await storage.bucket(bucketName).getFiles({ prefix: options.prefix });
      objects = files.map((f: any) => ({
        name: f.name,
        size: f.metadata?.size,
        contentType: f.metadata?.contentType,
        metadata: f.metadata,
      }));
    } catch (err: any) {
      if (options.mode === "backfill" || process.env.NODE_ENV === "production") {
        throw err;
      }
      console.warn(`[inventory] Warning: could not initialize live GCS client (${err.message}). Running with empty object stream.`);
      objects = [];
    }
  }

  report.totalObjects = objects.length;
  const seenFileKeys = new Set<string>();

  for (const obj of objects) {
    const rawKey = obj.name;
    const fileKey = normalizeFileKey(rawKey);

    // 1. Deduplication on physical identity (file_key)
    if (seenFileKeys.has(fileKey)) {
      report.categories.DUPLICATE.count++;
      report.duplicateKeysSkipped++;
      const sizeBytes = validateObjectSizeBytes(obj.size);
      if (sizeBytes !== null) {
        report.categories.DUPLICATE.bytes += sizeBytes;
      }
      continue;
    }
    seenFileKeys.add(fileKey);

    // 2. Validate physical size metadata
    const sizeBytes = validateObjectSizeBytes(obj.size);
    if (sizeBytes === null) {
      report.categories.MISSING_METADATA.count++;
      report.missingMetadataCount++;
      // Bytes remain 0 (never guess or insert 0 bytes)
      continue;
    }

    report.totalPhysicalBytes += sizeBytes;

    // 3. Resolve tenant identity
    const crecheId = extractTenantIdFromKey(fileKey);
    if (!crecheId) {
      report.categories.TENANT_UNKNOWN.count++;
      report.categories.TENANT_UNKNOWN.bytes += sizeBytes;
      report.tenantUnknownCount++;
      continue;
    }

    // Verify tenant exists in database
    const [creche] = await db
      .select({ id: crechesTable.id })
      .from(crechesTable)
      .where(eq(crechesTable.id, crecheId))
      .limit(1);

    if (!creche) {
      report.categories.TENANT_UNKNOWN.count++;
      report.categories.TENANT_UNKNOWN.bytes += sizeBytes;
      report.tenantUnknownCount++;
      continue;
    }

    // 4. Check if object is already MAPPED in storage_files
    const [existingFile] = await db
      .select({ id: storageFilesTable.id })
      .from(storageFilesTable)
      .where(eq(storageFilesTable.fileKey, fileKey))
      .limit(1);

    if (existingFile) {
      report.categories.MAPPED.count++;
      report.categories.MAPPED.bytes += sizeBytes;
      report.existingMappedCount++;

      report.tenants[crecheId] = report.tenants[crecheId] || { count: 0, bytes: 0 };
      report.tenants[crecheId].count++;
      report.tenants[crecheId].bytes += sizeBytes;
      continue;
    }

    // 5. TENANT_MAPPED_ENTITY_UNKNOWN
    report.categories.TENANT_MAPPED_ENTITY_UNKNOWN.count++;
    report.categories.TENANT_MAPPED_ENTITY_UNKNOWN.bytes += sizeBytes;

    report.tenants[crecheId] = report.tenants[crecheId] || { count: 0, bytes: 0 };
    report.tenants[crecheId].count++;
    report.tenants[crecheId].bytes += sizeBytes;

    if (mode === "backfill") {
      // Atomic transactional backfill under tenant operational advisory lock
      try {
        await db.transaction(async (tx: any) => {
          // Shared advisory lock for tenant namespace
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock_shared(${TENANT_LIFECYCLE_ADVISORY_NAMESPACE}, ${crecheId})`
          );

          // Ensure tenant ledger exists
          await tx.execute(sql`
            INSERT INTO tenant_storage_ledger (creche_id, used_bytes, reserved_bytes, file_count, updated_at)
            VALUES (${crecheId}, 0, 0, 0, NOW())
            ON CONFLICT (creche_id) DO NOTHING
          `);

          // Re-check file_key absence inside lock to guarantee idempotency
          const [recheck] = await tx
            .select({ id: storageFilesTable.id })
            .from(storageFilesTable)
            .where(eq(storageFilesTable.fileKey, fileKey))
            .limit(1);

          if (!recheck) {
            const insertResult = await tx
              .insert(storageFilesTable)
              .values({
                crecheId,
                fileKey,
                sizeBytes,
                contentType: obj.contentType || "application/octet-stream",
                status: "confirmed",
                confirmedAt: new Date(),
                updatedAt: new Date(),
              })
              .onConflictDoNothing({ target: storageFilesTable.fileKey })
              .returning({ id: storageFilesTable.id });

            if (insertResult && insertResult.length > 0) {
              await tx.execute(sql`
                UPDATE tenant_storage_ledger
                SET used_bytes = used_bytes + ${sizeBytes},
                    file_count = file_count + 1,
                    updated_at = NOW()
                WHERE creche_id = ${crecheId}
              `);

              report.databaseBytesAdded += sizeBytes;
              report.databaseFilesAdded += 1;
              report.newBackfilledCount += 1;
            }
          }
        });
      } catch (err: any) {
        // Defensive handling of concurrent collision (SQLSTATE 23505: unique_violation)
        if (
          err?.code === "23505" ||
          err?.routine === "ExecConstraints" ||
          err?.message?.includes("23505") ||
          err?.message?.includes("storage_files_file_key_unique")
        ) {
          // Benign concurrent collision: another worker mapped this file_key concurrently
          // Zero ledger inflation, zero unhandled crash
        } else {
          throw err;
        }
      }
    }
  }

  // Enforce readiness gate: no unresolved unknown tenant or missing metadata
  report.enforceReady = report.tenantUnknownCount === 0 && report.missingMetadataCount === 0;
  report.scanCompletedAt = new Date().toISOString();

  return report;
}

export function printInventoryReport(report: InventoryReport): void {
  console.log("=====================================================================");
  console.log("ARKPET HISTORICAL GCS STORAGE INVENTORY REPORT");
  console.log("=====================================================================");
  console.log(`Scan Started At:      ${report.scanStartedAt}`);
  console.log(`Scan Completed At:    ${report.scanCompletedAt}`);
  console.log(`Execution Mode:       ${report.mode.toUpperCase()}`);
  console.log(`Total Objects:        ${report.totalObjects}`);
  console.log(`Total Physical Bytes: ${report.totalPhysicalBytes} (${(report.totalPhysicalBytes / (1024 * 1024)).toFixed(2)} MB)`);
  console.log("---------------------------------------------------------------------");
  console.log("CLASSIFICATION BREAKDOWN:");
  console.log(`  MAPPED:                       ${report.categories.MAPPED.count} files, ${report.categories.MAPPED.bytes} bytes`);
  console.log(`  TENANT_MAPPED_ENTITY_UNKNOWN: ${report.categories.TENANT_MAPPED_ENTITY_UNKNOWN.count} files, ${report.categories.TENANT_MAPPED_ENTITY_UNKNOWN.bytes} bytes`);
  console.log(`  TENANT_UNKNOWN:               ${report.categories.TENANT_UNKNOWN.count} files, ${report.categories.TENANT_UNKNOWN.bytes} bytes`);
  console.log(`  MISSING_METADATA:             ${report.categories.MISSING_METADATA.count} files, ${report.categories.MISSING_METADATA.bytes} bytes`);
  console.log(`  DUPLICATE (skipped):          ${report.categories.DUPLICATE.count} files, ${report.categories.DUPLICATE.bytes} bytes`);
  console.log("---------------------------------------------------------------------");
  console.log("DATABASE MUTATIONS:");
  console.log(`  Existing Mapped:              ${report.existingMappedCount}`);
  console.log(`  New Backfilled:               ${report.newBackfilledCount}`);
  console.log(`  Database Files Added:         ${report.databaseFilesAdded}`);
  console.log(`  Database Bytes Added:         ${report.databaseBytesAdded}`);
  console.log("---------------------------------------------------------------------");
  console.log(`ENFORCE READINESS:    ${report.enforceReady ? "READY (Sign-off permissible)" : "BLOCKED (Unresolved items present)"}`);
  console.log("=====================================================================");
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith("inventory_gcs_storage.ts")) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: pnpm run inventory:storage [--dry-run | --backfill] [--bucket <name>]");
    console.log("");
    console.log("Options:");
    console.log("  --dry-run   (default) Audit inventory without mutating the database");
    console.log("  --backfill  Persist confirmed rows for unmapped tenant files and increment ledger");
    console.log("  --bucket    Specify GCS bucket name (overrides GCS_BUCKET_NAME env var)");
    console.log("  --help, -h  Show this help message");
    process.exit(0);
  }

  const isBackfill = args.includes("--backfill");
  const mode = isBackfill ? "backfill" : "dry-run";
  const bucketArgIdx = args.indexOf("--bucket");
  const bucketName = bucketArgIdx !== -1 ? args[bucketArgIdx + 1] : undefined;

  runStorageInventory({ mode, bucketName })
    .then((report) => {
      printInventoryReport(report);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[inventory] Fatal error during storage inventory:", err);
      process.exit(1);
    });
}
