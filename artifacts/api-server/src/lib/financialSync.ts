import { db } from "@workspace/db";
import { BillingService } from "../services/billing.js";

/**
 * Fase 14 — FinancialSync não escreve mais no banco diretamente.
 *
 * Ele apenas traduz eventos Stripe para chamadas do BillingService, que é a
 * única autoridade para alteração de invoices. A idempotência é garantida pelo
 * FOR UPDATE + status check dentro de BillingService.processStripePayment.
 */
export async function applyFinancialStripeEvent(event: any): Promise<void> {
  const type: string = event?.type ?? "";
  const obj = event?.data?.object;
  if (!obj) return;

  if (type === "checkout.session.completed") {
    const metadata = obj?.metadata ?? {};

    // Fase 14: log de WARN para eventos sem metadata esperada
    if (!metadata.invoiceId) {
      console.warn(
        `[financialSync] checkout.session.completed sem metadata.invoiceId — ` +
        `session: ${obj.id ?? "?"}, ignorando.`
      );
      return;
    }

    const invoiceId = Number(metadata.invoiceId);
    const crecheId = Number(metadata.crecheId);

    if (!invoiceId || !crecheId) {
      console.warn(
        `[financialSync] invoiceId=${invoiceId} ou crecheId=${crecheId} inválido — ` +
        `session: ${obj.id ?? "?"}, ignorando.`
      );
      return;
    }

    await db.transaction(async (tx) => {
      // Delegação total ao BillingService (Fase 14)
      await BillingService.processStripePayment({
        invoiceId,
        crecheId,
        stripeSessionId: obj.id ?? "",
        isPackagePurchase: metadata.packagePurchase === "true",
        tx,
      });
    });

    console.log(
      `[financialSync] Fatura #${invoiceId} processada via Stripe (session: ${obj.id}).`
    );
  }
}
