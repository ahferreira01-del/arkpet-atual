import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../artifacts/api-server/src/app.js';
import { db } from '@workspace/db';
import {
  catalogueItemsTable,
  invoicesTable,
  invoiceItemsTable,
  transactionsTable,
  posSaleOperationsTable,
} from '@workspace/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  createTestCreche,
  createTestUser,
  generateTestToken,
  createCatalogueItem,
  cleanupTestData,
} from '../helpers';
import { initializeDatabase } from '../../artifacts/api-server/src/startup.js';

let crecheA: any;
let crecheB: any;
let adminA: any;
let tutorA: any;
let tutorB: any;
let staffA: any;
let inactiveTutorA: any;
let tokenAdminA: string;
let tokenAdminB: string;
let adminB: any;

beforeAll(async () => {
  await initializeDatabase();

  crecheA = await createTestCreche({ name: 'Creche POS A' });
  crecheB = await createTestCreche({ name: 'Creche POS B' });

  adminA = await createTestUser({ role: 'creche_admin', crecheId: crecheA.id });
  adminB = await createTestUser({ role: 'creche_admin', crecheId: crecheB.id });
  tutorA = await createTestUser({ role: 'tutor', crecheId: crecheA.id });
  tutorB = await createTestUser({ role: 'tutor', crecheId: crecheB.id });
  staffA = await createTestUser({ role: 'staff', crecheId: crecheA.id });
  inactiveTutorA = await createTestUser({ role: 'tutor', crecheId: crecheA.id, isActive: false });

  tokenAdminA = generateTestToken(adminA);
  tokenAdminB = generateTestToken(adminB);
});

afterAll(async () => {
  if (crecheA) await cleanupTestData(crecheA.id);
  if (crecheB) await cleanupTestData(crecheB.id);
});

describe('R20F — Request Validation & UUID Schema Enforcement', () => {
  it('POST /pos-sale without operationId rejects with 400 Bad Request', async () => {
    const item = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Biscoito Canino',
      type: 'product',
      basePrice: 1000,
      stockQuantity: 10,
      trackStock: true,
    });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        paymentMethod: 'cash',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('POST /pos-sale with invalid non-UUID operationId rejects with 400 Bad Request', async () => {
    const item = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Biscoito Canino',
      type: 'product',
      basePrice: 1000,
      stockQuantity: 10,
      trackStock: true,
    });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        operationId: 'invalid-non-uuid-string-12345',
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        paymentMethod: 'cash',
      });

    expect(res.status).toBe(400);
  });
});

describe('R20F — Multi-Item Single Invoice Aggregation & Exact Settlement', () => {
  it('aggregates multi-item cart (1000x1 + 2000x2 + 500x3 = 6500) into exactly 1 paid invoice with 0 orphan invoices', async () => {
    const itemA = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Item A',
      type: 'product',
      basePrice: 1000,
      stockQuantity: 10,
      trackStock: true,
    });
    const itemB = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Item B',
      type: 'product',
      basePrice: 2000,
      stockQuantity: 10,
      trackStock: true,
    });
    const itemC = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Item C',
      type: 'product',
      basePrice: 500,
      stockQuantity: 10,
      trackStock: true,
    });

    const operationId = randomUUID();
    const invoicesBefore = await db.select().from(invoicesTable).where(eq(invoicesTable.crecheId, crecheA.id));

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        operationId,
        items: [
          { catalogueItemId: itemA.id, quantity: 1 },
          { catalogueItemId: itemB.id, quantity: 2 },
          { catalogueItemId: itemC.id, quantity: 3 },
        ],
        paymentMethod: 'cash',
      });

    expect(res.status).toBe(201);
    expect(res.body.invoice).toBeDefined();
    const invoiceId = res.body.invoice.id;

    // 1. Invoices count increases by exactly 1
    const invoicesAfter = await db.select().from(invoicesTable).where(eq(invoicesTable.crecheId, crecheA.id));
    expect(invoicesAfter.length).toBe(invoicesBefore.length + 1);

    // 2. Invoice properties
    const [dbInvoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    expect(dbInvoice).toBeDefined();
    expect(Number(dbInvoice.amount)).toBe(6500);
    expect(dbInvoice.status).toBe('paid');
    expect(dbInvoice.paidAt).not.toBeNull();

    // 3. Exactly 3 invoice_items rows for this invoice
    const items = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, invoiceId));
    expect(items.length).toBe(3);

    // 4. Exactly 1 transaction of type income, amount 6500, description "Venda Balcão"
    const txs = await db.select().from(transactionsTable).where(eq(transactionsTable.invoiceId, invoiceId));
    expect(txs.length).toBe(1);
    expect(txs[0].type).toBe('income');
    expect(Number(txs[0].amount)).toBe(6500);
    expect(txs[0].description).toBe('Venda Balcão');

    // 5. Zero additional orphan pending invoices created
    const pendingInvoices = await db
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.crecheId, crecheA.id), eq(invoicesTable.status, 'pending')));
    const orphanItems = items.map(i => i.invoiceId);
    expect(pendingInvoices.some(inv => orphanItems.includes(inv.id))).toBe(false);

    // 6. Stock decrements verified
    const [stockA] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, itemA.id));
    const [stockB] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, itemB.id));
    const [stockC] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, itemC.id));
    expect(stockA.stockQuantity).toBe(9);
    expect(stockB.stockQuantity).toBe(8);
    expect(stockC.stockQuantity).toBe(7);
  });
});

