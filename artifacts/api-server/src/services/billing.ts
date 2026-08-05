import { db } from "@workspace/db";
import { invoicesTable, transactionsTable, invoiceItemsTable, usersTable, ordersTable } from "@workspace/db/schema";
import { eq, and, or, sql } from "drizzle-orm";
import { releasePurchasedCredits } from "./credits.js";
import { logFinancialAudit } from "./audit.js";

// ─────────────────────────────────────────────────────────────────────────────
// Máquina de Estados da Invoice (Fase 14)
// Única fonte de verdade para transições válidas de status.
// ─────────────────────────────────────────────────────────────────────────────

export class InvoiceStateMachine {
  private static readonly VALID_TRANSITIONS: Record<string, readonly string[]> = {
    pending:               ["paid", "voided", "overdue"],
    overdue:               ["paid", "voided"],
    awaiting_confirmation: ["paid", "voided"],
    paid:                  ["refunded"],
    voided:                [],
    refunded:              [],
  } as const;

  static canTransition(from: string, to: string): boolean {
    return (this.VALID_TRANSITIONS[from] ?? []).includes(to);
  }

  static assertTransition(from: string, to: string): void {
    if (!this.canTransition(from, to)) {
      const allowed = (this.VALID_TRANSITIONS[from] ?? []).join(", ") || "nenhuma";
      throw new Error(
        `Transição de status inválida para Invoice: "${from}" → "${to}". ` +
        `Transições permitidas de "${from}": [${allowed}]`
      );
    }
  }

  /** Verifica se o status é terminal (não aceita mais alterações financeiras). */
  static isTerminal(status: string): boolean {
    return (this.VALID_TRANSITIONS[status]?.length ?? Infinity) === 0;
  }

