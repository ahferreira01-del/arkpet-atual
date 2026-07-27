import { db } from "@workspace/db";
import { invoicesTable, transactionsTable, financialAuditLogsTable } from "@workspace/db/schema";
import { eq, and, or, sql } from "drizzle-orm";
import { releasePurchasedCredits } from "./credits.js";
import { ordersTable } from "@workspace/db/schema";
import { logFinancialAudit } from "./audit.js";

/**
 * Calcula a data de vencimento baseada no dia de mensalidade do tutor.
 * @param tutorMensalidadeDia Dia do vencimento (ex: 10). Se nulo, usa a data atual + 3 dias.
 * @param fallbackDate Data base (geralmente data da reserva ou de hoje).
 */
export function calculateDueDate(tutorMensalidadeDia: number | null | undefined, fallbackDate: Date = new Date()): string {
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

/**
 * Verifica se um tutor possui faturas em atraso.
 * Uma fatura está em atraso se o status for 'overdue' ou se for 'pending' e a data de vencimento for anterior a hoje.
 */
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
            // Usamos sql para comparar strings yyyy-mm-dd
            sql`${invoicesTable.dueDate} < ${todayStr}`
          )
        )
      )
    )
    .limit(1);

  return !!overdue;
}

export async function processManualPayment(invoiceId: number, crecheId: number, userId: number, paymentMethod: "stripe" | "pix" | "cash" | "credit_card" | "bank_slip") {
  return await db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.crecheId, crecheId)));

    if (!invoice) throw new Error("Fatura não encontrada");
    if (invoice.status === "paid" || invoice.status === "voided" || invoice.status === "refunded") {
      throw new Error("A fatura já foi processada ou cancelada");
    }

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
      description: `Pagamento da Fatura #${invoice.id}`
    });

    await logFinancialAudit({
      crecheId: invoice.crecheId,
      userId,
      action: "manual_payment_register",
      referenceId: invoice.id,
      referenceType: "invoices",
      details: `Fatura #${invoice.id} paga via ${paymentMethod} e conciliada.`
    }, tx);

    await releasePurchasedCredits(invoice.id, userId, tx);

    await tx.update(ordersTable)
      .set({ status: "paid" })
      .where(and(eq(ordersTable.invoiceId, invoiceId), eq(ordersTable.status, "pending_payment")));

    return invoice;
  });
}

export async function approveReceipt(invoiceId: number, crecheId: number, userId: number) {
  return await db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.crecheId, crecheId)));

    if (!invoice) throw new Error("Fatura não encontrada");
    if (invoice.status === "paid" || invoice.status === "voided" || invoice.status === "refunded") {
      throw new Error("A fatura já foi processada ou cancelada");
    }

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
      description: `Comprovante aprovado da Fatura #${invoice.id}`
    });

    await logFinancialAudit({
      crecheId: invoice.crecheId,
      userId,
      action: "payment_approve",
      referenceId: invoice.id,
      referenceType: "invoices",
      details: `Comprovante da Fatura #${invoice.id} aprovado.`
    }, tx);

    await releasePurchasedCredits(invoice.id, userId, tx);

    await tx.update(ordersTable)
      .set({ status: "paid" })
      .where(and(eq(ordersTable.invoiceId, invoiceId), eq(ordersTable.status, "pending_payment")));

    return invoice;
  });
}

export async function voidInvoice(invoiceId: number, crecheId: number, userId: number) {
  const [invoice] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.crecheId, crecheId)));
  if (!invoice) throw new Error("Fatura não encontrada");
  if (invoice.status === "paid" || invoice.status === "refunded" || invoice.status === "voided") {
    throw new Error("A fatura já foi processada ou cancelada");
  }

  await db.update(invoicesTable).set({ status: "voided", updatedAt: new Date() }).where(eq(invoicesTable.id, invoiceId));

  await logFinancialAudit({
    crecheId,
    userId,
    action: "invoice_void",
    referenceId: invoice.id,
    referenceType: "invoices",
    details: `Fatura #${invoice.id} cancelada.`
  }, db);

  return invoice;
}

export async function refundInvoice(invoiceId: number, crecheId: number, userId: number) {
  return await db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoicesTable).where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.crecheId, crecheId)));
    if (!invoice) throw new Error("Fatura não encontrada");
    if (invoice.status !== "paid") throw new Error("Apenas faturas pagas podem ser estornadas");

    await tx.update(invoicesTable).set({ status: "refunded", updatedAt: new Date() }).where(eq(invoicesTable.id, invoiceId));

    await tx.insert(transactionsTable).values({
      crecheId: invoice.crecheId,
      invoiceId: invoice.id,
      type: "expense",
      amount: invoice.amount,
      transactionDate: new Date().toISOString().split("T")[0],
      paymentMethod: invoice.paymentMethod || "pix",
      description: `Estorno da Fatura #${invoice.id}`
    });

    await logFinancialAudit({
      crecheId,
      userId,
      action: "invoice_refund",
      referenceId: invoice.id,
      referenceType: "invoices",
      details: `Fatura #${invoice.id} estornada.`
    }, tx);

    return invoice;
  });
}
