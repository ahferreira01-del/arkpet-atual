import { createHash } from "crypto";
import { getBusinessDate } from "../lib/date.js";
import { db, usersTable, posSaleOperationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { CatalogueRepository } from "../repositories/catalogue.repository.js";
import { InvoiceRepository } from "../repositories/invoice.repository.js";
import { TransactionRepository } from "../repositories/transaction.repository.js";
import { hasOverdueInvoices, BillingService } from "./billing.js";

export interface PosItem {
  catalogueItemId: number;
  quantity: number;
}

export interface PosResult {
  invoice: any;
}

export class PosService {
  /**
   * Processes a full POS sale (Phase R20F):
   * 1. Evaluates operationId idempotency (SHA-256 fingerprint)
   * 2. Validates tutor tenant association if tutorId provided
   * 3. Locks catalogue items in deterministic order (deadlock prevention)
   * 4. Validates stock availability for products
   * 5. Decrements stock for products + records stock transactions
   * 6. Creates/aggregates invoice item(s) on a single invoice via BillingService.addCharge
   * 7. If immediate payment, marks invoice paid + creates income transaction
   * 8. Records pos_sale_operations idempotency atomically
   */
  static async processSale(params: {
    crecheId: number;
    operationId: string;
    items: PosItem[];
    paymentMethod?: string;
    tutorId?: number | null;
    userId: number;
  }): Promise<PosResult> {
    const { crecheId, operationId, paymentMethod, tutorId, userId } = params;

    // Lock items in deterministic order to prevent deadlocks
    const sortedItems = [...params.items].sort(
      (a, b) => a.catalogueItemId - b.catalogueItemId
    );

    // Compute deterministic payload fingerprint
    const payloadString = `${sortedItems.map((i) => `${i.catalogueItemId}:${i.quantity}`).join(";")}|${paymentMethod || "cash"}|${tutorId ?? "null"}`;
    const payloadHash = createHash("sha256").update(payloadString).digest("hex");

    // Fast-path lookup: check if operation was already committed
    const [existingOp] = await db
      .select()
      .from(posSaleOperationsTable)
      .where(
        and(
          eq(posSaleOperationsTable.crecheId, crecheId),
          eq(posSaleOperationsTable.operationId, operationId)
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
      const invoice = await InvoiceRepository.findById(existingOp.invoiceId);
      return { invoice };
    }

    try {
      return await db.transaction(async (tx) => {
        // Double-check existingOp under transaction in case of concurrent fast-path race
        const [txExistingOp] = await tx
          .select()
          .from(posSaleOperationsTable)
          .where(
            and(
              eq(posSaleOperationsTable.crecheId, crecheId),
              eq(posSaleOperationsTable.operationId, operationId)
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
          const invoice = await InvoiceRepository.findById(txExistingOp.invoiceId, tx);
          return { invoice };
        }

        // Validate Tutor tenant if tutorId is provided
        if (tutorId != null) {
          const [tutorUser] = await tx
            .select({ id: usersTable.id })
            .from(usersTable)
            .where(
              and(
                eq(usersTable.id, tutorId),
                eq(usersTable.crecheId, crecheId),
                eq(usersTable.role, "tutor"),
                eq(usersTable.isActive, true)
              )
            )
            .limit(1);

          if (!tutorUser) {
            throw Object.assign(
              new Error("Tutor não encontrado ou não pertence a esta creche."),
              { status: 404 }
            );
          }
        }

        // Financial lock must precede catalogue row locks. Refunds use the same
        // order (tutor advisory → invoice → catalogue), preventing AB/BA deadlocks.
        await BillingService.acquireTutorFinancialLock(crecheId, tutorId, tx);

        let subtotal = 0;
        const lockedItems: Array<{
          item: any;
          quantity: number;
          unitPrice: number;
          totalPrice: number;
        }> = [];

        // Phase 1 — Lock + validate stock
        for (const reqItem of sortedItems) {
          const lockedItem = await CatalogueRepository.findActiveForUpdate(
            reqItem.catalogueItemId,
            crecheId,
            tx
          );

          if (!lockedItem) {
            throw Object.assign(
              new Error(`Item ID ${reqItem.catalogueItemId} não encontrado ou inativo.`),
              { status: 404 }
            );
          }

          // Only enforce stock for products that actually track stock.
          // Services and day_use items never have stock, so trackStock=false bypasses this check.
          if (lockedItem.type === "product" && lockedItem.trackStock && lockedItem.stockQuantity < reqItem.quantity) {
            throw Object.assign(
              new Error(
                `Estoque insuficiente para o item: ${lockedItem.name}. Saldo atual: ${lockedItem.stockQuantity}`
              ),
              { status: 400 }
            );
          }

          const unitPrice = Number(lockedItem.basePrice);
          lockedItems.push({
            item: lockedItem,
            quantity: reqItem.quantity,
            unitPrice,
            totalPrice: unitPrice * reqItem.quantity,
          });
          subtotal += unitPrice * reqItem.quantity;
        }

        // Phase 2 — Check overdue when deferring to invoice
        const isPending = !paymentMethod || paymentMethod === "pending";
        if (isPending && tutorId) {
          if (await hasOverdueInvoices(tutorId, crecheId)) {
            throw Object.assign(
              new Error(
                "Tutor com faturas em atraso. Regularize a situação para realizar compras a prazo (adicionar na fatura)."
              ),
              { status: 422 }
            );
          }
        }

        // Phase 3 — Decrement stock + record stock transactions for tracked products only.
        // Products with trackStock=false (and all services/day_use) skip stock bookkeeping.
        const stockTransactions: any[] = [];
        for (const li of lockedItems) {
          if (li.item.type === "product" && li.item.trackStock) {
            await CatalogueRepository.decrementStock(li.item.id, li.quantity, tx);
            stockTransactions.push({
              itemId: li.item.id,
              crecheId,
              type: "out" as const,
              quantity: li.quantity,
              reason: "Venda Balcão",
              userId,
            });
          }
        }
        if (stockTransactions.length > 0) {
          await CatalogueRepository.createStockTransactionBatch(stockTransactions, tx);
        }

        // Phase 4 — Create invoice items (aggregating multi-item carts into 1 invoice)
        const isAvulso = !isPending || !tutorId;
        let invoiceId: number | null = null;

        for (const li of lockedItems) {
          ({ invoiceId } = await BillingService.addCharge({
            crecheId,
            tutorId: tutorId ?? null,
            amount: li.unitPrice,
            quantity: li.quantity,
            description: li.item.name,
            type: "pos_sale",
            isAvulso,
            existingInvoiceId: isAvulso && invoiceId ? invoiceId : undefined,
            itemDate: new Date(),
            tx,
            userId,
            catalogueItemId: li.item.id,
          }));
        }

        // Phase 5 — Immediate payment
        if (!isPending && invoiceId) {
          await InvoiceRepository.markPaidImmediate(invoiceId, tx);
          await TransactionRepository.create(
            {
              crecheId,
              invoiceId,
              type: "income",
              amount: subtotal.toString(),
              transactionDate: getBusinessDate(),
              paymentMethod: paymentMethod as any,
              description: "Venda Balcão",
            },
            tx
          );
        }

        // Phase 6 — Persist idempotency operation record
        await tx.insert(posSaleOperationsTable).values({
          crecheId,
          operationId,
          payloadHash,
          invoiceId: invoiceId!,
        });

        const invoice = await InvoiceRepository.findById(invoiceId!, tx);
        return { invoice };
      });
    } catch (err: any) {
      // Handle unique index violation on pos_sale_operations_creche_op_idx
      if (
        err.code === "23505" ||
        (typeof err.message === "string" &&
          (err.message.includes("pos_sale_operations_creche_op_idx") ||
            err.message.includes("pos_sale_operations")))
      ) {
        const [resolvedOp] = await db
          .select()
          .from(posSaleOperationsTable)
          .where(
            and(
              eq(posSaleOperationsTable.crecheId, crecheId),
              eq(posSaleOperationsTable.operationId, operationId)
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
          const invoice = await InvoiceRepository.findById(resolvedOp.invoiceId);
          return { invoice };
        }
      }
      throw err;
    }
  }
}

