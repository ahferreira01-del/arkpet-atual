import { db } from "@workspace/db";
import { crechesTable, financialAuditLogsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";

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
