import { db } from "@workspace/db";
import { transactionsTable } from "@workspace/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { c } from "./shared.js";

export class TransactionRepository {
  static async create(
    values: typeof transactionsTable.$inferInsert,
    tx?: any
  ): Promise<typeof transactionsTable.$inferSelect> {
    const [r] = await c(tx).insert(transactionsTable).values(values).returning();
    return r;
  }

  /** Aggregates daily cash flow (income + expense) for a date range. */
  static async getCashFlow(
    crecheId: number,
    startDate: string,
    endDate: string,
    tx?: any
  ) {
    return c(tx)
      .select({
        date: transactionsTable.transactionDate,
        type: transactionsTable.type,
        total: sql<number>`SUM(${transactionsTable.amount})::numeric`,
      })
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.crecheId, crecheId),
          gte(transactionsTable.transactionDate, startDate),
          lte(transactionsTable.transactionDate, endDate)
        )
      )
      .groupBy(transactionsTable.transactionDate, transactionsTable.type)
      .orderBy(transactionsTable.transactionDate);
  }

  /** Aggregates total income and expense for a DRE. */
  static async getDRE(
    crecheId: number,
    startDate: string,
    endDate: string,
    tx?: any
  ) {
    return c(tx)
      .select({
        type: transactionsTable.type,
        total: sql<number>`SUM(${transactionsTable.amount})::numeric`,
      })
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.crecheId, crecheId),
          gte(transactionsTable.transactionDate, startDate),
          lte(transactionsTable.transactionDate, endDate)
        )
      )
      .groupBy(transactionsTable.type);
  }
}
