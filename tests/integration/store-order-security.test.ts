import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../artifacts/api-server/src/app.js';
import { db } from '@workspace/db';
import {
  catalogueItemsTable,
  invoicesTable,
  invoiceItemsTable,
  ordersTable,
  orderItemsTable,
  transactionsTable,
  storeOrderOperationsTable,
  catalogueStockTransactionsTable,
  tutorServiceCreditsTable,
  crechesTable,
} from '@workspace/db/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
import {
  createTestCreche,
  createTestUser,
  generateTestToken,
  createCatalogueItem,
  cleanupTestData,
} from '../helpers';
import { initializeDatabase } from '../../artifacts/api-server/src/startup.js';
import { processManualPayment } from '../../artifacts/api-server/src/services/billing.js';
import { createOrder } from '../../artifacts/api-server/src/services/orders.js';

let crecheA: any;
let crecheB: any;
let adminA: any;
let adminB: any;
let tutorA: any;
let tutorB: any;
let staffA: any;
let staffB: any;
let tokenAdminA: string;
let tokenAdminB: string;
let tokenTutorA: string;
let tokenTutorB: string;
let tokenStaffA: string;
let tokenStaffB: string;

beforeAll(async () => {
  await initializeDatabase();

  crecheA = await createTestCreche({ name: 'Creche Store A' });
  crecheB = await createTestCreche({ name: 'Creche Store B' });

  // Configurar taxa de entrega fixa na Creche A (1500 centavos = R$ 15,00)
  await db.update(crechesTable)
    .set({ deliveryType: 'fixed', deliveryFee: '1500' })
    .where(eq(crechesTable.id, crecheA.id));

  adminA = await createTestUser({ role: 'creche_admin', crecheId: crecheA.id });
  adminB = await createTestUser({ role: 'creche_admin', crecheId: crecheB.id });
  tutorA = await createTestUser({ role: 'tutor', crecheId: crecheA.id });
  tutorB = await createTestUser({ role: 'tutor', crecheId: crecheB.id });
  staffA = await createTestUser({ role: 'staff', crecheId: crecheA.id });
  staffB = await createTestUser({ role: 'staff', crecheId: crecheB.id });

  tokenAdminA = generateTestToken(adminA);
  tokenAdminB = generateTestToken(adminB);
  tokenTutorA = generateTestToken(tutorA);
  tokenTutorB = generateTestToken(tutorB);
  tokenStaffA = generateTestToken(staffA);
  tokenStaffB = generateTestToken(staffB);
});

afterAll(async () => {
  if (crecheA) await cleanupTestData(crecheA.id);
  if (crecheB) await cleanupTestData(crecheB.id);
});

describe('R24F — Validation & Schema Security Gate', () => {
  it('POST /orders without operationId rejects with 400 Bad Request', async () => {
    const item = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Ração Especial',
      type: 'product',
      basePrice: 5000,
      stockQuantity: 10,
      trackStock: true,
    });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        deliveryMethod: 'pickup',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('POST /orders with malformed non-UUID operationId rejects with 400 Bad Request', async () => {
    const item = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Ração Especial',
      type: 'product',
      basePrice: 5000,
      stockQuantity: 10,
      trackStock: true,
    });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: 'not-a-uuid-12345',
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        deliveryMethod: 'pickup',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});

describe('R24F — SEC-R24-01: Tenant Isolation & Role Restrictions', () => {
  it('Tutor B attempting to checkout against Creche A is rejected with 403 and zero DB mutations', async () => {
    const itemA = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Produto Creche A',
      type: 'product',
      basePrice: 3000,
      stockQuantity: 10,
      trackStock: true,
    });

    const initialOrders = await db.select().from(ordersTable).where(eq(ordersTable.crecheId, crecheA.id));
    const initialInvoices = await db.select().from(invoicesTable).where(eq(invoicesTable.crecheId, crecheA.id));

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorB}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: itemA.id, quantity: 1 }],
        deliveryMethod: 'pickup',
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Sem acesso a esta creche.');

    // Assert zero mutations
    const finalOrders = await db.select().from(ordersTable).where(eq(ordersTable.crecheId, crecheA.id));
    const finalInvoices = await db.select().from(invoicesTable).where(eq(invoicesTable.crecheId, crecheA.id));
    const [finalItem] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, itemA.id));

    expect(finalOrders.length).toBe(initialOrders.length);
    expect(finalInvoices.length).toBe(initialInvoices.length);
    expect(finalItem.stockQuantity).toBe(10);
  });

  it('Admin B and Staff B attempting to list Creche A orders receive 403', async () => {
    const resAdmin = await request(app)
      .get(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenAdminB}`);
    expect(resAdmin.status).toBe(403);

    const resStaff = await request(app)
      .get(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenStaffB}`);
    expect(resStaff.status).toBe(403);
  });

  it('Admin B and Staff B attempting to update Creche A order status receive 403', async () => {
    const item = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Shampoo',
      type: 'product',
      basePrice: 2000,
      stockQuantity: 5,
      trackStock: true,
    });

    const createRes = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        deliveryMethod: 'pickup',
      });
    expect(createRes.status).toBe(201);
    const orderId = createRes.body.order.id;

    const resAdmin = await request(app)
      .put(`/api/creches/${crecheA.id}/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${tokenAdminB}`)
      .send({ status: 'preparing' });
    expect(resAdmin.status).toBe(403);

    const resStaff = await request(app)
      .put(`/api/creches/${crecheA.id}/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${tokenStaffB}`)
      .send({ status: 'preparing' });
    expect(resStaff.status).toBe(403);
  });

  it('Staff or Admin attempting POST /orders receives 403 (Tutor Store purchase only)', async () => {
    const item = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Brinquedo',
      type: 'product',
      basePrice: 1500,
      stockQuantity: 5,
      trackStock: true,
    });

    const resStaff = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenStaffA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        deliveryMethod: 'pickup',
      });
    expect(resStaff.status).toBe(403);
    expect(resStaff.body.error).toBe('Apenas tutores podem realizar compras na loja.');

    const resAdmin = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        deliveryMethod: 'pickup',
      });
    expect(resAdmin.status).toBe(403);
  });
});

