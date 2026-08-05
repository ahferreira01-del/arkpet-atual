/**
 * OrderService — Fase 8
 *
 * Toda a lógica de negócio de criação e cancelamento de pedidos foi extraída
 * de routes/orders.ts para este serviço. As rotas passaram a ser controllers
 * finos que apenas recebem, validam e delegam.
 *
 * Restrições:
 * - Nunca altera contratos públicos de API.
 * - Nunca altera payloads.
 * - Nunca duplica lógica existente.
 */

import { db } from "@workspace/db";
import {
  ordersTable,
  orderItemsTable,
  catalogueItemsTable,
  catalogueStockTransactionsTable,
  invoicesTable,
  usersTable,
  crechesTable,
  tutorServiceCreditsTable,
} from "@workspace/db/schema";
import { BillingService } from "./billing.js";
import { eq, and, sql, inArray, desc } from "drizzle-orm";
import { releasePurchasedCredits } from "./credits.js";
import { sendLowStockAlertEmail } from "./email.js";

export interface CreateOrderItem {
  catalogueItemId: number;
  quantity: number;
}

export interface CreateOrderParams {
  crecheId: number;
  tutorId: number;
  items: CreateOrderItem[];
  deliveryMethod: string;
  deliveryAddress?: string | null;
  deliveryFee: number;
}

export interface LowStockAlert {
  itemName: string;
  currentStock: number;
  reorderThreshold: number;
}

export interface CreateOrderResult {
  order: typeof ordersTable.$inferSelect;
  invoice: typeof invoicesTable.$inferSelect | null;
}

/**
 * Cria um pedido completo com fatura avulsa, deduções de estoque e itens.
 * Retorna o resultado e a lista de alertas de baixo estoque para disparo
 * assíncrono (fora da transação).
 */
export async function createOrder(
  params: CreateOrderParams
): Promise<{ result: CreateOrderResult; lowStockAlerts: LowStockAlert[] }> {
  const { crecheId, tutorId, items, deliveryMethod, deliveryAddress, deliveryFee } = params;
  const lowStockAlerts: LowStockAlert[] = [];
  let result: CreateOrderResult = { order: {} as any, invoice: null };

  await db.transaction(async (tx) => {
    // Ordenar por ID para adquirir locks em ordem determinística (previne deadlocks)
    const sortedReqItems = [...items].sort((a, b) => a.catalogueItemId - b.catalogueItemId);
    const catalogueItems: (typeof catalogueItemsTable.$inferSelect)[] = [];
    const orderItemsToInsert: {
      catalogueItemId: number;
      quantity: number;
      unitPrice: string;
      totalPrice: string;
    }[] = [];
    let subtotal = 0;

    for (const reqItem of sortedReqItems) {
      const [lockedItem] = await tx.select().from(catalogueItemsTable)
        .where(and(
          eq(catalogueItemsTable.id, reqItem.catalogueItemId),
          eq(catalogueItemsTable.crecheId, crecheId),
          eq(catalogueItemsTable.isActive, true),
        ))
        .for("update");

      if (!lockedItem) {
        throw new Error(`Item ID ${reqItem.catalogueItemId} não encontrado ou inativo.`);
      }

      if (lockedItem.type === "product") {
        if (lockedItem.stockQuantity < reqItem.quantity) {
          throw new Error(`Estoque insuficiente para o item: ${lockedItem.name}. Saldo: ${lockedItem.stockQuantity}`);
        }

        await tx.update(catalogueItemsTable)
          .set({ stockQuantity: sql`${catalogueItemsTable.stockQuantity} - ${reqItem.quantity}` })
          .where(eq(catalogueItemsTable.id, lockedItem.id));

        const newQuantity = lockedItem.stockQuantity - reqItem.quantity;
        if (newQuantity <= lockedItem.minStockAlert) {
          lowStockAlerts.push({
            itemName: lockedItem.name,
            currentStock: newQuantity,
            reorderThreshold: lockedItem.minStockAlert,
          });
        }
      }

      catalogueItems.push(lockedItem);
    }

    for (const reqItem of items) {
      const catItem = catalogueItems.find(c => c.id === reqItem.catalogueItemId);
      if (!catItem) continue;

      const unitPrice = Number(catItem.basePrice);
      const totalPrice = unitPrice * reqItem.quantity;
      subtotal += totalPrice;

      orderItemsToInsert.push({
        catalogueItemId: catItem.id,
        quantity: reqItem.quantity,
        unitPrice: unitPrice.toString(),
        totalPrice: totalPrice.toString(),
      });
    }

    const total = subtotal + Number(deliveryFee);

    // Todos os itens do pedido compartilham uma única fatura avulsa
    let firstInvoiceId: number | null = null;

    for (const reqItem of orderItemsToInsert) {
      const catItem = catalogueItems.find(c => c.id === reqItem.catalogueItemId);
      const invId = await BillingService.addCharge({
        crecheId,
        tutorId,
        amount: reqItem.unitPrice,
        quantity: reqItem.quantity,
        description: catItem!.name,
        type: catItem?.type ?? "product",
        itemDate: new Date(),
        isAvulso: !firstInvoiceId,
        existingInvoiceId: firstInvoiceId ?? undefined,
        tx,
      });
      if (!firstInvoiceId) firstInvoiceId = invId;
    }

    if (Number(deliveryFee) > 0) {
      const invId = await BillingService.addCharge({
        crecheId,
        tutorId,
        amount: deliveryFee.toString(),
        quantity: 1,
        description: "Taxa de Entrega",
        type: "fee",
        itemDate: new Date(),
        isAvulso: !firstInvoiceId,
        existingInvoiceId: firstInvoiceId ?? undefined,
        tx,
      });
      if (!firstInvoiceId) firstInvoiceId = invId;
    }

    const [order] = await tx.insert(ordersTable).values({
      crecheId,
      tutorId,
      invoiceId: firstInvoiceId!,
      status: "pending_payment",
      deliveryMethod,
      deliveryAddress,
      deliveryFee: deliveryFee.toString(),
      subtotal: subtotal.toString(),
      total: total.toString(),
    }).returning();

    for (const oi of orderItemsToInsert) {
      await tx.insert(orderItemsTable).values({
        orderId: order.id,
        catalogueItemId: oi.catalogueItemId,
        quantity: oi.quantity,
        unitPrice: oi.unitPrice,
        totalPrice: oi.totalPrice,
      });
    }

    let invoice: typeof invoicesTable.$inferSelect | null = null;
    if (firstInvoiceId) {
      const [fetchedInvoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, firstInvoiceId));
      invoice = fetchedInvoice ?? null;
    }

    result = { order, invoice };
  });

  return { result, lowStockAlerts };
}