  /** Verifica se o status é "fechado" para novos lançamentos no mesmo ciclo. */
  static isClosed(status: string): boolean {
    return status === "paid" || status === "refunded" || status === "voided";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// calculateDueDate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula a data de vencimento baseada no dia de mensalidade do tutor.
 */
export function calculateDueDate(
  tutorMensalidadeDia: number | null | undefined,
  fallbackDate: Date = new Date()
): string {
  if (!tutorMensalidadeDia) {
    const fallback = new Date(fallbackDate);
    fallback.setDate(fallback.getDate() + 3);
    return fallback.toISOString().split("T")[0];
  }

  const today = new Date();
  let dueMonth = today.getMonth();
  let dueYear = today.getFullYear();

  if (today.getDate() > tutorMensalidadeDia) {
    dueMonth += 1;
    if (dueMonth > 11) {
      dueMonth = 0;
      dueYear += 1;
    }
  }

  const lastDayOfMonth = new Date(dueYear, dueMonth + 1, 0).getDate();
  const actualDay = Math.min(tutorMensalidadeDia, lastDayOfMonth);
  const finalDueDate = new Date(dueYear, dueMonth, actualDay);
  return finalDueDate.toISOString().split("T")[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// hasOverdueInvoices
// ─────────────────────────────────────────────────────────────────────────────

export async function hasOverdueInvoices(tutorId: number): Promise<boolean> {
  const todayStr = new Date().toISOString().split("T")[0];
  const [overdue] = await db
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

  return !!overdue;
}

// ─────────────────────────────────────────────────────────────────────────────
// processManualPayment — FOR UPDATE + state machine + audit
// ─────────────────────────────────────────────────────────────────────────────

export async function processManualPayment(
  invoiceId: number,
  crecheId: number,
  userId: number,
  paymentMethod: "stripe" | "pix" | "cash" | "credit_card" | "bank_slip"
) {
  return await db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.crecheId, crecheId)))
      .for("update");

    if (!invoice) throw new Error("Fatura não encontrada");
    InvoiceStateMachine.assertTransition(invoice.status, "paid");

    await tx.update(invoicesTable)
      .set({ status: "paid", paymentMethod, updatedAt: new Date() })
      .where(eq(invoicesTable.id, invoiceId));

    await tx.insert(transactionsTable).values({
      crecheId: invoice.crecheId,
      invoiceId: invoice.id,
      type: "income",
      amount: invoice.amount,
      transactionDate: new Date().toISOString().split("T")[0],
      paymentMethod,
      description: `Pagamento da Fatura #${invoice.id}`,
    });

    await logFinancialAudit({
      crecheId: invoice.crecheId,
      userId,
      action: "manual_payment_register",
      referenceId: invoice.id,
      referenceType: "invoices",
      details: `Fatura #${invoice.id} paga via ${paymentMethod} e conciliada.`,
    }, tx);

    await releasePurchasedCredits(invoice.id, userId, tx);

    await tx.update(ordersTable)
      .set({ status: "paid" })
      .where(and(eq(ordersTable.invoiceId, invoiceId), eq(ordersTable.status, "pending_payment")));

    return invoice;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// approveReceipt — FOR UPDATE + state machine + audit
// ─────────────────────────────────────────────────────────────────────────────

export async function approveReceipt(invoiceId: number, crecheId: number, userId: number) {
  return await db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.crecheId, crecheId)))
      .for("update");

    if (!invoice) throw new Error("Fatura não encontrada");
    InvoiceStateMachine.assertTransition(invoice.status, "paid");

    await tx.update(invoicesTable)
      .set({ status: "paid", updatedAt: new Date() })
      .where(eq(invoicesTable.id, invoiceId));

    await tx.insert(transactionsTable).values({
      crecheId: invoice.crecheId,
      invoiceId: invoice.id,
      type: "income",
      amount: invoice.amount,
      transactionDate: new Date().toISOString().split("T")[0],
      paymentMethod: invoice.paymentMethod || "pix",
      description: `Comprovante aprovado da Fatura #${invoice.id}`,
    });

    await logFinancialAudit({
      crecheId: invoice.crecheId,
      userId,
      action: "payment_approve",
      referenceId: invoice.id,
      referenceType: "invoices",
      details: `Comprovante da Fatura #${invoice.id} aprovado.`,
    }, tx);

    await releasePurchasedCredits(invoice.id, userId, tx);

    await tx.update(ordersTable)
      .set({ status: "paid" })
      .where(and(eq(ordersTable.invoiceId, invoiceId), eq(ordersTable.status, "pending_payment")));

    return invoice;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// voidInvoice — FOR UPDATE + state machine + audit
// ─────────────────────────────────────────────────────────────────────────────

export async function voidInvoice(invoiceId: number, crecheId: number, userId: number) {
  return await db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.crecheId, crecheId)))
      .for("update");

    if (!invoice) throw new Error("Fatura não encontrada");
    InvoiceStateMachine.assertTransition(invoice.status, "voided");

    await tx.update(invoicesTable)
      .set({ status: "voided", updatedAt: new Date() })
      .where(eq(invoicesTable.id, invoiceId));

    await tx.update(ordersTable)
      .set({ status: "cancelled" })
      .where(and(eq(ordersTable.invoiceId, invoiceId), eq(ordersTable.status, "pending_payment")));

    await logFinancialAudit({
      crecheId,
      userId,
      action: "invoice_void",
      referenceId: invoice.id,
      referenceType: "invoices",
      details: `Fatura #${invoice.id} cancelada (${invoice.status} → voided).`,
    }, tx);

    return invoice;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// refundInvoice — FOR UPDATE + state machine + audit
// ─────────────────────────────────────────────────────────────────────────────

