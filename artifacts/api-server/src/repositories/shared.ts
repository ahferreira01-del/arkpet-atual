/**
 * Utilitários compartilhados por todos os repositórios (Fase 15A).
 */

import { db } from "@workspace/db";
import { usersTable, crechesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

/** Returns the active DB client: transaction object OR the pool singleton. */
export function c(tx?: any): any {
  return tx ?? db;
}

/** Parses `page` and `pageSize` from an Express query object. */
export function getPaginationParams(query: Record<string, any>) {
  const page = Math.max(1, parseInt(String(query.page ?? "1")));
  const pageSize = Math.min(100, Math.max(1, parseInt(String(query.pageSize ?? "20"))));
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

/**
 * Returns the mensalidadeDia for a tutor.
 * Used by BillingService.getCycleDates to determine the billing cycle.
 */
export async function getTutorMensalidadeDia(
  tutorId: number,
  tx?: any
): Promise<number | null | undefined> {
  const [tutor] = await c(tx)
    .select({ mensalidadeDia: usersTable.mensalidadeDia })
    .from(usersTable)
    .where(eq(usersTable.id, tutorId));
  return tutor?.mensalidadeDia;
}

/**
 * Returns admin email + name + creche name for low-stock email alerts.
 */
export async function getCrecheAdminEmail(
  crecheId: number,
  tx?: any
): Promise<{ email: string; name: string; crecheName: string } | null> {
  const [admin] = await c(tx)
    .select({ email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(and(eq(usersTable.crecheId, crecheId), eq(usersTable.role, "creche_admin")))
    .limit(1);
  if (!admin) return null;

  const [creche] = await c(tx)
    .select({ name: crechesTable.name })
    .from(crechesTable)
    .where(eq(crechesTable.id, crecheId))
    .limit(1);
  if (!creche) return null;

  return { email: admin.email, name: admin.name, crecheName: creche.name };
}
