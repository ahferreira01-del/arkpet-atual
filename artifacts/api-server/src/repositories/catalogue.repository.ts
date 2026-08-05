import { db } from "@workspace/db";
import {
  catalogueItemsTable,
  catalogueStockTransactionsTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, and, ne, desc, count, sql } from "drizzle-orm";
import { c } from "./shared.js";

export class CatalogueRepository {
  // ── Catalogue items ──────────────────────────────────────────────────────

  /** Finds a catalogue item by ID only (cross-creche, e.g. credit release fallback). */
  static async findById(id: number, tx?: any) {
    const [r] = await c(tx)
      .select()
      .from(catalogueItemsTable)
      .where(eq(catalogueItemsTable.id, id));
    return r ?? null;
  }

  static async list(crecheId: number, includeInactive: boolean, tx?: any) {
    return c(tx)
      .select()
      .from(catalogueItemsTable)
      .where(
        includeInactive
          ? eq(catalogueItemsTable.crecheId, crecheId)
          : and(
              eq(catalogueItemsTable.crecheId, crecheId),
              eq(catalogueItemsTable.isActive, true)
            )
      );
  }

  static async findByIdAndCreche(id: number, crecheId: number, tx?: any) {
    const [r] = await c(tx)
      .select()
      .from(catalogueItemsTable)
      .where(and(eq(catalogueItemsTable.id, id), eq(catalogueItemsTable.crecheId, crecheId)));
    return r ?? null;
  }

  static async findByIdAndCrecheForUpdate(id: number, crecheId: number, tx: any) {
    const [r] = await tx
      .select()
      .from(catalogueItemsTable)
      .where(and(eq(catalogueItemsTable.id, id), eq(catalogueItemsTable.crecheId, crecheId)))
      .for("update");
    return r ?? null;
  }

  /** Finds an active item (with optional lock) for POS sale. */
  static async findActiveForUpdate(id: number, crecheId: number, tx: any) {
    const [r] = await tx
      .select()
      .from(catalogueItemsTable)
      .where(
        and(
          eq(catalogueItemsTable.id, id),
          eq(catalogueItemsTable.crecheId, crecheId),
          eq(catalogueItemsTable.isActive, true)
        )
      )
      .for("update");
    return r ?? null;
  }

  /** Finds a package item by ID for purchase flow. */
  static async findPackage(id: number, crecheId: number, tx?: any) {
    const [r] = await c(tx)
      .select()
      .from(catalogueItemsTable)
      .where(
        and(
          eq(catalogueItemsTable.id, id),
          eq(catalogueItemsTable.crecheId, crecheId),
          eq(catalogueItemsTable.type, "package"),
          eq(catalogueItemsTable.isActive, true)
        )
      );
    return r ?? null;
  }

  /** Finds any item with the given name in the creche (legacy credit-release fallback). */
  static async findByNameAndCreche(crecheId: number, name: string, tx?: any) {
    const [r] = await c(tx)
      .select()
      .from(catalogueItemsTable)
      .where(and(eq(catalogueItemsTable.crecheId, crecheId), eq(catalogueItemsTable.name, name)))
      .limit(1);
    return r ?? null;
  }

  /** Finds a service-type item by name (legacy credit-release fallback). */
  static async findServiceByNameAndCreche(crecheId: number, name: string, tx?: any) {
    const [r] = await c(tx)
      .select()
      .from(catalogueItemsTable)
      .where(
        and(
          eq(catalogueItemsTable.crecheId, crecheId),
          eq(catalogueItemsTable.name, name),
          eq(catalogueItemsTable.type, "service")
        )
      )
      .limit(1);
    return r ?? null;
  }

  /** Checks if another active item in the same creche has the same name. */
  static async findActiveByName(
    crecheId: number,
    name: string,
    excludeId?: number,
    tx?: any
  ) {
    const cond = excludeId
      ? and(
          eq(catalogueItemsTable.crecheId, crecheId),
          eq(catalogueItemsTable.name, name),
          eq(catalogueItemsTable.isActive, true),
          ne(catalogueItemsTable.id, excludeId)
        )
      : and(
          eq(catalogueItemsTable.crecheId, crecheId),
          eq(catalogueItemsTable.name, name),
          eq(catalogueItemsTable.isActive, true)
        );
    const [r] = await c(tx).select({ id: catalogueItemsTable.id }).from(catalogueItemsTable).where(cond).limit(1);
    return r ?? null;
  }