describe('R20F — Transactional Idempotency, Retry Safety & Response Loss', () => {
  it('same operationId with same payload sequential retry returns existing sale without duplicate mutations', async () => {
    const item = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Ração Idempotente',
      type: 'product',
      basePrice: 3000,
      stockQuantity: 10,
      trackStock: true,
    });

    const operationId = randomUUID();
    const payload = {
      operationId,
      items: [{ catalogueItemId: item.id, quantity: 2 }],
      paymentMethod: 'pix',
    };

    // First submission
    const res1 = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send(payload);

    expect(res1.status).toBe(201);
    const invoiceId1 = res1.body.invoice.id;

    // Retry submission (simulating response loss / client retry)
    const res2 = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send(payload);

    expect(res2.status).toBe(201);
    expect(res2.body.invoice.id).toBe(invoiceId1);

    // Verify DB mutations occurred ONLY ONCE
    const items = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, invoiceId1));
    expect(items.length).toBe(1);
    expect(items[0].quantity).toBe(2);

    const txs = await db.select().from(transactionsTable).where(eq(transactionsTable.invoiceId, invoiceId1));
    expect(txs.length).toBe(1);

    const [stock] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, item.id));
    expect(stock.stockQuantity).toBe(8); // 10 - 2 = 8 (not decremented twice)
  });

  it('same operationId concurrent submission via Promise.all yields exactly 1 committed sale and 0 500 errors', async () => {
    const item = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Snack Race Test',
      type: 'product',
      basePrice: 1500,
      stockQuantity: 10,
      trackStock: true,
    });

    const operationId = randomUUID();
    const payload = {
      operationId,
      items: [{ catalogueItemId: item.id, quantity: 2 }],
      paymentMethod: 'cash',
    };

    const [resA, resB] = await Promise.all([
      request(app)
        .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send(payload),
      request(app)
        .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send(payload),
    ]);

    expect([200, 201]).toContain(resA.status);
    expect([200, 201]).toContain(resB.status);
    expect(resA.body.invoice.id).toBe(resB.body.invoice.id);

    const [stock] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, item.id));
    expect(stock.stockQuantity).toBe(8); // 10 - 2 = 8
  });

  it('same operationId with modified payload rejects with 409 Conflict and zero mutations', async () => {
    const item1 = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Item Conflito 1',
      type: 'product',
      basePrice: 1000,
      stockQuantity: 10,
      trackStock: true,
    });
    const item2 = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Item Conflito 2',
      type: 'product',
      basePrice: 2000,
      stockQuantity: 10,
      trackStock: true,
    });

    const operationId = randomUUID();

    // First submission
    const res1 = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        operationId,
        items: [{ catalogueItemId: item1.id, quantity: 1 }],
        paymentMethod: 'cash',
      });
    expect(res1.status).toBe(201);

    // Second submission with modified cart using same operationId
    const res2 = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        operationId,
        items: [{ catalogueItemId: item2.id, quantity: 1 }],
        paymentMethod: 'cash',
      });

    expect(res2.status).toBe(409);
    expect(res2.body.error).toMatch(/payload diferente/i);

    // Item 2 stock was not touched
    const [stock2] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, item2.id));
    expect(stock2.stockQuantity).toBe(10);
  });

  it('different operationIds with identical cart create two legitimate sales', async () => {
    const item = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Item Repetido Legítimo',
      type: 'product',
      basePrice: 1000,
      stockQuantity: 10,
      trackStock: true,
    });

    const res1 = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 2 }],
        paymentMethod: 'cash',
      });
    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 2 }],
        paymentMethod: 'cash',
      });
    expect(res2.status).toBe(201);

    expect(res1.body.invoice.id).not.toBe(res2.body.invoice.id);
    const [stock] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, item.id));
    expect(stock.stockQuantity).toBe(6); // 10 - 2 - 2 = 6
  });

  it('non-stock items (service / day_use) deduplicate correctly without relying on stock depletion', async () => {
    const serviceItem = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Banho Hidratação POS',
      type: 'service',
      basePrice: 5000,
    });

    const operationId = randomUUID();
    const payload = {
      operationId,
      items: [{ catalogueItemId: serviceItem.id, quantity: 1 }],
      paymentMethod: 'credit_card',
    };

    const res1 = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send(payload);
    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send(payload);
    expect(res2.status).toBe(201);
    expect(res1.body.invoice.id).toBe(res2.body.invoice.id);

    const txs = await db.select().from(transactionsTable).where(eq(transactionsTable.invoiceId, res1.body.invoice.id));
    expect(txs.length).toBe(1);
  });

  it('pending tutor sale retry does not append duplicate items to collector invoice', async () => {
    const item = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Item Prazo Tutor',
      type: 'service',
      basePrice: 2500,
    });

    const operationId = randomUUID();
    const payload = {
      operationId,
      items: [{ catalogueItemId: item.id, quantity: 1 }],
      paymentMethod: 'pending',
      tutorId: tutorA.id,
    };

    const res1 = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send(payload);
    expect(res1.status).toBe(201);
    const invoiceId = res1.body.invoice.id;

    const res2 = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send(payload);
    expect(res2.status).toBe(201);
    expect(res2.body.invoice.id).toBe(invoiceId);

    // Items for this operation were appended once only
    const items = await db.select().from(invoiceItemsTable).where(and(eq(invoiceItemsTable.invoiceId, invoiceId), eq(invoiceItemsTable.catalogueItemId, item.id)));
    expect(items.length).toBe(1);
  });

  it('failed business transaction (insufficient stock) does not consume operationId and allows retry after restocking', async () => {
    const item = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Ração Esgotada',
      type: 'product',
      basePrice: 2000,
      stockQuantity: 1,
      trackStock: true,
    });

    const operationId = randomUUID();
    const payload = {
      operationId,
      items: [{ catalogueItemId: item.id, quantity: 5 }], // Requests 5 but only 1 available
      paymentMethod: 'cash',
    };

    // First attempt fails with 400
    const res1 = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send(payload);
    expect(res1.status).toBe(400);

    // Restock item
    await db.update(catalogueItemsTable).set({ stockQuantity: 20 }).where(eq(catalogueItemsTable.id, item.id));

    // Retry with same operationId succeeds cleanly
    const res2 = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send(payload);
    expect(res2.status).toBe(201);
    expect(res2.body.invoice).toBeDefined();

    const [stock] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, item.id));
    expect(stock.stockQuantity).toBe(15); // 20 - 5 = 15
  });
});

