import { db } from "@workspace/db";
import { expensesTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { c } from "./shared.js";

export class ExpenseRepository {
  static async list(crecheId: number, tx?: any) {
    return c(tx)
      .select()
      .from(expensesTable)
      .where(eq(expensesTable.crecheId, crecheId))
      .orderBy(desc(expensesTable.dueDate));
  }

  static async findByIdAndCreche(id: number, crecheId: number, tx?: any) {
    const [r] = await c(tx)
      .select()
      .from(expensesTable)
      .where(and(eq(expensesTable.id, id), eq(expensesTable.crecheId, crecheId)));
    return r ?? null;
  }

  static async create(
    values: typeof expensesTable.$inferInsert,
    tx?: any
  ): Promise<typeof expensesTable.$inferSelect> {
    const [r] = await c(tx).insert(expensesTable).values(values).returning();
    return r;
  }

  static async update(
    id: number,
    crecheId: number,
    values: Partial<typeof expensesTable.$inferInsert>,
    tx?: any
  ) {
    const [r] = await c(tx)
      .update(expensesTable)
      .set(values)
      .where(and(eq(expensesTable.id, id), eq(expensesTable.crecheId, crecheId)))
      .returning();
    return r ?? null;
  }

  static async delete(id: number, crecheId: number, tx?: any): Promise<void> {
    await c(tx)
      .delete(expensesTable)
      .where(and(eq(expensesTable.id, id), eq(expensesTable.crecheId, crecheId)));
  }

  /** Atomically marks expense as paid (only if not already paid). */
  static async markPaid(
    id: number,
    crecheId: number,
    tx: any
  ): Promise<typeof expensesTable.$inferSelect | null> {
    const [r] = await tx
      .update(expensesTable)
      .set({ isPaid: true, paidDate: new Date().toISOString().split("T")[0] })
      .where(
        and(
          eq(expensesTable.id, id),
          eq(expensesTable.crecheId, crecheId),
          eq(expensesTable.isPaid, false)
        )
      )
      .returning();
    return r ?? null;
  }
}