export async function refundInvoice(invoiceId: number, crecheId: number, userId: number) {
  return await db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.crecheId, crecheId)))
      .for("update");

    if (!invoice) throw new Error("Fatura não encontrada");
    InvoiceStateMachine.assertTransition(invoice.status, "refunded");

    await tx.update(invoicesTable)
      .set({ status: "refunded", updatedAt: new Date() })
      .where(eq(invoicesTable.id, invoiceId));

    await tx.insert(transactionsTable).values({
      crecheId: invoice.crecheId,
      invoiceId: invoice.id,
      type: "expense",
      amount: invoice.amount,
      transactionDate: new Date().toISOString().split("T")[0],
      paymentMethod: invoice.paymentMethod || "pix",
      description: `Estorno da Fatura #${invoice.id}`,
    });

    await tx.update(ordersTable)
      .set({ status: "cancelled" })
      .where(and(
        eq(ordersTable.invoiceId, invoiceId),
        or(eq(ordersTable.status, "pending_payment"), eq(ordersTable.status, "paid"))
      ));

    await logFinancialAudit({
      crecheId,
      userId,
      action: "invoice_refund",
      referenceId: invoice.id,
      referenceType: "invoices",
      details: `Fatura #${invoice.id} estornada.`,
    }, tx);

    return invoice;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// BillingService — única autoridade de criação de invoices e charges
// ─────────────────────────────────────────────────────────────────────────────

export class BillingService {
  /**
   * Calcula os limites exatos de um ciclo de faturamento baseado no dia de
   * mensalidade do tutor.
   */
  static getCycleDates(
    mensalidadeDia: number | null | undefined,
    txDateStr: string = new Date().toISOString().split("T")[0]
  ) {
    const txDate = new Date(txDateStr + "T12:00:00Z");
    const day = mensalidadeDia || 10;

    let endMonth = txDate.getUTCMonth();
    let endYear = txDate.getUTCFullYear();

    if (txDate.getUTCDate() > day) {
      endMonth++;
      if (endMonth > 11) {
        endMonth = 0;
        endYear++;
      }
    }

    const lastDayOfMonth = new Date(Date.UTC(endYear, endMonth + 1, 0)).getUTCDate();
    const actualDay = Math.min(day, lastDayOfMonth);
    const endDate = new Date(Date.UTC(endYear, endMonth, actualDay));

    let startMonth = endMonth - 1;
    let startYear = endYear;
    if (startMonth < 0) {
      startMonth = 11;
      startYear--;
    }
    const lastDayOfStartMonth = new Date(Date.UTC(startYear, startMonth + 1, 0)).getUTCDate();
    const actualStartDay = Math.min(day, lastDayOfStartMonth);
    const startDate = new Date(Date.UTC(startYear, startMonth, actualStartDay + 1));

    return {
      cycleStart: startDate.toISOString().split("T")[0],
      cycleEnd: endDate.toISOString().split("T")[0],
      dueDate: endDate.toISOString().split("T")[0],
    };
  }