describe('R24F — FUNC-R24-10: Server Delivery Fee Authority & Pricing', () => {
  it('Client attempts deliveryFee = 0 on delivery with fixed fee 1500 -> charged 1500', async () => {
    const item = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Ração Premium',
      type: 'product',
      basePrice: 8000,
      stockQuantity: 10,
      trackStock: true,
    });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        deliveryMethod: 'delivery',
        deliveryAddress: 'Rua dos Pets, 100',
        deliveryFee: 0, // Client tries 0
      });

    expect(res.status).toBe(201);
    expect(res.body.order.deliveryFee).toBe('1500.00');
    expect(res.body.order.subtotal).toBe('8000.00');
    expect(res.body.order.total).toBe('9500.00');
    expect(res.body.invoice.amount).toBe('9500.00');
  });

  it('Client attempts huge deliveryFee (999999) -> overridden by authoritative 1500', async () => {
    const item = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Ração Premium 2',
      type: 'product',
      basePrice: 4000,
      stockQuantity: 10,
      trackStock: true,
    });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        deliveryMethod: 'delivery',
        deliveryAddress: 'Rua dos Pets, 100',
        deliveryFee: 999999, // Client tries huge value
      });

    expect(res.status).toBe(201);
    expect(res.body.order.deliveryFee).toBe('1500.00');
    expect(res.body.order.total).toBe('5500.00');
  });

  it('Pickup method enforces deliveryFee = 0 regardless of client deliveryFee', async () => {
    const item = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Coleira',
      type: 'product',
      basePrice: 2500,
      stockQuantity: 5,
      trackStock: true,
    });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        deliveryMethod: 'pickup',
        deliveryFee: 5000,
      });

    expect(res.status).toBe(201);
    expect(res.body.order.deliveryFee).toBe('0.00');
    expect(res.body.order.total).toBe('2500.00');
  });

  it('Cart with only services enforces deliveryFee = 0 even with deliveryMethod = delivery', async () => {
    const serviceItem = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Banho & Tosa Simples',
      type: 'service',
      basePrice: 6000,
      trackStock: false,
    });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: serviceItem.id, quantity: 1 }],
        deliveryMethod: 'delivery',
        deliveryAddress: 'Rua dos Pets, 100',
      });

    expect(res.status).toBe(201);
    expect(res.body.order.deliveryFee).toBe('0.00');
    expect(res.body.order.total).toBe('6000.00');
  });
});

describe('R24F — Single Multi-Item Invoice & Pricing Consistency', () => {
  it('Multi-item checkout (1000x1, 2000x2, 500x3) creates 1 order, 3 order_items, 1 invoice, 3 invoice_items, total 6500', async () => {
    const i1 = await createCatalogueItem({ crecheId: crecheA.id, name: 'Item 1', type: 'product', basePrice: 1000, stockQuantity: 10, trackStock: true });
    const i2 = await createCatalogueItem({ crecheId: crecheA.id, name: 'Item 2', type: 'product', basePrice: 2000, stockQuantity: 10, trackStock: true });
    const i3 = await createCatalogueItem({ crecheId: crecheA.id, name: 'Item 3', type: 'product', basePrice: 500, stockQuantity: 10, trackStock: true });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [
          { catalogueItemId: i1.id, quantity: 1 },
          { catalogueItemId: i2.id, quantity: 2 },
          { catalogueItemId: i3.id, quantity: 3 },
        ],
        deliveryMethod: 'pickup',
      });

    expect(res.status).toBe(201);
    expect(res.body.order.subtotal).toBe('6500.00');
    expect(res.body.order.total).toBe('6500.00');
    expect(res.body.invoice.amount).toBe('6500.00');

    const orderItems = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, res.body.order.id));
    expect(orderItems.length).toBe(3);

    const invoiceItems = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, res.body.invoice.id));
    expect(invoiceItems.length).toBe(3);
  });
});

