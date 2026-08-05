import { db } from "@workspace/db";
import { ordersTable, orderItemsTable } from "@workspace/db/schema";
import { eq, and, or } from "drizzle-orm";
import { c } from "./shared.js";

export class OrderRepository {
  static async create(
    values: typeof ordersTable.$inferInsert,
    tx?: any
  ): Promise<typeof ordersTable.$inferSelect> {
    const [r] = await c(tx).insert(ordersTable).values(values).returning();
    return r;
  }

  static async createItem(
    values: typeof orderItemsTable.$inferInsert,
    tx?: any
  ): Promise<void> {
    await c(tx).insert(orderItemsTable).values(values);
  }

  static async createItemBatch(
    values: (typeof orderItemsTable.$inferInsert)[],
    tx?: any
  ): Promise<void> {
    if (values.length === 0) return;
    await c(tx).insert(orderItemsTable).values(values);
  }

  static async findById(id: number, tx?: any) {
    const [r] = await c(tx).select().from(ordersTable).where(eq(ordersTable.id, id));
    return r ?? null;
  }

  static async findItemsByOrderId(orderId: number, tx?: any) {
    return c(tx)
      .select()
      .from(orderItemsTable)
      .where(eq(orderItemsTable.orderId, orderId));
  }

  /** Marks all pending_payment orders for an invoice as paid. */
  static async markPaidByInvoice(invoiceId: number, tx?: any): Promise<void> {
    await c(tx)
      .update(ordersTable)
      .set({ status: "paid" })
      .where(and(eq(ordersTable.invoiceId, invoiceId), eq(ordersTable.status, "pending_payment")));
  }

  /** Cancels pending_payment orders for an invoice. */
  static async cancelPendingByInvoice(invoiceId: number, tx?: any): Promise<void> {
    await c(tx)
      .update(ordersTable)
      .set({ status: "cancelled" })
      .where(and(eq(ordersTable.invoiceId, invoiceId), eq(ordersTable.status, "pending_payment")));
  }

  /** Cancels both pending_payment and paid orders for an invoice (used on refund). */
  static async cancelAllByInvoice(invoiceId: number, tx?: any): Promise<void> {
    await c(tx)
      .update(ordersTable)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(ordersTable.invoiceId, invoiceId),
          or(eq(ordersTable.status, "pending_payment"), eq(ordersTable.status, "paid"))
        )
      );
  }

  static async cancelById(id: number, tx?: any): Promise<void> {
    await c(tx)
      .update(ordersTable)
      .set({ status: "cancelled" })
      .where(eq(ordersTable.id, id));
  }
}
