import { db } from '@workspace/db';
import { ordersTable, invoicesTable, invoiceItemsTable, tutorCreditsTable } from '@workspace/db/schema';

async function run() {
  const order = await db.select().from(ordersTable).orderBy(ordersTable.id);
  console.log('Orders:', order.map(o => ({ id: o.id, status: o.status, invoiceId: o.invoiceId })));
  const invs = await db.select().from(invoicesTable);
  console.log('Invoices:', invs.map(i => ({ id: i.id, status: i.status })));
  const items = await db.select().from(invoiceItemsTable);
  console.log('Invoice Items:', items.map(i => ({ id: i.id, invId: i.invoiceId, desc: i.description })));
  const credits = await db.select().from(tutorCreditsTable);
  console.log('Credits:', credits.map(c => ({ id: c.id, tutorId: c.tutorId, total: c.totalCredits })));
  process.exit(0);
}

run().catch(console.error);