  /**
   * Adiciona uma cobrança ao tutor.
   *
   * Regras:
   * - Cobranças avulsas (`isAvulso: true`) criam invoice própria, nunca reabrem a mensal.
   * - Cobranças mensais fazem merge no ciclo atual SE o ciclo estiver em status aberto
   *   (pending/overdue). Se o ciclo já estiver fechado (paid/refunded/voided), cria
   *   invoice avulsa — NUNCA reabre invoice já liquidada.
   * - Se `existingInvoiceId` for fornecido, adiciona ao invoice existente (multi-item orders).
   *   Se o invoice não for encontrado, lança erro (não cria item órfão).
   * - Salva snapshot histórico no `invoiceItemsTable` para permitir reconstituição sem
   *   consultar o Catalogue.
   *
   * @returns ID do invoice ao qual o item foi adicionado.
   */
  static async addCharge(params: {
    crecheId: number;
    tutorId: number;
    amount: number | string;
    description: string;
    type?: string;
    petId?: number;
    bookingId?: number;
    orderId?: number;
    itemDate?: Date;
    quantity?: number;
    isAvulso?: boolean;
    existingInvoiceId?: number;
    tx?: any;
    userId?: number;              // Para audit log (0 = sistema)
    // ─── Fase 14: snapshot histórico ───────────────────────────────────────
    catalogueItemId?: number;     // FK para catalogueItemsTable
    creditsAmount?: number;       // Qtd de créditos que este item concede
    snapshotMaxPets?: number;     // maxPetsPerDay do pacote
    snapshotExpiration?: number;  // Dias até expirar (padrão 365)
  }) {
    const amountVal =
      typeof params.amount === "string" ? parseFloat(params.amount) : params.amount;
    const quantity = params.quantity || 1;
    const totalItemAmount = amountVal * quantity;
    const itemDateStr = (params.itemDate || new Date()).toISOString().split("T")[0];

    const executeLogic = async (txClient: any) => {
      let invoiceId: number;

      if (params.existingInvoiceId) {
        // ── Append to an already-created invoice (multi-item orders) ──────
        const [existing] = await txClient
          .select({ id: invoicesTable.id, amount: invoicesTable.amount })
          .from(invoicesTable)
          .where(eq(invoicesTable.id, params.existingInvoiceId));

        if (!existing) {
          // F-04: nunca criar item órfão — lançar erro se invoice não existe
          throw new Error(
            `[BillingService.addCharge] Invoice #${params.existingInvoiceId} não encontrada. ` +
            `Item não foi criado para evitar registro órfão.`
          );
        }

        const newTotal = (parseFloat(existing.amount) + totalItemAmount).toFixed(2);
        await txClient
          .update(invoicesTable)
          .set({ amount: newTotal, updatedAt: new Date() })
          .where(eq(invoicesTable.id, params.existingInvoiceId));

        invoiceId = params.existingInvoiceId;
      } else if (params.isAvulso) {
        // ── Avulso: invoice standalone, nunca reabrir mensal ─────────────
        const [newInv] = await txClient
          .insert(invoicesTable)
          .values({
            crecheId: params.crecheId,
            tutorId: params.tutorId,
            cycleStart: itemDateStr,
            cycleEnd: itemDateStr,
            dueDate: itemDateStr,
            amount: totalItemAmount.toFixed(2),
            status: "pending",
          })
          .returning();
        invoiceId = newInv.id;
      } else {
        // ── Ciclo mensal: merge ou nova invoice ───────────────────────────
        const [tutor] = await txClient
          .select({ mensalidadeDia: usersTable.mensalidadeDia })
          .from(usersTable)
          .where(eq(usersTable.id, params.tutorId));

        const cycle = this.getCycleDates(tutor?.mensalidadeDia, itemDateStr);

        const [existing] = await txClient
          .select()
          .from(invoicesTable)
          .where(
            and(
              eq(invoicesTable.tutorId, params.tutorId),
              eq(invoicesTable.cycleStart, cycle.cycleStart),
              eq(invoicesTable.cycleEnd, cycle.cycleEnd)
            )
          )
          .for("update");

        if (existing) {
          if (InvoiceStateMachine.isClosed(existing.status)) {
            // F-03: Ciclo já encerrado — criar avulsa overflow em vez de reabrir
            console.warn(
              `[BillingService.addCharge] Ciclo ${cycle.cycleStart}–${cycle.cycleEnd} ` +
              `já encerrado (status="${existing.status}"). ` +
              `Criando invoice avulsa overflow (tutorId=${params.tutorId}).`
            );
            const [newInv] = await txClient
              .insert(invoicesTable)
              .values({
                crecheId: params.crecheId,
                tutorId: params.tutorId,
                // cycleStart/cycleEnd omitidos (NULL) → permite múltiplas overflows
                dueDate: itemDateStr,
                amount: totalItemAmount.toFixed(2),
                status: "pending",
              })
              .returning();
            invoiceId = newInv.id;
          } else {
            // Ciclo aberto (pending/overdue) — merge normal
            const newTotal = (parseFloat(existing.amount) + totalItemAmount).toFixed(2);
            await txClient
              .update(invoicesTable)
              .set({ amount: newTotal, updatedAt: new Date() })
              .where(eq(invoicesTable.id, existing.id));
            invoiceId = existing.id;
          }
        } else {
          // Primeiro lançamento do ciclo — criar invoice mensal
          const [newInv] = await txClient
            .insert(invoicesTable)
            .values({
              crecheId: params.crecheId,
              tutorId: params.tutorId,
              cycleStart: cycle.cycleStart,
              cycleEnd: cycle.cycleEnd,
              dueDate: cycle.dueDate,
              amount: totalItemAmount.toFixed(2),
              status: "pending",
            })
            .returning();
          invoiceId = newInv.id;
        }
      }

      // ── Inserir item com snapshot histórico (Fase 14) ──────────────────
      await txClient.insert(invoiceItemsTable).values({
        invoiceId,
        description: params.description,
        amount: amountVal.toString(),
        quantity,
        itemDate: params.itemDate || new Date(),
        petId: params.petId,
        bookingId: params.bookingId,
        orderId: params.orderId,
        itemType: params.type || "service",
        // Snapshot — capturado no momento da cobrança
        catalogueItemId: params.catalogueItemId,
        snapshotName: params.description,
        snapshotPrice: amountVal.toFixed(2),
        creditsAmount: params.creditsAmount,
        snapshotMaxPets: params.snapshotMaxPets,
        snapshotExpirationDays: params.snapshotExpiration ?? (params.creditsAmount ? 365 : undefined),
      });

      // ── Audit log (Fase 14) ────────────────────────────────────────────
      await logFinancialAudit({
        crecheId: params.crecheId,
        userId: params.userId ?? 0,
        action: "invoice_create",
        referenceId: invoiceId,
        referenceType: "invoices",
        details:
          `Cobrança "${params.description}" × ${quantity} = R$${totalItemAmount.toFixed(2)}` +
          ` (tipo: ${params.type || "service"}).`,
      }, txClient);

      return invoiceId;
    };

    if (params.tx) {
      return await executeLogic(params.tx);
    } else {
      return await db.transaction(executeLogic);
    }
  }

