import { db } from "@workspace/db";
import { crechesTable, financialAuditLogsTable, usersTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

type LogOptions = typeof financialAuditLogsTable.$inferInsert;

export async function logFinancialAudit(
  options: LogOptions,
  tx?: any
) {
  const runner = tx || db;

  // Check if audit is enabled
  const [creche] = await runner
    .select({ auditEnabled: crechesTable.auditEnabled })
    .from(crechesTable)
    .where(eq(crechesTable.id, options.crecheId));

  if (!creche || !creche.auditEnabled) {
    return; // Do nothing if audit is disabled
  }

  await runner.insert(financialAuditLogsTable).values(options);
}

/**
 * Returns the last 100 audit log entries for a creche, with user names joined.
 * Used by GET /audit (admin-only endpoint).
 */
export async function listAuditLogs(crecheId: number) {
  return db
    .select({
      id: financialAuditLogsTable.id,
      action: financialAuditLogsTable.action,
      referenceType: financialAuditLogsTable.referenceType,
      referenceId: financialAuditLogsTable.referenceId,
      details: financialAuditLogsTable.details,
      createdAt: financialAuditLogsTable.createdAt,
      userName: usersTable.name,
    })
    .from(financialAuditLogsTable)
    .leftJoin(usersTable, eq(financialAuditLogsTable.userId, usersTable.id))
    .where(eq(financialAuditLogsTable.crecheId, crecheId))
    .orderBy(desc(financialAuditLogsTable.createdAt))
    .limit(100);
}