  static async create(
    values: typeof catalogueItemsTable.$inferInsert,
    tx?: any
  ): Promise<typeof catalogueItemsTable.$inferSelect> {
    const [r] = await c(tx).insert(catalogueItemsTable).values(values).returning();
    return r;
  }

  static async update(
    id: number,
    crecheId: number,
    values: Partial<typeof catalogueItemsTable.$inferInsert>,
    tx?: any
  ) {
    const [r] = await c(tx)
      .update(catalogueItemsTable)
      .set(values)
      .where(and(eq(catalogueItemsTable.id, id), eq(catalogueItemsTable.crecheId, crecheId)))
      .returning();
    return r ?? null;
  }

  static async delete(id: number, crecheId: number, tx?: any): Promise<void> {
    await c(tx)
      .delete(catalogueItemsTable)
      .where(and(eq(catalogueItemsTable.id, id), eq(catalogueItemsTable.crecheId, crecheId)));
  }

  static async decrementStock(id: number, qty: number, tx?: any): Promise<void> {
    await c(tx)
      .update(catalogueItemsTable)
      .set({ stockQuantity: sql`${catalogueItemsTable.stockQuantity} - ${qty}` })
      .where(eq(catalogueItemsTable.id, id));
  }

  static async incrementStock(id: number, qty: number, tx?: any): Promise<void> {
    await c(tx)
      .update(catalogueItemsTable)
      .set({ stockQuantity: sql`${catalogueItemsTable.stockQuantity} + ${qty}` })
      .where(eq(catalogueItemsTable.id, id));
  }

  /** Applies a signed delta to stock; returns the updated row. Caller checks for negative. */
  static async applyDeltaStock(
    id: number,
    crecheId: number,
    delta: number,
    tx: any
  ): Promise<typeof catalogueItemsTable.$inferSelect> {
    const [r] = await tx
      .update(catalogueItemsTable)
      .set({ stockQuantity: sql`${catalogueItemsTable.stockQuantity} + ${delta}` })
      .where(and(eq(catalogueItemsTable.id, id), eq(catalogueItemsTable.crecheId, crecheId)))
      .returning();
    return r;
  }

  // ── Stock transactions ───────────────────────────────────────────────────

  static async createStockTransaction(
    values: typeof catalogueStockTransactionsTable.$inferInsert,
    tx?: any
  ): Promise<void> {
    await c(tx).insert(catalogueStockTransactionsTable).values(values);
  }

  static async createStockTransactionBatch(
    values: (typeof catalogueStockTransactionsTable.$inferInsert)[],
    tx?: any
  ): Promise<void> {
    if (values.length === 0) return;
    await c(tx).insert(catalogueStockTransactionsTable).values(values);
  }

  static async listStockTransactions(
    itemId: number,
    crecheId: number,
    pageSize: number,
    offset: number,
    tx?: any
  ) {
    const [data, [{ cnt }]] = await Promise.all([
      c(tx)
        .select({
          id: catalogueStockTransactionsTable.id,
          type: catalogueStockTransactionsTable.type,
          quantity: catalogueStockTransactionsTable.quantity,
          reason: catalogueStockTransactionsTable.reason,
          createdAt: catalogueStockTransactionsTable.createdAt,
          userName: usersTable.name,
        })
        .from(catalogueStockTransactionsTable)
        .leftJoin(usersTable, eq(catalogueStockTransactionsTable.userId, usersTable.id))
        .where(
          and(
            eq(catalogueStockTransactionsTable.itemId, itemId),
            eq(catalogueStockTransactionsTable.crecheId, crecheId)
          )
        )
        .orderBy(desc(catalogueStockTransactionsTable.createdAt))
        .limit(pageSize)
        .offset(offset),
      c(tx)
        .select({ cnt: count() })
        .from(catalogueStockTransactionsTable)
        .where(
          and(
            eq(catalogueStockTransactionsTable.itemId, itemId),
            eq(catalogueStockTransactionsTable.crecheId, crecheId)
          )
        ),
    ]);
    return { data, total: Number(cnt) };
  }
}
