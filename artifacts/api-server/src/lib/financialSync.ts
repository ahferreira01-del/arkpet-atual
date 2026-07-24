import { db } from "@workspace/db";
import { invoicesTable, transactionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { releasePurchasedCredits } from "../services/credits.js";

export async function applyFinancialStripeEvent(event: any): Promise<void> {
  const type: string = event?.type ?? "";
  const obj = event?.data?.object;
  if (!obj) return;

  if (type === "checkout.session.completed") {
    const metadata = obj?.metadata ?? {};
    if (metadata.invoiceId) {
      const invoiceId = Number(metadata.invoiceId);
      const crecheId = Number(metadata.crecheId);
      if (!invoiceId || !crecheId) return;

      const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId)).limit(1);
      
      if (invoice && invoice.status !== "paid" && invoice.status !== "voided" && invoice.status !== "refunded") {
        await db.transaction(async (tx) => {
          await tx.update(invoicesTable).set({ 
            status: "paid", 
            paymentMethod: "stripe",
            updatedAt: new Date()
          }).where(eq(invoicesTable.id, invoiceId));

          await tx.insert(transactionsTable).values({
            crecheId,
            invoiceId,
            type: "income",
            amount: invoice.amount,
            transactionDate: new Date().toISOString().split("T")[0],
            paymentMethod: "stripe",
            description: `Pagamento Stripe da Fatura #${invoiceId}`
          });
          
          if (metadata.packagePurchase === 'true') {
            await releasePurchasedCredits(invoiceId, 0, tx); // 0 = sistema
          }
        });
        console.log(`[financialSync] Fatura #${invoiceId} paga via Stripe checkout.session.completed`);
      }
    }
  }
}
