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

import {
  db,
  ordersTable,
  orderItemsTable,
  catalogueItemsTable,
  catalogueStockTransactionsTable,
  invoicesTable,
  usersTable,
  crechesTable,
  tutorServiceCreditsTable,
  storeOrderOperationsTable,
} from "@workspace/db";
import { financialLog } from "../lib/logger.js";
import { BillingService } from "./billing.js";
import { TutorCommercialPricingService } from "./tutorCommercialPricing.js";
import { OutboxRepository } from "../repositories/outbox.repository.js";
import type { FinancialDomainEvent } from "./events.js";
import { eq, and, sql, inArray, desc } from "drizzle-orm";
import { releasePurchasedCredits } from "./credits.js";
import { sendLowStockAlertEmail } from "./email.js";
import { getBusinessDate } from "../lib/date.js";
import { createHash } from "crypto";
import { acquireTenantOperationalLock } from "./tenantLifecycleLock.js";

export interface CreateOrderItem {
  catalogueItemId: number;
  quantity: number;
}

export interface CreateOrderParams {
  crecheId: number;
  tutorId: number;
  operationId: string;
  items: CreateOrderItem[];
  deliveryMethod: string;
  deliveryAddress?: string | null;
  deliveryFee?: number;
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
 * Protegido com idempotência transacional via store_order_operations (R24F).
 */
export async function createOrder(
  params: CreateOrderParams
): Promise<{ result: CreateOrderResult; lowStockAlerts: LowStockAlert[] }> {
  const { crecheId, tutorId, operationId, items, deliveryMethod, deliveryAddress } = params;
  const lowStockAlerts: LowStockAlert[] = [];
  let result: CreateOrderResult = { order: {} as any, invoice: null };

  // Normalizar ordenação de itens e endereço para hash determinístico
  const sortedReqItems = [...items].sort((a, b) => {
    if (a.catalogueItemId !== b.catalogueItemId) return a.catalogueItemId - b.catalogueItemId;
    return a.quantity - b.quantity;
  });
  const normAddress = deliveryAddress && deliveryAddress.trim() ? deliveryAddress.trim() : null;
  const payloadString = `${sortedReqItems.map(i => `${i.catalogueItemId}:${i.quantity}`).join(";")}|${deliveryMethod}|${normAddress ?? "null"}|${tutorId}`;
  const payloadHash = createHash("sha256").update(payloadString).digest("hex");

  // Fast-path: verificar se a operação já foi concluída
  const [existingOp] = await db
    .select()
    .from(storeOrderOperationsTable)
    .where(
      and(
        eq(storeOrderOperationsTable.crecheId, crecheId),
        eq(storeOrderOperationsTable.operationId, operationId)
      )
    )
    .limit(1);

  if (existingOp) {
    if (existingOp.payloadHash !== payloadHash) {
      throw Object.assign(
        new Error("Operação já processada com payload diferente."),
        { status: 409 }
      );
    }
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, existingOp.orderId));
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, existingOp.invoiceId));
    return { result: { order: order!, invoice: invoice ?? null }, lowStockAlerts: [] };
  }

  try {
    await db.transaction(async (tx) => {
      await acquireTenantOperationalLock(crecheId, tx);

      // Double check dentro da transação contra race condition
      const [txExistingOp] = await tx
        .select()
        .from(storeOrderOperationsTable)
        .where(
          and(
            eq(storeOrderOperationsTable.crecheId, crecheId),
            eq(storeOrderOperationsTable.operationId, operationId)
          )
        )
        .limit(1);

      if (txExistingOp) {
        if (txExistingOp.payloadHash !== payloadHash) {
          throw Object.assign(
            new Error("Operação já processada com payload diferente."),
            { status: 409 }
          );
        }
        const [order] = await tx.select().from(ordersTable).where(eq(ordersTable.id, txExistingOp.orderId));
        const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, txExistingOp.invoiceId));
        result = { order: order!, invoice: invoice ?? null };
        return;
      }

      // Ordenar por ID para adquirir locks em ordem determinística (previne deadlocks)
      const sortedById = [...items].sort((a, b) => a.catalogueItemId - b.catalogueItemId);
      const catalogueItems: (typeof catalogueItemsTable.$inferSelect)[] = [];
      const orderItemsToInsert: {
        catalogueItemId: number;
        quantity: number;
        unitPrice: string;
        totalPrice: string;
        snapshot?: any;
      }[] = [];
      let subtotal = 0;

      for (const reqItem of sortedById) {
        const [lockedItem] = await tx.select().from(catalogueItemsTable)
          .where(and(
            eq(catalogueItemsTable.id, reqItem.catalogueItemId),
            eq(catalogueItemsTable.crecheId, crecheId),
            eq(catalogueItemsTable.isActive, true),
          ))
          .for("update");

        if (!lockedItem) {
          throw Object.assign(
            new Error(`Item ID ${reqItem.catalogueItemId} não encontrado ou inativo.`),
            { status: 400 }
          );
        }

        // Only enforce stock for products that actually track stock.
        // Services, day_use, and products with trackStock=false never block on quantity.
        if (lockedItem.type === "product" && lockedItem.trackStock) {
          if (lockedItem.stockQuantity < reqItem.quantity) {
            throw Object.assign(
              new Error(`Estoque insuficiente para o item: ${lockedItem.name}. Saldo: ${lockedItem.stockQuantity}`),
              { status: 400 }
            );
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

        const resolved = await TutorCommercialPricingService.resolveItemPriceForTutor(
          crecheId,
          tutorId,
          catItem.id,
          { quantity: reqItem.quantity, tx }
        );

        const unitPrice = Number(resolved.effectiveUnitPrice);
        const totalPrice = unitPrice * reqItem.quantity;
        subtotal += totalPrice;

        orderItemsToInsert.push({
          catalogueItemId: catItem.id,
          quantity: reqItem.quantity,
          unitPrice: unitPrice.toString(),
          totalPrice: totalPrice.toString(),
          snapshot: resolved,
        });
      }

      // Cálculo autoritativo de taxa de entrega pelo servidor (R24F)
      const hasPhysicalProducts = catalogueItems.some(c => c.type === "product");
      let authoritativeDeliveryFee = 0;
      if (deliveryMethod === "delivery" && hasPhysicalProducts) {
        const [creche] = await tx
          .select({ deliveryType: crechesTable.deliveryType, deliveryFee: crechesTable.deliveryFee })
          .from(crechesTable)
          .where(eq(crechesTable.id, crecheId));
        if (creche?.deliveryType === "fixed") {
          authoritativeDeliveryFee = Number(creche.deliveryFee || 0);
        }
      }

      const total = subtotal + authoritativeDeliveryFee;

      // Todos os itens do pedido compartilham uma única fatura avulsa
      let firstInvoiceId: number | null = null;

      for (const reqItem of orderItemsToInsert) {
        const catItem = catalogueItems.find(c => c.id === reqItem.catalogueItemId)!;
        const { invoiceId: invId } = await BillingService.addCharge({
          crecheId,
          tutorId,
          amount: reqItem.unitPrice,
          quantity: reqItem.quantity,
          description: catItem.name,
          type: catItem.type ?? "product",
          itemDate: new Date(),
          isAvulso: !firstInvoiceId,
          existingInvoiceId: firstInvoiceId ?? undefined,
          catalogueItemId: catItem.id,
          creditsAmount: catItem.creditsAmount ?? undefined,
          snapshotMaxPets: catItem.maxPetsPerDay ?? undefined,
          snapshotExpiration: (catItem as any).expirationDays ?? undefined,
          baseUnitPrice: (reqItem as any).snapshot?.baseUnitPrice,
          discountAmount: (reqItem as any).snapshot?.unitDiscount,
          finalPrice: (reqItem as any).snapshot?.effectiveUnitPrice,
          pricingSourceType: (reqItem as any).snapshot?.pricingSourceType,
          appliedConditionId: (reqItem as any).snapshot?.appliedConditionId,
          conditionSnapshot: (reqItem as any).snapshot?.conditionSnapshot,
          tx,
        });
        if (!firstInvoiceId) firstInvoiceId = invId;
      }

      if (authoritativeDeliveryFee > 0) {
        const { invoiceId: invId } = await BillingService.addCharge({
          crecheId,
          tutorId,
          amount: authoritativeDeliveryFee.toString(),
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
        status: "pending_payment" as any,
        deliveryMethod: deliveryMethod as "pickup" | "delivery",
        deliveryAddress: normAddress,
        deliveryFee: authoritativeDeliveryFee.toString(),
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

      // Persistir registro de idempotência dentro da mesma transação
      await tx.insert(storeOrderOperationsTable).values({
        crecheId,
        operationId,
        payloadHash,
        orderId: order.id,
        invoiceId: firstInvoiceId!,
      });

      let invoice: typeof invoicesTable.$inferSelect | null = null;
      if (firstInvoiceId) {
        const [fetchedInvoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, firstInvoiceId));
        invoice = fetchedInvoice ?? null;
      }

      result = { order, invoice };
    });
  } catch (err: any) {
    // Tratar race condition de índice único em store_order_operations
    const STORE_ORDER_OPERATION_CONSTRAINT = "store_order_operations_creche_op_idx";

    const errCode = err.code || err.cause?.code;
    const errConstraint = err.constraint || err.cause?.constraint;
    const errDetail = typeof err.detail === "string" ? err.detail : (typeof err.cause?.detail === "string" ? err.cause.detail : "");
    const errMessage = typeof err.message === "string" ? err.message : "";

    const isStoreOpConflict =
      errCode === "23505" &&
      (errConstraint === STORE_ORDER_OPERATION_CONSTRAINT ||
        errDetail.includes(STORE_ORDER_OPERATION_CONSTRAINT) ||
        errMessage.includes(STORE_ORDER_OPERATION_CONSTRAINT));

    if (isStoreOpConflict) {
      const [resolvedOp] = await db
        .select()
        .from(storeOrderOperationsTable)
        .where(
          and(
            eq(storeOrderOperationsTable.crecheId, crecheId),
            eq(storeOrderOperationsTable.operationId, operationId)
          )
        )
        .limit(1);

      if (resolvedOp) {
        if (resolvedOp.payloadHash !== payloadHash) {
          throw Object.assign(
            new Error("Operação já processada com payload diferente."),
            { status: 409 }
          );
        }
        const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, resolvedOp.orderId));
        const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, resolvedOp.invoiceId));
        return { result: { order: order!, invoice: invoice ?? null }, lowStockAlerts: [] };
      }
    }
    throw err;
  }

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
    financialLog({ operation: "low_stock_alert_failed", level: "error", error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Cancela um pedido: restaura estoque de produtos físicos controlados, revoga
 * créditos de serviço liberados e cancela a fatura associada.
 */
export async function cancelOrder(params: {
  order: typeof ordersTable.$inferSelect;
  crecheId: number;
  /** Null for system actors (e.g. scheduled cancellations). Column is nullable. */
  userId: number | null;
}): Promise<typeof ordersTable.$inferSelect> {
  const { order, crecheId, userId } = params;
  let updatedOrder!: typeof ordersTable.$inferSelect;

  // Buscar itens e dados de catálogo fora da transação (leitura segura)
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
  const sortedItems = [...items].sort(
    (a, b) => a.catalogueItemId - b.catalogueItemId
  );
  const catIds = [...new Set(items.map(i => i.catalogueItemId))];
  const catItems = catIds.length
    ? await db.select().from(catalogueItemsTable).where(inArray(catalogueItemsTable.id, catIds))
    : [];

  await db.transaction(async (tx) => {
    await acquireTenantOperationalLock(crecheId, tx);

    // Payment uses tutor advisory → invoice → order. Cancellation must acquire
    // the same tutor lock before its order row to avoid invoice/order AB/BA.
    await BillingService.acquireTutorFinancialLock(crecheId, order.tutorId, tx);

    // Re-read the order with a row-level lock inside the transaction.
    // This prevents concurrent cancellations (scheduler + API race) from
    // double-restoring stock and emitting duplicate OrderCancelled events.
    const [lockedOrder] = await tx
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, order.id))
      .for("update");

    if (!lockedOrder || lockedOrder.status === "cancelled") {
      // Already cancelled — nothing to do; return the current row.
      updatedOrder = lockedOrder ?? order;
      return;
    }

    for (const item of sortedItems) {
      const catItem = catItems.find(c => c.id === item.catalogueItemId);

      // Apenas produtos físicos com trackStock=true tiveram estoque debitado e devem ser restaurados (R24F)
      if (catItem && catItem.type === "product" && catItem.trackStock === true) {
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

      // Cancelar a fatura (apenas se pendente — faturas pagas são tratadas por refundInvoice)
      const [voidedInvoice] = await tx.update(invoicesTable)
        .set({ status: "voided" })
        .where(and(
          eq(invoicesTable.id, order.invoiceId),
          eq(invoicesTable.status, "pending"),
          sql`${invoicesTable.dueDate} >= ${getBusinessDate()}`,
        ))
        .returning({ id: invoicesTable.id });

      if (voidedInvoice) {
        await OutboxRepository.insert({
          type: "InvoiceVoided",
          crecheId,
          invoiceId: order.invoiceId,
          tutorId: order.tutorId,
          occurredAt: new Date().toISOString(),
        } as FinancialDomainEvent, tx);
      }

      await OutboxRepository.insert({
        type: "OrderCancelled",
        crecheId,
        invoiceId: order.invoiceId,
        occurredAt: new Date().toISOString(),
      } as FinancialDomainEvent, tx);
    }

    // Update the order status to cancelled atomically with the outbox events so
    // they can never be committed without the matching business state change.
    const [updated] = await tx
      .update(ordersTable)
      .set({ status: "cancelled" as any })
      .where(eq(ordersTable.id, order.id))
      .returning();
    updatedOrder = updated;
  });
  return updatedOrder;
}