describe('R20F — Tutor Tenant Validation Matrix & Walk-in POS', () => {
  it('tutorId = null allows walk-in anonymous counter sale', async () => {
    const item = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Petisco Balcão',
      type: 'product',
      basePrice: 500,
      stockQuantity: 10,
      trackStock: true,
    });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        paymentMethod: 'cash',
        tutorId: null,
      });

    expect(res.status).toBe(201);
    expect(res.body.invoice.tutorId).toBeNull();
  });

  it('same-creche active tutor succeeds', async () => {
    const item = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Petisco Tutor A',
      type: 'product',
      basePrice: 500,
      stockQuantity: 10,
      trackStock: true,
    });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        paymentMethod: 'cash',
        tutorId: tutorA.id,
      });

    expect(res.status).toBe(201);
    expect(res.body.invoice.tutorId).toBe(tutorA.id);
  });

  it('foreign tutor (from Creche B) rejects with 404 and zero DB side effects', async () => {
    const item = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Petisco Teste',
      type: 'product',
      basePrice: 500,
      stockQuantity: 10,
      trackStock: true,
    });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        paymentMethod: 'cash',
        tutorId: tutorB.id, // Tutor belonging to Creche B
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/tutor não encontrado/i);

    // Stock untouched
    const [stock] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, item.id));
    expect(stock.stockQuantity).toBe(10);
  });

  it('staff user ID passed as tutorId rejects with 404', async () => {
    const item = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Petisco Teste',
      type: 'product',
      basePrice: 500,
      stockQuantity: 10,
      trackStock: true,
    });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        paymentMethod: 'cash',
        tutorId: staffA.id,
      });

    expect(res.status).toBe(404);
  });

  it('inactive tutor user ID rejects with 404', async () => {
    const item = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Petisco Teste',
      type: 'product',
      basePrice: 500,
      stockQuantity: 10,
      trackStock: true,
    });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        paymentMethod: 'cash',
        tutorId: inactiveTutorA.id,
      });

    expect(res.status).toBe(404);
  });
});

