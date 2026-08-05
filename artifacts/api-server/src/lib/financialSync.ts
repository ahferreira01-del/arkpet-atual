import { db } from "@workspace/db";
import { invoicesTable, transactionsTable, ordersTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { releasePurchasedCredits } from "../services/credits.js";

/**
 * Fase 3 — Idempotência completa do webhook Stripe.
 *
 * O lock FOR UPDATE dentro da transação garante que dois workers processando
 * o mesmo evento simultaneamente não gerarão duas transactions, dois créditos
 * ou dois audits para o mesmo PaymentIntent.
 *
 * A verificação de status (invoice.status !== "paid") é feita DENTRO da
 * transação com o lock já adquirido — não há janela de corrida entre o
 * check e o update.
 */
export async function applyFinancialStripeEvent(event: any): Promise<void> {
  const type: string = event?.type ?? "";
  const obj = event?.data?.object;
  if (!obj) return;

  if (type === "checkout.session.completed") {
    const metadata = obj?.metadata ?? {};
    if (!metadata.invoiceId) return;

    const invoiceId = Number(metadata.invoiceId);
    const crecheId = Number(metadata.crecheId);
    if (!invoiceId || !crecheId) return;

    await db.transaction(async (tx) => {
      // Fase 3: lock pessimista é a porta de idempotência —
      // o primeiro worker a adquiri-lo processa; os demais encontram status="paid" e saem.
      const [invoice] = await tx
        .select()
        .from(invoicesTable)
        .where(eq(invoicesTable.id, invoiceId))
        .for("update");

      if (!invoice) return;

      // Se já processado (qualquer worker anterior concluiu), não fazer nada.
      if (
        invoice.status === "paid" ||
        invoice.status === "voided" ||
        invoice.status === "refunded"
      ) {
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

      // Fase 6: sincronizar Order → paid dentro da mesma transação
      await tx.update(ordersTable)
        .set({ status: "paid" })
        .where(and(
          eq(ordersTable.invoiceId, invoiceId),
          eq(ordersTable.status, "pending_payment")
        ));

      if (metadata.packagePurchase === "true") {
        await releasePurchasedCredits(invoiceId, 0, tx); // 0 = sistema
      }
    });

    console.log(`[financialSync] Fatura #${invoiceId} paga via Stripe checkout.session.completed`);
  }
}
