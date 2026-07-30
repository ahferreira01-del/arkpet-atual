import { db } from "@workspace/db";
import {
  tutorCreditsTable,
  invoicesTable,
  invoiceItemsTable,
  financialAuditLogsTable,
  catalogueItemsTable,
  tutorServiceCreditsTable
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logFinancialAudit } from "./audit.js";

export async function releasePurchasedCredits(
  invoiceId: number,
  paidByUserId: number,
  tx: any
): Promise<void> {

  const [invoice] = await tx
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, invoiceId));

  if (!invoice) return;
  if (invoice.creditsReleased) return; // Prevent double release

  const items = await tx
    .select()
    .from(invoiceItemsTable)
    .where(eq(invoiceItemsTable.invoiceId, invoiceId));

  const packageItems = items.filter((item: typeof invoiceItemsTable.$inferSelect) =>
    item.description.toLowerCase().includes("diária") ||
    item.description.toLowerCase().includes("diarias")
  );
  
  const serviceItems = items.filter((item: typeof invoiceItemsTable.$inferSelect) => 
    item.itemType === "service"
  );

  if (packageItems.length === 0 && serviceItems.length === 0) return; 

  let creditsAdded = false;

  for (const packageItem of packageItems) {
    const creditsMatch = packageItem.description.match(/(\d+)\s+di[aá]rias?/i);
    if (!creditsMatch) continue;

    const baseCredits = parseInt(creditsMatch[1]);
    const creditsAmount = baseCredits * (packageItem.quantity || 1);

    const expirationDate = new Date();
    expirationDate.setFullYear(expirationDate.getFullYear() + 1);

    let maxPetsPerDay = 1;
    const catalogueItems = await tx.select().from(catalogueItemsTable).where(
      and(
        eq(catalogueItemsTable.crecheId, invoice.crecheId),
        eq(catalogueItemsTable.name, packageItem.description)
      )
    ).limit(1);

    if (catalogueItems.length > 0) {
      maxPetsPerDay = catalogueItems[0].maxPetsPerDay ?? 1;
    }

    await tx.insert(tutorCreditsTable).values({
      crecheId: invoice.crecheId,
      tutorId: invoice.tutorId,
      totalCredits: creditsAmount,
      usedCredits: 0,
      maxPetsPerDay,
      expirationDate: expirationDate.toISOString().split("T")[0],
    });
    
    creditsAdded = true;
  }
  
  for (const serviceItem of serviceItems) {
    const catalogueItems = await tx.select().from(catalogueItemsTable).where(
      and(
        eq(catalogueItemsTable.crecheId, invoice.crecheId),
        eq(catalogueItemsTable.name, serviceItem.description),
        eq(catalogueItemsTable.type, "service")
      )
    ).limit(1);
    
    if (catalogueItems.length > 0) {
      await tx.insert(tutorServiceCreditsTable).values({
        crecheId: invoice.crecheId,
        tutorId: invoice.tutorId,
        catalogueItemId: catalogueItems[0].id,
        totalCredits: serviceItem.quantity || 1,
      });
      creditsAdded = true;
    }
  }
  
  if (!creditsAdded) return;

  await tx.update(invoicesTable)
    .set({ creditsReleased: true })
    .where(eq(invoicesTable.id, invoiceId));

  await logFinancialAudit({
    crecheId: invoice.crecheId,
    userId: paidByUserId,
    action: "credits_purchase",
    referenceId: invoiceId,
    referenceType: "invoices",
    details: `Créditos liberados para tutor #${invoice.tutorId} após pagamento da fatura #${invoiceId}.`,
  }, tx);
}
