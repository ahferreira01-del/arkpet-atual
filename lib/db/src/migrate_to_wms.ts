import { db } from "./index";
import { catalogueItemsTable, itemBatchesTable, inventoryMovementsTable } from "./schema/financial";
import { isNotNull, gt, or } from "drizzle-orm";

async function runMigration() {
  console.log("Starting WMS Migration...");
  
  const itemsToMigrate = await db.select().from(catalogueItemsTable)
    .where(or(
      isNotNull(catalogueItemsTable.barcode),
      gt(catalogueItemsTable.stockQuantity, 0)
    ));

  console.log('Found ' + itemsToMigrate.length + ' items to migrate.');
  let migratedCount = 0;

  for (const item of itemsToMigrate) {
    if (!item.barcode && item.stockQuantity === 0) continue;

    const barcodeToUse = item.barcode && item.barcode.trim() !== '' ? item.barcode : 'MIGRATE-' + item.id;
    const cost = item.costPrice ? item.costPrice.toString() : '0';

    try {
      await db.transaction(async (tx) => {
        const [batch] = await tx.insert(itemBatchesTable).values({
          catalogueItemId: item.id,
          barcode: barcodeToUse,
          batchNumber: 'MIGRATION',
          expirationDate: null,
          costPrice: cost,
          quantityReceived: item.stockQuantity,
          currentStock: item.stockQuantity,
        }).returning();

        if (item.stockQuantity > 0) {
          await tx.insert(inventoryMovementsTable).values({
            catalogueItemId: item.id,
            batchId: batch.id,
            type: 'ENTRY',
            quantity: item.stockQuantity,
            costPrice: cost,
            referenceType: 'MIGRATION',
            referenceId: 0,
            userId: null,
          });
        }
      });
      console.log('Migrated item ' + item.id);
      migratedCount++;
    } catch (err) {
      console.error('Failed on item ' + item.id, err);
    }
  }
  console.log('Migration complete. ' + migratedCount + ' migrated.');
  process.exit(0);
}
runMigration().catch(console.error);