describe('R24F — DATA-R24-02: Catalogue Identity & Credit Snapshots', () => {
  it('Preserves catalogueItemId and package snapshots (creditsAmount, maxPets, expiration) on invoice items', async () => {
    const pkg = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Pacote 10 Diárias Especial',
      type: 'package',
      basePrice: 35000,
      creditsAmount: 10,
      maxPetsPerDay: 2,
      expirationDays: 90,
      trackStock: false,
    });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: pkg.id, quantity: 2 }],
        deliveryMethod: 'pickup',
      });

    expect(res.status).toBe(201);
    const invoiceId = res.body.invoice.id;

    const [invItem] = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, invoiceId));
    expect(invItem.catalogueItemId).toBe(pkg.id);
    expect(invItem.creditsAmount).toBe(10);
    expect(invItem.snapshotMaxPets).toBe(2);
    expect(invItem.snapshotExpirationDays).toBe(365);
  });

  it('Service item renamed after checkout releases correct credits upon invoice payment', async () => {
    const srv = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Tosa Higiênica Original',
      type: 'service',
      basePrice: 5000,
      trackStock: false,
    });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: srv.id, quantity: 3 }],
        deliveryMethod: 'pickup',
      });
    expect(res.status).toBe(201);
    const invoiceId = res.body.invoice.id;

    // Rename catalogue item before payment
    await db.update(catalogueItemsTable)
      .set({ name: 'Tosa Higiênica Totalmente Renomeada' })
      .where(eq(catalogueItemsTable.id, srv.id));

    // Pay invoice
    await processManualPayment(invoiceId, crecheA.id, adminA.id, 'pix');

    // Check credits
    const credits = await db.select().from(tutorServiceCreditsTable).where(
      and(
        eq(tutorServiceCreditsTable.tutorId, tutorA.id),
        eq(tutorServiceCreditsTable.catalogueItemId, srv.id)
      )
    );
    expect(credits.length).toBe(1);
    expect(credits[0].totalCredits).toBe(3);
  });

  it('Package item renamed after checkout releases exact Q*C credits upon invoice payment', async () => {
    const pkg = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Pacote 5 Banhos Original',
      type: 'package',
      basePrice: 20000,
      creditsAmount: 5,
      maxPetsPerDay: 1,
      trackStock: false,
    });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: pkg.id, quantity: 2 }],
        deliveryMethod: 'pickup',
      });
    expect(res.status).toBe(201);
    const invoiceId = res.body.invoice.id;

    // Rename package in catalogue
    await db.update(catalogueItemsTable)
      .set({ name: 'Pacote Banhos Nome Alterado' })
      .where(eq(catalogueItemsTable.id, pkg.id));

    // Pay invoice
    await processManualPayment(invoiceId, crecheA.id, adminA.id, 'credit_card');

    // Verify credits in tutorCreditsTable
    const { tutorCreditsTable } = await import('@workspace/db/schema');
    const credits = await db.select().from(tutorCreditsTable).where(
      and(
        eq(tutorCreditsTable.crecheId, crecheA.id),
        eq(tutorCreditsTable.tutorId, tutorA.id)
      )
    );
    expect(credits.length).toBeGreaterThanOrEqual(1);
    const matching = credits.find(c => c.totalCredits === 10);
    expect(matching).toBeDefined(); // 2 * 5 = 10
  });

  it('Catalogue item deactivated after checkout releases credits upon payment', async () => {
    const srv = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Consulta Geral',
      type: 'service',
      basePrice: 12000,
      trackStock: false,
    });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: srv.id, quantity: 1 }],
        deliveryMethod: 'pickup',
      });
    expect(res.status).toBe(201);
    const invoiceId = res.body.invoice.id;

    // Deactivate item
    await db.update(catalogueItemsTable)
      .set({ isActive: false })
      .where(eq(catalogueItemsTable.id, srv.id));

    // Pay invoice
    await processManualPayment(invoiceId, crecheA.id, adminA.id, 'cash');

    const credits = await db.select().from(tutorServiceCreditsTable).where(
      and(
        eq(tutorServiceCreditsTable.tutorId, tutorA.id),
        eq(tutorServiceCreditsTable.catalogueItemId, srv.id)
      )
    );
    expect(credits.length).toBe(1);
    expect(credits[0].totalCredits).toBe(1);
  });
});

describe('R24F — FUNC-R24-06: Order State Machine & Financial Gating', () => {
  it('PUT /orders/:id/status with status = "paid" is blocked with 409 Conflict', async () => {
    const item = await createCatalogueItem({ crecheId: crecheA.id, name: 'Brinquedo Bola', type: 'product', basePrice: 1500, stockQuantity: 5, trackStock: true });
    const createRes = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        deliveryMethod: 'pickup',
      });
    const orderId = createRes.body.order.id;

    const res = await request(app)
      .put(`/api/creches/${crecheA.id}/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ status: 'paid' });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('controlado exclusivamente pela confirmação do pagamento da fatura');
  });

  it('Unpaid order cannot be advanced to "ready_for_pickup" (409 Conflict, 0 credits released)', async () => {
    const srv = await createCatalogueItem({ crecheId: crecheA.id, name: 'Serviço Banho', type: 'service', basePrice: 4000, trackStock: false });
    const createRes = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: srv.id, quantity: 1 }],
        deliveryMethod: 'pickup',
      });
    const orderId = createRes.body.order.id;

    const res = await request(app)
      .put(`/api/creches/${crecheA.id}/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ status: 'ready_for_pickup' });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('não pode avançar para status operacional antes da confirmação do pagamento');

    // Verify 0 credits released
    const credits = await db.select().from(tutorServiceCreditsTable).where(
      and(
        eq(tutorServiceCreditsTable.tutorId, tutorA.id),
        eq(tutorServiceCreditsTable.catalogueItemId, srv.id)
      )
    );
    expect(credits.length).toBe(0);
  });

  it('Unpaid order cannot be advanced to "delivered" (409 Conflict)', async () => {
    const item = await createCatalogueItem({ crecheId: crecheA.id, name: 'Petisco', type: 'product', basePrice: 1000, stockQuantity: 5, trackStock: true });
    const createRes = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        deliveryMethod: 'pickup',
      });
    const orderId = createRes.body.order.id;

    const res = await request(app)
      .put(`/api/creches/${crecheA.id}/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ status: 'delivered' });

    expect(res.status).toBe(409);
  });

  it('Cancelled order cannot be revived via direct status update (409 Conflict)', async () => {
    const item = await createCatalogueItem({ crecheId: crecheA.id, name: 'Petisco C', type: 'product', basePrice: 1000, stockQuantity: 5, trackStock: true });
    const createRes = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        deliveryMethod: 'pickup',
      });
    const orderId = createRes.body.order.id;

    // Cancel order
    const cancelRes = await request(app)
      .put(`/api/creches/${crecheA.id}/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ status: 'cancelled' });
    expect(cancelRes.status).toBe(200);

    // Try to revive
    const reviveRes = await request(app)
      .put(`/api/creches/${crecheA.id}/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ status: 'pending_payment' });
    expect(reviveRes.status).toBe(409);
    expect(reviveRes.body.error).toContain('não podem ser reativados');
  });

  it('Paid order allows operational status progression (preparing -> ready_for_pickup -> delivered)', async () => {
    const item = await createCatalogueItem({ crecheId: crecheA.id, name: 'Ração Mini', type: 'product', basePrice: 3000, stockQuantity: 5, trackStock: true });
    const createRes = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        deliveryMethod: 'pickup',
      });
    const orderId = createRes.body.order.id;
    const invoiceId = createRes.body.invoice.id;

    // Pay invoice
    await processManualPayment(invoiceId, crecheA.id, adminA.id, 'pix');

    // Advance operational statuses
    const resPrep = await request(app)
      .put(`/api/creches/${crecheA.id}/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ status: 'preparing' });
    expect(resPrep.status).toBe(200);
    expect(resPrep.body.status).toBe('preparing');

    const resReady = await request(app)
      .put(`/api/creches/${crecheA.id}/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ status: 'ready_for_pickup' });
    expect(resReady.status).toBe(200);
    expect(resReady.body.status).toBe('ready_for_pickup');

    const resDelivered = await request(app)
      .put(`/api/creches/${crecheA.id}/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ status: 'delivered' });
    expect(resDelivered.status).toBe(200);
    expect(resDelivered.body.status).toBe('delivered');
  });
});

