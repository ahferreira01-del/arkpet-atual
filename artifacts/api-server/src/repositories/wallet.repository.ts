/**
 * WalletRepository — read queries for the wallet/balance display.
 * Writes to tutorCredits and tutorServiceCredits go through CreditRepository.
 */

import { db } from "@workspace/db";
import {
  tutorCreditsTable,
  tutorServiceCreditsTable,
  catalogueItemsTable,
} from "@workspace/db/schema";
import { eq, and, or, isNull, gte, lt, desc, count, sql } from "drizzle-orm";
import { c } from "./shared.js";

export class WalletRepository {
  /** Fetches all non-expired, not-fully-used package credits for a tutor. */
  static async getActivePackages(tutorId: number, crecheId: number, todayStr: string, tx?: any) {
    return c(tx)
      .select()
      .from(tutorCreditsTable)
      .where(
        and(
          eq(tutorCreditsTable.tutorId, tutorId),
          eq(tutorCreditsTable.crecheId, crecheId),
          lt(tutorCreditsTable.usedCredits, tutorCreditsTable.totalCredits),
          or(
            isNull(tutorCreditsTable.expirationDate),
            gte(tutorCreditsTable.expirationDate, todayStr)
          )
        )
      )
      .orderBy(tutorCreditsTable.expirationDate);
  }

  /** Paginated list of package credits, optionally scoped to a tutor. */
  static async listPackages(
    crecheId: number,
    tutorId: number | null,
    pageSize: number,
    offset: number,
    tx?: any
  ) {
    const cond = tutorId
      ? and(eq(tutorCreditsTable.crecheId, crecheId), eq(tutorCreditsTable.tutorId, tutorId))
      : eq(tutorCreditsTable.crecheId, crecheId);

    const [data, [{ total }]] = await Promise.all([
      c(tx).select().from(tutorCreditsTable).where(cond).limit(pageSize).offset(offset),
      c(tx).select({ total: count() }).from(tutorCreditsTable).where(cond),
    ]);
    return { data, total: Number(total) };
  }

  /** Paginated list of service credits, optionally scoped to a tutor. */
  static async listServiceCredits(
    crecheId: number,
    tutorId: number | null,
    pageSize: number,
    offset: number,
    tx?: any
  ) {
    const baseCond = tutorId
      ? and(
          eq(tutorServiceCreditsTable.crecheId, crecheId),
          eq(tutorServiceCreditsTable.tutorId, tutorId),
          sql`${tutorServiceCreditsTable.usedCredits} < ${tutorServiceCreditsTable.totalCredits}`
        )
      : and(
          eq(tutorServiceCreditsTable.crecheId, crecheId),
          sql`${tutorServiceCreditsTable.usedCredits} < ${tutorServiceCreditsTable.totalCredits}`
        );

    const [data, [{ total }]] = await Promise.all([
      c(tx)
        .select({
          id: tutorServiceCreditsTable.id,
          tutorId: tutorServiceCreditsTable.tutorId,
          catalogueItemId: tutorServiceCreditsTable.catalogueItemId,
          totalCredits: tutorServiceCreditsTable.totalCredits,
          usedCredits: tutorServiceCreditsTable.usedCredits,
          createdAt: tutorServiceCreditsTable.createdAt,
          itemName: catalogueItemsTable.name,
          itemType: catalogueItemsTable.type,
        })
        .from(tutorServiceCreditsTable)
        .leftJoin(
          catalogueItemsTable,
          eq(tutorServiceCreditsTable.catalogueItemId, catalogueItemsTable.id)
        )
        .where(baseCond)
        .orderBy(desc(tutorServiceCreditsTable.createdAt))
        .limit(pageSize)
        .offset(offset),
      c(tx).select({ total: count() }).from(tutorServiceCreditsTable).where(baseCond),
    ]);
    return { data, total: Number(total) };
  }
}
