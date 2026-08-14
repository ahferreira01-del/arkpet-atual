import { getBusinessDate } from "../lib/date.js";
/**
 * PosService (Fase 15A) — processa vendas no balcão (POS).
 * Centraliza a lógica que antes estava dispersa na rota POST /pos-sale.
 */

import { db } from "@workspace/db";
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
   * Processes a full POS sale:
   * 1. Locks catalogue items in deterministic order (deadlock prevention)
   * 2. Validates stock availability for products
   * 3. Decrements stock for products + records stock transactions
   * 4. Creates invoice(s) via BillingService.addCharge
   * 5. If immediate payment, marks invoice paid + creates income transaction
   */
  static async processSale(params: {
    crecheId: number;
    items: PosItem[];
    paymentMethod?: string;
    tutorId?: number | null;
    userId: number;
  }): Promise<PosResult> {
    const { crecheId, paymentMethod, tutorId, userId } = params;

    // Lock items in deterministic order to prevent deadlocks
    const sortedItems = [...params.items].sort(
      (a, b) => a.catalogueItemId - b.catalogueItemId
    );

    return db.transaction(async (tx) => {
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

      // Phase 4 — Create invoice items
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

      const invoice = await InvoiceRepository.findById(invoiceId!, tx);
      return { invoice };
    });
  }
}