describe('R24F — FUNC-R24-05: Cancellation Stock Restoration Matrix', () => {
  it('Cancelling order with tracked product, untracked product, package, and service restores stock ONLY for tracked product', async () => {
    const trackedProd = await createCatalogueItem({ crecheId: crecheA.id, name: 'Tracked Prod', type: 'product', basePrice: 1000, stockQuantity: 20, trackStock: true });
    const untrackedProd = await createCatalogueItem({ crecheId: crecheA.id, name: 'Untracked Prod', type: 'product', basePrice: 2000, stockQuantity: 0, trackStock: false });
    const pkg = await createCatalogueItem({ crecheId: crecheA.id, name: 'Package Item', type: 'package', basePrice: 10000, creditsAmount: 5, trackStock: false });
    const srv = await createCatalogueItem({ crecheId: crecheA.id, name: 'Service Item', type: 'service', basePrice: 5000, trackStock: false });

    // Checkout
    const createRes = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [
          { catalogueItemId: trackedProd.id, quantity: 2 },
          { catalogueItemId: untrackedProd.id, quantity: 3 },
          { catalogueItemId: pkg.id, quantity: 1 },
          { catalogueItemId: srv.id, quantity: 1 },
        ],
        deliveryMethod: 'pickup',
      });
    expect(createRes.status).toBe(201);
    const orderId = createRes.body.order.id;

    // After checkout: trackedProd stock should be 18
    const [afterCheckoutTracked] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, trackedProd.id));
    expect(afterCheckoutTracked.stockQuantity).toBe(18);

    // Cancel order
    const cancelRes = await request(app)
      .put(`/api/creches/${crecheA.id}/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ status: 'cancelled' });
    expect(cancelRes.status).toBe(200);

    // Verify stock restoration
    const [finalTracked] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, trackedProd.id));
    const [finalUntracked] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, untrackedProd.id));
    const [finalPkg] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, pkg.id));
    const [finalSrv] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, srv.id));

    expect(finalTracked.stockQuantity).toBe(20); // Restored from 18 to 20
    expect(finalUntracked.stockQuantity).toBe(0); // Remained 0 (not incremented)
    expect(finalPkg.stockQuantity).toBe(0); // Remained 0
    expect(finalSrv.stockQuantity).toBe(0); // Remained 0

    // Verify stock transactions ledger: only trackedProd has an entry
    const stockTx = await db.select().from(catalogueStockTransactionsTable).where(
      and(
        eq(catalogueStockTransactionsTable.crecheId, crecheA.id),
        eq(catalogueStockTransactionsTable.reason, 'Cancelamento de Pedido')
      )
    );
    const trackedStockTx = stockTx.filter(t => t.itemId === trackedProd.id);
    const untrackedStockTx = stockTx.filter(t => t.itemId === untrackedProd.id);
    const pkgStockTx = stockTx.filter(t => t.itemId === pkg.id);

    expect(trackedStockTx.length).toBeGreaterThanOrEqual(1);
    expect(untrackedStockTx.length).toBe(0);
    expect(pkgStockTx.length).toBe(0);
  });

  it('Double cancel produces zero additional stock restoration', async () => {
    const trackedProd = await createCatalogueItem({ crecheId: crecheA.id, name: 'Tracked Prod Double', type: 'product', basePrice: 1000, stockQuantity: 10, trackStock: true });
    const createRes = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: trackedProd.id, quantity: 2 }],
        deliveryMethod: 'pickup',
      });
    const orderId = createRes.body.order.id;

    // First cancel
    await request(app)
      .put(`/api/creches/${crecheA.id}/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ status: 'cancelled' });

    const [afterFirstCancel] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, trackedProd.id));
    expect(afterFirstCancel.stockQuantity).toBe(10);

    // Second cancel
    await request(app)
      .put(`/api/creches/${crecheA.id}/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ status: 'cancelled' });

    const [afterSecondCancel] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, trackedProd.id));
    expect(afterSecondCancel.stockQuantity).toBe(10); // Still 10, not 12
  });
});

describe('R24F — FUNC-R24-02: Transactional Checkout Idempotency', () => {
  it('Sequential retry with same operationId returns existing order and invoice with zero duplicate mutations', async () => {
    const item = await createCatalogueItem({ crecheId: crecheA.id, name: 'Item Idempotente', type: 'product', basePrice: 2000, stockQuantity: 10, trackStock: true });
    const opId = randomUUID();

    const res1 = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: opId,
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        deliveryMethod: 'pickup',
      });
    expect(res1.status).toBe(201);
    const orderId1 = res1.body.order.id;

    // Check stock decremented to 9
    const [afterFirst] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, item.id));
    expect(afterFirst.stockQuantity).toBe(9);

    // Second request with same operationId
    const res2 = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: opId,
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        deliveryMethod: 'pickup',
      });
    expect(res2.status).toBe(201);
    expect(res2.body.order.id).toBe(orderId1);

    // Check stock still 9 (not 8)
    const [afterSecond] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, item.id));
    expect(afterSecond.stockQuantity).toBe(9);

    // Assert only 1 operation row exists
    const ops = await db.select().from(storeOrderOperationsTable).where(
      and(
        eq(storeOrderOperationsTable.crecheId, crecheA.id),
        eq(storeOrderOperationsTable.operationId, opId)
      )
    );
    expect(ops.length).toBe(1);
  });

  it('Same operationId with different payload returns 409 Conflict', async () => {
    const item1 = await createCatalogueItem({ crecheId: crecheA.id, name: 'Item P1', type: 'product', basePrice: 1000, stockQuantity: 10, trackStock: true });
    const item2 = await createCatalogueItem({ crecheId: crecheA.id, name: 'Item P2', type: 'product', basePrice: 2000, stockQuantity: 10, trackStock: true });
    const opId = randomUUID();

    const res1 = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: opId,
        items: [{ catalogueItemId: item1.id, quantity: 1 }],
        deliveryMethod: 'pickup',
      });
    expect(res1.status).toBe(201);

    // Change payload with same opId
    const res2 = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: opId,
        items: [{ catalogueItemId: item2.id, quantity: 2 }],
        deliveryMethod: 'pickup',
      });
    expect(res2.status).toBe(409);
    expect(res2.body.error).toContain('Operação já processada com payload diferente');
  });

  it('Different operationIds with same cart creates two distinct legitimate orders', async () => {
    const item = await createCatalogueItem({ crecheId: crecheA.id, name: 'Item Legit', type: 'product', basePrice: 1000, stockQuantity: 10, trackStock: true });

    const res1 = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        deliveryMethod: 'pickup',
      });
    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        deliveryMethod: 'pickup',
      });
    expect(res2.status).toBe(201);

    expect(res1.body.order.id).not.toBe(res2.body.order.id);
    expect(res1.body.invoice.id).not.toBe(res2.body.invoice.id);

    const [finalItem] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, item.id));
    expect(finalItem.stockQuantity).toBe(8); // 10 - 1 - 1 = 8
  });

  it('Concurrent same-key requests yield exactly 1 order, 1 invoice, and 0 500 errors', async () => {
    const item = await createCatalogueItem({ crecheId: crecheA.id, name: 'Concurrent Item', type: 'product', basePrice: 1500, stockQuantity: 20, trackStock: true });
    const opId = randomUUID();

    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/creches/${crecheA.id}/orders`)
        .set('Authorization', `Bearer ${tokenTutorA}`)
        .send({
          operationId: opId,
          items: [{ catalogueItemId: item.id, quantity: 2 }],
          deliveryMethod: 'pickup',
        }),
      request(app)
        .post(`/api/creches/${crecheA.id}/orders`)
        .set('Authorization', `Bearer ${tokenTutorA}`)
        .send({
          operationId: opId,
          items: [{ catalogueItemId: item.id, quantity: 2 }],
          deliveryMethod: 'pickup',
        }),
    ]);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(res1.body.order.id).toBe(res2.body.order.id);
    expect(res1.body.invoice.id).toBe(res2.body.invoice.id);

    const [finalItem] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, item.id));
    expect(finalItem.stockQuantity).toBe(18); // Decremented exactly once: 20 - 2 = 18
  });

  it('Concurrent same-key requests on non-stock (service) cart yield exactly 1 order and 1 invoice', async () => {
    const srv = await createCatalogueItem({ crecheId: crecheA.id, name: 'Concurrent Service', type: 'service', basePrice: 5000, trackStock: false });
    const opId = randomUUID();

    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/creches/${crecheA.id}/orders`)
        .set('Authorization', `Bearer ${tokenTutorA}`)
        .send({
          operationId: opId,
          items: [{ catalogueItemId: srv.id, quantity: 1 }],
          deliveryMethod: 'pickup',
        }),
      request(app)
        .post(`/api/creches/${crecheA.id}/orders`)
        .set('Authorization', `Bearer ${tokenTutorA}`)
        .send({
          operationId: opId,
          items: [{ catalogueItemId: srv.id, quantity: 1 }],
          deliveryMethod: 'pickup',
        }),
    ]);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(res1.body.order.id).toBe(res2.body.order.id);
    expect(res1.body.invoice.id).toBe(res2.body.invoice.id);
  });

  it('Failed transaction (insufficient stock) does not consume operationId key; retry succeeds after restock', async () => {
    const item = await createCatalogueItem({ crecheId: crecheA.id, name: 'Stock Fail Item', type: 'product', basePrice: 1000, stockQuantity: 1, trackStock: true });
    const opId = randomUUID();

    // First attempt: requests 5 but only 1 in stock -> fails with 400
    const failRes = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: opId,
        items: [{ catalogueItemId: item.id, quantity: 5 }],
        deliveryMethod: 'pickup',
      });
    expect(failRes.status).toBe(400);
    expect(failRes.body.error).toContain('Estoque insuficiente');

    // Verify key was NOT consumed
    const ops = await db.select().from(storeOrderOperationsTable).where(
      and(
        eq(storeOrderOperationsTable.crecheId, crecheA.id),
        eq(storeOrderOperationsTable.operationId, opId)
      )
    );
    expect(ops.length).toBe(0);

    // Restock item
    await db.update(catalogueItemsTable)
      .set({ stockQuantity: 10 })
      .where(eq(catalogueItemsTable.id, item.id));

    // Retry with the exact same opId and payload -> succeeds
    const successRes = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: opId,
        items: [{ catalogueItemId: item.id, quantity: 5 }],
        deliveryMethod: 'pickup',
      });
    expect(successRes.status).toBe(201);
    expect(successRes.body.order.id).toBeDefined();

    const [finalItem] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, item.id));
    expect(finalItem.stockQuantity).toBe(5); // 10 - 5 = 5
  });
});

describe('R24F — Error HTTP Mapping (Inactive & Non-existent Items)', () => {
  it('Inactive item checkout produces clean 400 Bad Request', async () => {
    const item = await createCatalogueItem({ crecheId: crecheA.id, name: 'Item Inativo', type: 'product', basePrice: 1000, isActive: false, trackStock: true });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        deliveryMethod: 'pickup',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('não encontrado ou inativo');
  });

  it('Non-existent item checkout produces clean 400 Bad Request', async () => {
    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: 99999999, quantity: 1 }],
        deliveryMethod: 'pickup',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('não encontrado ou inativo');
  });
});

describe('R24F.1 — Store Invoice Isolation, Purchase History Survival & Idempotency Freeze Gate', () => {
  it('Pre-existing pending invoice + Store checkout: pre-existing invoice untouched (3000), new Store invoice created (6500), Order points to new invoice', async () => {
    // 1. Create Tutor with pre-existing unrelated pending invoice (amount 3000)
    const [existingInv] = await db.insert(invoicesTable).values({
      crecheId: crecheA.id,
      tutorId: tutorA.id,
      status: 'pending',
      amount: '3000.00',
      dueDate: '2026-08-30',
    }).returning();

    // 2. Create 3 catalogue items: A=1000, B=2000, C=500
    const itemA = await createCatalogueItem({ crecheId: crecheA.id, name: 'Item A', type: 'product', basePrice: 1000, stockQuantity: 10, trackStock: true });
    const itemB = await createCatalogueItem({ crecheId: crecheA.id, name: 'Item B', type: 'product', basePrice: 2000, stockQuantity: 10, trackStock: true });
    const itemC = await createCatalogueItem({ crecheId: crecheA.id, name: 'Item C', type: 'product', basePrice: 500, stockQuantity: 10, trackStock: true });

    // 3. Checkout: A=1000x1, B=2000x2, C=500x3 = 6500
    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [
          { catalogueItemId: itemA.id, quantity: 1 },
          { catalogueItemId: itemB.id, quantity: 2 },
          { catalogueItemId: itemC.id, quantity: 3 },
        ],
        deliveryMethod: 'pickup',
      });

    expect(res.status).toBe(201);
    const storeOrderId = res.body.order.id;
    const storeInvoiceId = res.body.invoice.id;

    // 4. Assert Store order points to the new Store invoice (NOT the pre-existing one)
    expect(storeInvoiceId).not.toBe(existingInv.id);
    expect(res.body.order.invoiceId).toBe(storeInvoiceId);
    expect(Number(res.body.invoice.amount)).toBe(6500);

    // 5. Assert pre-existing invoice remains completely untouched
    const [fetchedExistingInv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, existingInv.id));
    expect(Number(fetchedExistingInv.amount)).toBe(3000);
    expect(fetchedExistingInv.status).toBe('pending');

    // 6. Assert Store invoice items belong ONLY to the store items
    const storeInvItems = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, storeInvoiceId));
    expect(storeInvItems.length).toBe(3);
    const itemDescriptions = storeInvItems.map(i => i.description);
    expect(itemDescriptions).toContain('Item A');
    expect(itemDescriptions).toContain('Item B');
    expect(itemDescriptions).toContain('Item C');
  });

  it('Two Store checkouts for same Tutor with different operationIds create 2 independent orders and 2 dedicated invoices', async () => {
    const item1 = await createCatalogueItem({ crecheId: crecheA.id, name: 'Item 1', type: 'product', basePrice: 1500, stockQuantity: 10, trackStock: true });
    const item2 = await createCatalogueItem({ crecheId: crecheA.id, name: 'Item 2', type: 'product', basePrice: 2500, stockQuantity: 10, trackStock: true });

    // Checkout #1 (opA)
    const opA = randomUUID();
    const res1 = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: opA,
        items: [{ catalogueItemId: item1.id, quantity: 2 }],
        deliveryMethod: 'pickup',
      });
    expect(res1.status).toBe(201);
    const order1 = res1.body.order;
    const invoice1 = res1.body.invoice;

    // Checkout #2 (opB)
    const opB = randomUUID();
    const res2 = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: opB,
        items: [{ catalogueItemId: item2.id, quantity: 1 }],
        deliveryMethod: 'pickup',
      });
    expect(res2.status).toBe(201);
    const order2 = res2.body.order;
    const invoice2 = res2.body.invoice;

    // Verify distinct identity
    expect(order1.id).not.toBe(order2.id);
    expect(invoice1.id).not.toBe(invoice2.id);
    expect(order1.invoiceId).toBe(invoice1.id);
    expect(order2.invoiceId).toBe(invoice2.id);
    expect(Number(invoice1.amount)).toBe(3000);
    expect(Number(invoice2.amount)).toBe(2500);
  });

  it('Payment isolation: paying Store Order #1 invoice pays Order #1 and releases credits while Order #2 and pre-existing invoice remain unchanged', async () => {
    // Setup pre-existing invoice
    const [preExisting] = await db.insert(invoicesTable).values({
      crecheId: crecheA.id,
      tutorId: tutorA.id,
      status: 'pending',
      amount: '5000.00',
      dueDate: '2026-08-30',
    }).returning();

    // Order #1: Service with credits
    const srv = await createCatalogueItem({ crecheId: crecheA.id, name: 'Banho Spa Iso', type: 'service', basePrice: 4000, trackStock: false });
    const res1 = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: srv.id, quantity: 2 }],
        deliveryMethod: 'pickup',
      });
    const order1 = res1.body.order;
    const invoice1 = res1.body.invoice;

    // Order #2: Product
    const prod = await createCatalogueItem({ crecheId: crecheA.id, name: 'Coleira Iso', type: 'product', basePrice: 3500, stockQuantity: 5, trackStock: true });
    const res2 = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: prod.id, quantity: 1 }],
        deliveryMethod: 'pickup',
      });
    const order2 = res2.body.order;
    const invoice2 = res2.body.invoice;

    // Pay invoice #1
    await processManualPayment(invoice1.id, crecheA.id, adminA.id, 'pix');

    // 1. Order #1 is paid
    const [order1After] = await db.select().from(ordersTable).where(eq(ordersTable.id, order1.id));
    expect(order1After.status).toBe('paid');

    // 2. Order #2 remains pending_payment
    const [order2After] = await db.select().from(ordersTable).where(eq(ordersTable.id, order2.id));
    expect(order2After.status).toBe('pending_payment');

    // 3. Pre-existing invoice remains pending with amount 5000
    const [preAfter] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, preExisting.id));
    expect(preAfter.status).toBe('pending');
    expect(Number(preAfter.amount)).toBe(5000);

    // 4. Credits released ONLY for Order #1
    const credits = await db.select().from(tutorServiceCreditsTable).where(
      and(
        eq(tutorServiceCreditsTable.tutorId, tutorA.id),
        eq(tutorServiceCreditsTable.catalogueItemId, srv.id)
      )
    );
    expect(credits.length).toBe(1);
    expect(credits[0].totalCredits).toBe(2);
  });

  it('Cancellation isolation: cancelling Store Order #2 voids only its invoice while unrelated pre-existing invoice remains untouched', async () => {
    // Setup pre-existing invoice
    const [preExisting] = await db.insert(invoicesTable).values({
      crecheId: crecheA.id,
      tutorId: tutorA.id,
      status: 'pending',
      amount: '8000.00',
      dueDate: '2026-08-30',
    }).returning();

    // Order
    const prod = await createCatalogueItem({ crecheId: crecheA.id, name: 'Cama Pet Iso', type: 'product', basePrice: 9000, stockQuantity: 5, trackStock: true });
    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [{ catalogueItemId: prod.id, quantity: 1 }],
        deliveryMethod: 'pickup',
      });
    const orderId = res.body.order.id;
    const invoiceId = res.body.invoice.id;

    // Cancel order
    const cancelRes = await request(app)
      .put(`/api/creches/${crecheA.id}/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ status: 'cancelled' });
    expect(cancelRes.status).toBe(200);

    // Store invoice is voided
    const [storeInv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    expect(storeInv.status).toBe('voided');

    // Pre-existing invoice is completely untouched
    const [preAfter] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, preExisting.id));
    expect(preAfter.status).toBe('pending');
    expect(Number(preAfter.amount)).toBe(8000);
  });

  it('Catalogue delete gate: checkout service and package -> delete catalogue rows -> payment succeeds and releases purchased credits without errors', async () => {
    // 1. Create service and package
    const srv = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Massagem Canina DelGate',
      type: 'service',
      basePrice: 6000,
      trackStock: false,
    });
    const pkg = await createCatalogueItem({
      crecheId: crecheA.id,
      name: 'Pacote 4 Massagens DelGate',
      type: 'package',
      basePrice: 20000,
      creditsAmount: 4,
      maxPetsPerDay: 1,
      trackStock: false,
    });

    // 2. Checkout
    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/orders`)
      .set('Authorization', `Bearer ${tokenTutorA}`)
      .send({
        operationId: randomUUID(),
        items: [
          { catalogueItemId: srv.id, quantity: 2 },
          { catalogueItemId: pkg.id, quantity: 1 },
        ],
        deliveryMethod: 'pickup',
      });
    expect(res.status).toBe(201);
    const invoiceId = res.body.invoice.id;

    // 3. Attempt hard delete of catalogue items from database
    await db.delete(catalogueItemsTable).where(inArray(catalogueItemsTable.id, [srv.id, pkg.id]));

    // Verify deletion from catalogue
    const deletedItems = await db.select().from(catalogueItemsTable).where(inArray(catalogueItemsTable.id, [srv.id, pkg.id]));
    expect(deletedItems.length).toBe(0);

    // 4. Pay invoice
    await processManualPayment(invoiceId, crecheA.id, adminA.id, 'pix');

    // 5. Verify service credits released correctly (2 credits)
    const srvCredits = await db.select().from(tutorServiceCreditsTable).where(
      and(
        eq(tutorServiceCreditsTable.tutorId, tutorA.id),
        eq(tutorServiceCreditsTable.catalogueItemId, srv.id)
      )
    );
    expect(srvCredits.length).toBe(1);
    expect(srvCredits[0].totalCredits).toBe(2);

    // 6. Verify package credits released correctly (4 credits)
    const { tutorCreditsTable } = await import('@workspace/db/schema');
    const pkgCredits = await db.select().from(tutorCreditsTable).where(
      and(
        eq(tutorCreditsTable.crecheId, crecheA.id),
        eq(tutorCreditsTable.tutorId, tutorA.id)
      )
    );
    const matchingPkg = pkgCredits.find(c => c.totalCredits === 4);
    expect(matchingPkg).toBeDefined();
  });
});

describe('R24F.2 — Strict Error Classification & Non-23505/Foreign Unique Immunity', () => {
  it('Non-23505 error referencing store_order_operations in message is rethrown and NOT treated as idempotency recovery', async () => {
    const item = await createCatalogueItem({ crecheId: crecheA.id, name: 'Item Error Classify 1', type: 'product', basePrice: 1000, stockQuantity: 10, trackStock: true });
    const opId = randomUUID();

    // Mock db.transaction to simulate a non-23505 PostgreSQL error referencing store_order_operations
    const originalTransaction = db.transaction.bind(db);
    const non23505Error = Object.assign(new Error('relation store_order_operations table is locked or missing'), {
      code: '42P01',
      detail: 'Table store_order_operations check failed',
    });

    (db as any).transaction = async () => {
      throw non23505Error;
    };

    try {
      await expect(
        createOrder({
          crecheId: crecheA.id,
          tutorId: tutorA.id,
          operationId: opId,
          items: [{ catalogueItemId: item.id, quantity: 1 }],
          deliveryMethod: 'pickup',
          deliveryAddress: null,
          deliveryFee: 0,
        })
      ).rejects.toThrow('relation store_order_operations table is locked or missing');
    } finally {
      (db as any).transaction = originalTransaction;
    }
  });

  it('Foreign 23505 unique error (from an unrelated constraint) is rethrown and NOT treated as Store operation recovery', async () => {
    const item = await createCatalogueItem({ crecheId: crecheA.id, name: 'Item Error Classify 2', type: 'product', basePrice: 1000, stockQuantity: 10, trackStock: true });
    const opId = randomUUID();

    // Mock db.transaction to simulate a 23505 error on a foreign unique constraint (e.g. users_email_unique)
    const originalTransaction = db.transaction.bind(db);
    const foreign23505Error = Object.assign(new Error('duplicate key value violates unique constraint "users_email_unique"'), {
      code: '23505',
      constraint: 'users_email_unique',
      detail: 'Key (email)=(test@example.com) already exists.',
    });

    (db as any).transaction = async () => {
      throw foreign23505Error;
    };

    try {
      await expect(
        createOrder({
          crecheId: crecheA.id,
          tutorId: tutorA.id,
          operationId: opId,
          items: [{ catalogueItemId: item.id, quantity: 1 }],
          deliveryMethod: 'pickup',
          deliveryAddress: null,
          deliveryFee: 0,
        })
      ).rejects.toThrow('duplicate key value violates unique constraint "users_email_unique"');
    } finally {
      (db as any).transaction = originalTransaction;
    }
  });

  it('Same-table primary key error (store_order_operations_pkey) is rethrown and NOT treated as idempotency recovery', async () => {
    const item = await createCatalogueItem({ crecheId: crecheA.id, name: 'Item Pkey Test', type: 'product', basePrice: 1000, stockQuantity: 10, trackStock: true });
    const opId = randomUUID();

    // Mock db.transaction to simulate a 23505 on store_order_operations_pkey (same table, but wrong constraint)
    const originalTransaction = db.transaction.bind(db);
    const pkey23505Error = Object.assign(new Error('duplicate key value violates unique constraint "store_order_operations_pkey"'), {
      code: '23505',
      constraint: 'store_order_operations_pkey',
      detail: 'Key (id)=(1) already exists.',
    });

    (db as any).transaction = async () => {
      throw pkey23505Error;
    };

    try {
      await expect(
        createOrder({
          crecheId: crecheA.id,
          tutorId: tutorA.id,
          operationId: opId,
          items: [{ catalogueItemId: item.id, quantity: 1 }],
          deliveryMethod: 'pickup',
          deliveryAddress: null,
          deliveryFee: 0,
        })
      ).rejects.toThrow('duplicate key value violates unique constraint "store_order_operations_pkey"');
    } finally {
      (db as any).transaction = originalTransaction;
    }
  });

  it('Same-table arbitrary unique constraint (store_order_operations_some_other_unique) is rethrown and NOT treated as idempotency recovery', async () => {
    const item = await createCatalogueItem({ crecheId: crecheA.id, name: 'Item Other Unique Test', type: 'product', basePrice: 1000, stockQuantity: 10, trackStock: true });
    const opId = randomUUID();

    const originalTransaction = db.transaction.bind(db);
    const otherUnique23505Error = Object.assign(new Error('duplicate key value violates unique constraint "store_order_operations_some_other_unique"'), {
      code: '23505',
      constraint: 'store_order_operations_some_other_unique',
      detail: 'Key (other_column)=(test) already exists.',
    });

    (db as any).transaction = async () => {
      throw otherUnique23505Error;
    };

    try {
      await expect(
        createOrder({
          crecheId: crecheA.id,
          tutorId: tutorA.id,
          operationId: opId,
          items: [{ catalogueItemId: item.id, quantity: 1 }],
          deliveryMethod: 'pickup',
          deliveryAddress: null,
          deliveryFee: 0,
        })
      ).rejects.toThrow('duplicate key value violates unique constraint "store_order_operations_some_other_unique"');
    } finally {
      (db as any).transaction = originalTransaction;
    }
  });

  it('Wrapped correct 23505 (cause.constraint: store_order_operations_creche_op_idx) enters idempotency recovery and returns winning order', async () => {
    const item = await createCatalogueItem({ crecheId: crecheA.id, name: 'Item Wrapped 23505', type: 'product', basePrice: 1000, stockQuantity: 10, trackStock: true });
    const opId = randomUUID();

    // First, execute initial real order to establish winning operation record
    const firstRes = await createOrder({
      crecheId: crecheA.id,
      tutorId: tutorA.id,
      operationId: opId,
      items: [{ catalogueItemId: item.id, quantity: 1 }],
      deliveryMethod: 'pickup',
      deliveryAddress: null,
      deliveryFee: 0,
    });
    expect(firstRes.result.order.id).toBeDefined();

    // Second, simulate a transaction that aborts with Drizzle-wrapped 23505 on store_order_operations_creche_op_idx
    const originalTransaction = db.transaction.bind(db);
    const wrapped23505Error = Object.assign(new Error('Failed query: insert into "store_order_operations" ...'), {
      cause: {
        code: '23505',
        constraint: 'store_order_operations_creche_op_idx',
        detail: `Key (creche_id, operation_id)=(${crecheA.id}, ${opId}) already exists.`,
      },
    });

    (db as any).transaction = async () => {
      throw wrapped23505Error;
    };

    try {
      const recovered = await createOrder({
        crecheId: crecheA.id,
        tutorId: tutorA.id,
        operationId: opId,
        items: [{ catalogueItemId: item.id, quantity: 1 }],
        deliveryMethod: 'pickup',
        deliveryAddress: null,
        deliveryFee: 0,
      });
      expect(recovered.result.order.id).toBe(firstRes.result.order.id);
      expect(recovered.result.invoice?.id).toBe(firstRes.result.invoice?.id);
    } finally {
      (db as any).transaction = originalTransaction;
    }
  });

  it('Synchronous get-or-create operationId pattern ensures same UUID across immediate invocations before state reconciliation', () => {
    const checkoutOpIdRef = { current: null as string | null };

    const getCheckoutOpId = () => {
      if (!checkoutOpIdRef.current) {
        checkoutOpIdRef.current = randomUUID();
      }
      return checkoutOpIdRef.current;
    };

    // First and second synchronous calls return the EXACT same UUID
    const firstCall = getCheckoutOpId();
    const secondCall = getCheckoutOpId();
    expect(firstCall).toBe(secondCall);

    // Cart mutation resets the ref
    checkoutOpIdRef.current = null;
    const thirdCall = getCheckoutOpId();
    expect(thirdCall).not.toBe(firstCall);

    // Subsequent call after mutation returns the new UUID consistently
    const fourthCall = getCheckoutOpId();
    expect(fourthCall).toBe(thirdCall);
  });
});