  /**
   * Processa pagamento Stripe — delega ao fluxo padrão de pagamento manual.
   * FinancialSync chama este método em vez de escrever no banco diretamente.
   */
  static async processStripePayment(params: {
    invoiceId: number;
    crecheId: number;
    stripeSessionId: string;
    isPackagePurchase?: boolean;
    tx: any;
  }): Promise<void> {
    const { invoiceId, crecheId, stripeSessionId, isPackagePurchase, tx } = params;

    const [invoice] = await tx
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.id, invoiceId))
      .for("update");

    if (!invoice) return;

    // Idempotência: se já processado por um worker anterior, sair silenciosamente
    if (InvoiceStateMachine.isClosed(invoice.status)) {
      console.log(
        `[BillingService.processStripePayment] Fatura #${invoiceId} já está em status="${invoice.status}". Ignorando evento Stripe.`
      );
      return;
    }

    await tx.update(invoicesTable).set({
      status: "paid",
      paymentMethod: "stripe",
      updatedAt: new Date(),
    }).where(eq(invoicesTable.id, invoiceId));

    await tx.insert(transactionsTable).values({
      crecheId,
      invoiceId,
      type: "income",
      amount: invoice.amount,
      transactionDate: new Date().toISOString().split("T")[0],
      paymentMethod: "stripe",
      description: `Pagamento Stripe da Fatura #${invoiceId}`,
    });

    await tx.update(ordersTable)
      .set({ status: "paid" })
      .where(and(
        eq(ordersTable.invoiceId, invoiceId),
        eq(ordersTable.status, "pending_payment")
      ));

    if (isPackagePurchase) {
      await (await import("./credits.js")).releasePurchasedCredits(invoiceId, 0, tx);
    }

    await logFinancialAudit({
      crecheId,
      userId: 0, // 0 = sistema / Stripe
      action: "manual_payment_register",
      referenceId: invoiceId,
      referenceType: "invoices",
      details: `Fatura #${invoiceId} paga via Stripe (session: ${stripeSessionId}).`,
    }, tx);
  }
}
