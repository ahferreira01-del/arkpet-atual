import { db } from "@workspace/db";
import {
  invoicesTable,
  invoiceItemsTable,
  usersTable,
  petsTable,
} from "@workspace/db/schema";
import { eq, and, or, desc, asc, count, sql } from "drizzle-orm";
import { c } from "./shared.js";

export class InvoiceRepository {
  // ── Invoice reads ────────────────────────────────────────────────────────

  static async findById(id: number, tx?: any) {
    const [r] = await c(tx).select().from(invoicesTable).where(eq(invoicesTable.id, id));
    return r ?? null;
  }

  static async findByIdAndCreche(id: number, crecheId: number, tx?: any) {
    const [r] = await c(tx)
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.crecheId, crecheId)));
    return r ?? null;
  }

  /** Requires tx — FOR UPDATE prevents concurrent payment races. */
  static async findByIdAndCrecheForUpdate(id: number, crecheId: number, tx: any) {
    const [r] = await tx
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.crecheId, crecheId)))
      .for("update");
    return r ?? null;
  }

  /** Requires tx — FOR UPDATE (Stripe webhook idempotency). */
  static async findByIdForUpdate(id: number, tx: any) {
    const [r] = await tx
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.id, id))
      .for("update");
    return r ?? null;
  }

  /** Finds the monthly cycle invoice for a tutor, with FOR UPDATE. Requires tx. */
  static async findByCycleForUpdate(
    tutorId: number,
    cycleStart: string,
    cycleEnd: string,
    tx: any
  ) {
    const [r] = await tx
      .select()
      .from(invoicesTable)
      .where(
        and(
          eq(invoicesTable.tutorId, tutorId),
          eq(invoicesTable.cycleStart, cycleStart),
          eq(invoicesTable.cycleEnd, cycleEnd)
        )
      )
      .for("update");
    return r ?? null;
  }

  /** Returns true if tutor has any pending-past-due or overdue invoice. */
  static async hasOverdue(tutorId: number, tx?: any): Promise<boolean> {
    const todayStr = new Date().toISOString().split("T")[0];
    const [r] = await c(tx)
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(
        and(
          eq(invoicesTable.tutorId, tutorId),
          or(
            eq(invoicesTable.status, "overdue"),
            and(
              eq(invoicesTable.status, "pending"),
              sql`${invoicesTable.dueDate} < ${todayStr}`
            )
          )
        )
      )
      .limit(1);
    return !!r;
  }

  /** Paginated list, optionally filtered by tutorId. */
  static async listByCreche(
    crecheId: number,
    tutorId: number | null,
    pageSize: number,
    offset: number,
    tx?: any
  ) {
    const cond = tutorId
      ? and(eq(invoicesTable.crecheId, crecheId), eq(invoicesTable.tutorId, tutorId))
      : eq(invoicesTable.crecheId, crecheId);

    const [data, [{ total }]] = await Promise.all([
      c(tx)
        .select({
          id: invoicesTable.id,
          amount: invoicesTable.amount,
          status: invoicesTable.status,
          dueDate: invoicesTable.dueDate,
          tutorId: invoicesTable.tutorId,
          tutorName: usersTable.name,
          createdAt: invoicesTable.createdAt,
          paymentMethod: invoicesTable.paymentMethod,
          receiptPhotoPath: invoicesTable.receiptPhotoPath,
        })
        .from(invoicesTable)
        .leftJoin(usersTable, eq(invoicesTable.tutorId, usersTable.id))
        .where(cond)
        .orderBy(desc(invoicesTable.createdAt))
        .limit(pageSize)
        .offset(offset),
      c(tx).select({ total: count() }).from(invoicesTable).where(cond),
    ]);
    return { data, total: Number(total) };
  }

  /** Returns invoice + tutor info for printable receipt. */
  static async findReceiptData(invoiceId: number, crecheId: number, tx?: any) {
    const [r] = await c(tx)
      .select({
        invoice: invoicesTable,
        tutorName: usersTable.name,
        tutorCpf: usersTable.cpf,
      })
      .from(invoicesTable)
      .leftJoin(usersTable, eq(invoicesTable.tutorId, usersTable.id))
      .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.crecheId, crecheId)));
    return r ?? null;
  }

  // ── Invoice writes ───────────────────────────────────────────────────────

  static async create(
    values: typeof invoicesTable.$inferInsert,
    tx?: any
  ): Promise<typeof invoicesTable.$inferSelect> {
    const [r] = await c(tx).insert(invoicesTable).values(values).returning();
    return r;
  }

  static async setAmount(id: number, amount: string, tx?: any): Promise<void> {
    await c(tx)
      .update(invoicesTable)
      .set({ amount, updatedAt: new Date() })
      .where(eq(invoicesTable.id, id));
  }

  static async markPaid(id: number, paymentMethod: string, tx?: any): Promise<void> {
    await c(tx)
      .update(invoicesTable)
      .set({ status: "paid", paymentMethod: paymentMethod as any, updatedAt: new Date() })
      .where(eq(invoicesTable.id, id));
  }

  static async markPaidImmediate(id: number, tx?: any): Promise<void> {
    await c(tx)
      .update(invoicesTable)
      .set({ status: "paid" })
      .where(eq(invoicesTable.id, id));
  }

  static async markVoided(id: number, tx?: any): Promise<void> {
    await c(tx)
      .update(invoicesTable)
      .set({ status: "voided", updatedAt: new Date() })
      .where(eq(invoicesTable.id, id));
  }

  static async markRefunded(id: number, tx?: any): Promise<void> {
    await c(tx)
      .update(invoicesTable)
      .set({ status: "refunded", updatedAt: new Date() })
      .where(eq(invoicesTable.id, id));
  }

  static async markAwaitingConfirmation(
    id: number,
    receiptPhotoPath: string,
    tx?: any
  ): Promise<void> {
    await c(tx)
      .update(invoicesTable)
      .set({ receiptPhotoPath, status: "awaiting_confirmation", updatedAt: new Date() })
      .where(eq(invoicesTable.id, id));
  }

  static async markCreditsReleased(id: number, tx?: any): Promise<void> {
    await c(tx)
      .update(invoicesTable)
      .set({ creditsReleased: true })
      .where(eq(invoicesTable.id, id));
  }

  static async setStripePaymentIntent(id: number, intentId: string, tx?: any): Promise<void> {
    await c(tx)
      .update(invoicesTable)
      .set({ stripePaymentIntentId: intentId })
      .where(eq(invoicesTable.id, id));
  }

  // ── Invoice Items ────────────────────────────────────────────────────────

  static async createItem(
    values: typeof invoiceItemsTable.$inferInsert,
    tx?: any
  ): Promise<void> {
    await c(tx).insert(invoiceItemsTable).values(values);
  }

  static async findItemsByInvoiceId(invoiceId: number, tx?: any) {
    return c(tx)
      .select()
      .from(invoiceItemsTable)
      .where(eq(invoiceItemsTable.invoiceId, invoiceId));
  }

  static async findItemsWithPetNames(invoiceId: number, tx?: any) {
    return c(tx)
      .select({
        id: invoiceItemsTable.id,
        description: invoiceItemsTable.description,
        quantity: invoiceItemsTable.quantity,
        amount: invoiceItemsTable.amount,
        itemDate: invoiceItemsTable.itemDate,
        itemType: invoiceItemsTable.itemType,
        petId: invoiceItemsTable.petId,
        petName: petsTable.name,
      })
      .from(invoiceItemsTable)
      .leftJoin(petsTable, eq(invoiceItemsTable.petId, petsTable.id))
      .where(eq(invoiceItemsTable.invoiceId, invoiceId))
      .orderBy(asc(invoiceItemsTable.itemDate), asc(invoiceItemsTable.id));
  }

  static async findItemById(itemId: number, invoiceId: number, tx?: any) {
    const [r] = await c(tx)
      .select()
      .from(invoiceItemsTable)
      .where(and(eq(invoiceItemsTable.id, itemId), eq(invoiceItemsTable.invoiceId, invoiceId)));
    return r ?? null;
  }

  static async updateItemQuantity(itemId: number, qty: number, tx?: any): Promise<void> {
    await c(tx)
      .update(invoiceItemsTable)
      .set({ quantity: qty })
      .where(eq(invoiceItemsTable.id, itemId));
  }

  static async deleteItem(itemId: number, tx?: any): Promise<void> {
    await c(tx).delete(invoiceItemsTable).where(eq(invoiceItemsTable.id, itemId));
  }
}