/**
 * Envia os alertas de baixo estoque de forma assíncrona (fire-and-forget).
 * Deve ser chamado fora da transação.
 */
export async function dispatchLowStockAlerts(
  crecheId: number,
  alerts: LowStockAlert[]
): Promise<void> {
  if (alerts.length === 0) return;
  try {
    const [admin] = await db
      .select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(and(eq(usersTable.crecheId, crecheId), eq(usersTable.role, "creche_admin")))
      .limit(1);
    const [creche] = await db
      .select({ name: crechesTable.name })
      .from(crechesTable)
      .where(eq(crechesTable.id, crecheId))
      .limit(1);
    if (admin && creche) {
      for (const alert of alerts) {
        await sendLowStockAlertEmail({
          adminEmail: admin.email,
          adminName: admin.name,
          crecheName: creche.name,
          itemName: alert.itemName,
          currentStock: alert.currentStock,
          reorderThreshold: alert.reorderThreshold,
        });
      }
    }
  } catch (err) {
    console.error("[low-stock-alert] Failed to send alert:", err);
  }
}

/**
 * Cancela um pedido: restaura estoque de produtos, revoga créditos de serviço
 * liberados e cancela a fatura associada.
 */
export async function cancelOrder(params: {
  order: typeof ordersTable.$inferSelect;
  crecheId: number;
  userId: number;
}): Promise<void> {
  const { order, crecheId, userId } = params;

  // Buscar itens e dados de catálogo fora da transação (leitura segura)
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
  const catIds = [...new Set(items.map(i => i.catalogueItemId))];
  const catItems = catIds.length
    ? await db.select().from(catalogueItemsTable).where(inArray(catalogueItemsTable.id, catIds))
    : [];

  await db.transaction(async (tx) => {
    for (const item of items) {
      const catItem = catItems.find(c => c.id === item.catalogueItemId);

      if (catItem && catItem.type !== "service") {
        await tx.update(catalogueItemsTable)
          .set({ stockQuantity: sql`${catalogueItemsTable.stockQuantity} + ${item.quantity}` })
          .where(eq(catalogueItemsTable.id, item.catalogueItemId));

        await tx.insert(catalogueStockTransactionsTable).values({
          itemId: item.catalogueItemId,
          crecheId,
          type: "in",
          quantity: item.quantity,
          reason: "Cancelamento de Pedido",
          userId,
        });
      }
    }

    // Revogar créditos de serviço liberados (caso a fatura já tenha sido paga)
    if (order.invoiceId) {
      const [inv] = await tx
        .select({ creditsReleased: invoicesTable.creditsReleased, tutorId: invoicesTable.tutorId })
        .from(invoicesTable)
        .where(eq(invoicesTable.id, order.invoiceId));

      if (inv?.creditsReleased && inv.tutorId) {
        for (const item of items) {
          const catItem = catItems.find(c => c.id === item.catalogueItemId);
          if (catItem?.type !== "service") continue;

          const creditRows = await tx
            .select()
            .from(tutorServiceCreditsTable)
            .where(and(
              eq(tutorServiceCreditsTable.tutorId, inv.tutorId),
              eq(tutorServiceCreditsTable.crecheId, crecheId),
              eq(tutorServiceCreditsTable.catalogueItemId, item.catalogueItemId),
            ))
            .orderBy(desc(tutorServiceCreditsTable.id));

          let toRevoke = item.quantity;
          for (const row of creditRows) {
            if (toRevoke <= 0) break;
            const revokable = row.totalCredits - row.usedCredits;
            const actualRevoke = Math.min(revokable, toRevoke);
            if (actualRevoke <= 0) continue;
            await tx.update(tutorServiceCreditsTable)
              .set({ totalCredits: row.totalCredits - actualRevoke })
              .where(eq(tutorServiceCreditsTable.id, row.id));
            toRevoke -= actualRevoke;
          }
        }

        await tx.update(invoicesTable)
          .set({ creditsReleased: false })
          .where(eq(invoicesTable.id, order.invoiceId));
      }

      // Cancelar a fatura (apenas se não paga — faturas pagas são tratadas por refundInvoice)
      await tx.update(invoicesTable)
        .set({ status: "voided" })
        .where(and(eq(invoicesTable.id, order.invoiceId), eq(invoicesTable.status, "pending_payment")));
    }
  });
}