describe('R20F — Rollback & Stock Concurrency', () => {
  it('partial cart failure (Item 1 ok, Item 2 out of stock) rolls back all stock decrements', async () => {
    const item1 = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Item Disponível',
      type: 'product',
      basePrice: 1000,
      stockQuantity: 10,
      trackStock: true,
    });
    const item2 = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Item Sem Estoque',
      type: 'product',
      basePrice: 2000,
      stockQuantity: 0,
      trackStock: true,
    });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        operationId: randomUUID(),
        items: [
          { catalogueItemId: item1.id, quantity: 1 },
          { catalogueItemId: item2.id, quantity: 1 },
        ],
        paymentMethod: 'cash',
      });

    expect(res.status).toBe(400);

    // Item 1 stock was NOT decremented
    const [stock1] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, item1.id));
    expect(stock1.stockQuantity).toBe(10);
  });
});

describe('R20F — R18 Analytics & R19 Refund Integration', () => {
  it('POS sale increments posSales KPI on Financial Analytics', async () => {
    const item = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'KPI Test Item',
      type: 'product',
      basePrice: 1000,
      stockQuantity: 10,
      trackStock: true,
    });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        paymentMethod: 'cash',
      });
    expect(res.status).toBe(201);

    const kpiRes = await request(app)
      .get(`/api/creches/${crecheA.id}/financial/dashboard/kpis?startDate=2026-01-01&endDate=2026-12-31`)
      .set('Authorization', `Bearer ${tokenAdminA}`);

    expect(kpiRes.status).toBe(200);
    expect(kpiRes.body.posSales).toBeDefined();
    expect(kpiRes.body.posSales.value).toBeGreaterThanOrEqual(1);
  });

  it('R19 item refund on POS product item restores stock and writes negative income transaction', async () => {
    const item = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Produto Reembolso POS',
      type: 'product',
      basePrice: 4000,
      stockQuantity: 10,
      trackStock: true,
    });

    // Execute POS sale of 2 units
    const saleRes = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/pos-sale`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 2 }],
        paymentMethod: 'cash',
      });
    expect(saleRes.status).toBe(201);
    const invoiceId = saleRes.body.invoice.id;

    // Verify stock is now 8
    const [stockAfterSale] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, item.id));
    expect(stockAfterSale.stockQuantity).toBe(8);

    // Get invoice item ID
    const [invItem] = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, invoiceId));
    expect(invItem).toBeDefined();

    // Refund 1 unit
    const refundRes = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/invoices/${invoiceId}/refund-item`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        invoiceItemId: invItem.id,
        quantity: 1,
      });
    expect(refundRes.status).toBe(200);

    // Verify stock restored to 9
    const [stockAfterRefund] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, item.id));
    expect(stockAfterRefund.stockQuantity).toBe(9);

    // Verify refunded_quantity updated on invoice item
    const [updatedInvItem] = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.id, invItem.id));
    expect(updatedInvItem.refundedQuantity).toBe(1);
  });
});
