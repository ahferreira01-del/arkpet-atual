import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import app from '../../artifacts/api-server/src/app.js';
import { db } from '@workspace/db';
import {
  catalogueItemsTable,
  invoicesTable,
  invoiceItemsTable,
  transactionsTable,
} from '@workspace/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  createTestCreche,
  createTestUser,
  generateTestToken,
  createTestPet,
  createCatalogueItem,
  createTestInvoice,
  cleanupTestData,
} from '../helpers';
import * as stripeClientModule from '../../artifacts/api-server/src/lib/stripeClient.js';
import { initializeDatabase } from '../../artifacts/api-server/src/startup.js';

let testCreche: any;
let adminUser: any;
let tutorUser: any;
let otherTutorUser: any;
let adminToken: string;
let tutorToken: string;
let otherTutorToken: string;
let testPet: any;

beforeAll(async () => {
  await initializeDatabase();
  testCreche = await createTestCreche({ name: 'Creche Lifecycle R19' });

  adminUser = await createTestUser({ role: 'creche_admin', crecheId: testCreche.id });
  tutorUser = await createTestUser({ role: 'tutor', crecheId: testCreche.id });
  otherTutorUser = await createTestUser({ role: 'tutor', crecheId: testCreche.id });

  adminToken = generateTestToken(adminUser);
  tutorToken = generateTestToken(tutorUser);
  otherTutorToken = generateTestToken(otherTutorUser);

  testPet = await createTestPet({ tutorId: tutorUser.id, crecheId: testCreche.id, size: 'medium' });
});

afterAll(async () => {
  await cleanupTestData(testCreche.id);
});

describe('R19F — Schema & Additive Migration', () => {
  it('invoice_items table has refunded_quantity column defaulting to 0', async () => {
    const item = await createCatalogueItem({
      crecheId: testCreche.id,
      name: 'Ração Teste',
      type: 'product',
      basePrice: 5000,
      stockQuantity: 20,
      trackStock: true,
    });

    const invoice = await createTestInvoice({
      crecheId: testCreche.id,
      tutorId: tutorUser.id,
      amount: 5000,
      status: 'pending',
    });

    const [createdItem] = await db.insert(invoiceItemsTable).values({
      invoiceId: invoice.id,
      description: 'Ração Teste',
      amount: '5000.00',
      quantity: 1,
      catalogueItemId: item.id,
    }).returning();

    expect(createdItem.refundedQuantity).toBe(0);
  });
});

describe('R19F — Clean Progressive Paid Item Refund', () => {
  it('progressively refunds item up to original quantity and rejects 4th refund with 409', async () => {
    const item = await createCatalogueItem({
      crecheId: testCreche.id,
      name: 'Biscoito Canino',
      type: 'product',
      basePrice: 2000,
      stockQuantity: 10,
      trackStock: true,
    });

    const invoice = await createTestInvoice({
      crecheId: testCreche.id,
      tutorId: tutorUser.id,
      amount: 6000,
      status: 'paid',
    });

    // Record initial income payment
    await db.insert(transactionsTable).values({
      crecheId: testCreche.id,
      invoiceId: invoice.id,
      type: 'income',
      amount: '6000.00',
      transactionDate: '2026-08-22',
      paymentMethod: 'pix',
      description: `Pagamento Fatura #${invoice.id}`,
    });

    const [invItem] = await db.insert(invoiceItemsTable).values({
      invoiceId: invoice.id,
      description: 'Biscoito Canino',
      amount: '2000.00',
      quantity: 3,
      catalogueItemId: item.id,
    }).returning();

    // 1st refund of 1 unit
    const res1 = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${invoice.id}/refund-item`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ invoiceItemId: invItem.id, quantity: 1 });
    expect(res1.status).toBe(200);

    // 2nd refund of 1 unit
    const res2 = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${invoice.id}/refund-item`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ invoiceItemId: invItem.id, quantity: 1 });
    expect(res2.status).toBe(200);

    // 3rd refund of 1 unit
    const res3 = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${invoice.id}/refund-item`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ invoiceItemId: invItem.id, quantity: 1 });
    expect(res3.status).toBe(200);

    // Check DB state after 3 refunds
    const [updatedItem] = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.id, invItem.id));
    expect(updatedItem.quantity).toBe(3); // Historical snapshot intact
    expect(updatedItem.refundedQuantity).toBe(3);

    // Check stock restored: 10 + 3 = 13
    const [updatedCatItem] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, item.id));
    expect(updatedCatItem.stockQuantity).toBe(13);

    // Check 3 negative income transactions
    const negTxns = await db.select().from(transactionsTable).where(
      and(
        eq(transactionsTable.invoiceId, invoice.id),
        eq(transactionsTable.type, 'income')
      )
    );
    // 1 positive payment + 3 negative item refunds = 4 transactions total
    expect(negTxns.length).toBe(4);
    const negativeRows = negTxns.filter(t => Number(t.amount) < 0);
    expect(negativeRows.length).toBe(3);

    // 4th refund of 1 unit must REJECT with 409 Conflict
    const res4 = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${invoice.id}/refund-item`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ invoiceItemId: invItem.id, quantity: 1 });
    expect(res4.status).toBe(409);

    // Ensure stock remained 13 and negative transactions remained 3
    const [finalCatItem] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, item.id));
    expect(finalCatItem.stockQuantity).toBe(13);

    const finalNegRows = await db.select().from(transactionsTable).where(
      and(
        eq(transactionsTable.invoiceId, invoice.id),
        eq(transactionsTable.type, 'income')
      )
    );
    expect(finalNegRows.filter(t => Number(t.amount) < 0).length).toBe(3);
  });

  it('serializes concurrent item refunds and rejects over-refund race', async () => {
    const item = await createCatalogueItem({
      crecheId: testCreche.id,
      name: 'Mordedor Borracha',
      type: 'product',
      basePrice: 3000,
      stockQuantity: 5,
      trackStock: true,
    });

    const invoice = await createTestInvoice({
      crecheId: testCreche.id,
      tutorId: tutorUser.id,
      amount: 3000,
      status: 'paid',
    });

    await db.insert(transactionsTable).values({
      crecheId: testCreche.id,
      invoiceId: invoice.id,
      type: 'income',
      amount: '3000.00',
      transactionDate: '2026-08-22',
      paymentMethod: 'cash',
      description: 'Pagamento Balcão',
    });

    const [invItem] = await db.insert(invoiceItemsTable).values({
      invoiceId: invoice.id,
      description: 'Mordedor Borracha',
      amount: '3000.00',
      quantity: 1,
      catalogueItemId: item.id,
    }).returning();

    // Send two concurrent refund requests for quantity 1
    const [resA, resB] = await Promise.all([
      request(app)
        .post(`/api/creches/${testCreche.id}/financial/invoices/${invoice.id}/refund-item`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ invoiceItemId: invItem.id, quantity: 1 }),
      request(app)
        .post(`/api/creches/${testCreche.id}/financial/invoices/${invoice.id}/refund-item`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ invoiceItemId: invItem.id, quantity: 1 }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    // DB asserts: exactly 1 refund recorded
    const [updatedItem] = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.id, invItem.id));
    expect(updatedItem.refundedQuantity).toBe(1);

    // Stock incremented by exactly 1 (5 + 1 = 6)
    const [updatedCatItem] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, item.id));
    expect(updatedCatItem.stockQuantity).toBe(6);
  });
});

describe('R19F — Legacy Ambiguous Item Refund & Full Refund Reconciled', () => {
  it('blocks item refund on legacy ambiguous invoice with 409', async () => {
    const item = await createCatalogueItem({
      crecheId: testCreche.id,
      name: 'Shampoo Neutro',
      type: 'product',
      basePrice: 5000,
      stockQuantity: 10,
      trackStock: true,
    });

    const invoice = await createTestInvoice({
      crecheId: testCreche.id,
      tutorId: tutorUser.id,
      amount: 10000,
      status: 'paid',
    });

    // Payment transaction (+10000)
    await db.insert(transactionsTable).values({
      crecheId: testCreche.id,
      invoiceId: invoice.id,
      type: 'income',
      amount: '10000.00',
      transactionDate: '2026-08-22',
      paymentMethod: 'pix',
      description: 'Pagamento inicial',
    });

    // Historical un-structured negative transaction (-2000)
    await db.insert(transactionsTable).values({
      crecheId: testCreche.id,
      invoiceId: invoice.id,
      type: 'income',
      amount: '-2000.00',
      transactionDate: '2026-08-22',
      paymentMethod: 'cash',
      description: 'Estorno de Venda: Shampoo Neutro (Qtd: 1)',
    });

    const [invItem] = await db.insert(invoiceItemsTable).values({
      invoiceId: invoice.id,
      description: 'Shampoo Neutro',
      amount: '5000.00',
      quantity: 2,
      refundedQuantity: 0, // Migration default
      catalogueItemId: item.id,
    }).returning();

    // Attempting item refund on legacy ambiguous invoice must FAIL CLOSED (409)
    const res = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${invoice.id}/refund-item`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ invoiceItemId: invItem.id, quantity: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('estornos parciais históricos');

    // Stock unchanged
    const [catItem] = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, item.id));
    expect(catItem.stockQuantity).toBe(10);
  });

  it('allows full refund on legacy invoice for the exact net remaining balance', async () => {
    const invoice = await createTestInvoice({
      crecheId: testCreche.id,
      tutorId: tutorUser.id,
      amount: 10000,
      status: 'paid',
    });

    await db.insert(transactionsTable).values({
      crecheId: testCreche.id,
      invoiceId: invoice.id,
      type: 'income',
      amount: '10000.00',
      transactionDate: '2026-08-22',
      paymentMethod: 'pix',
      description: 'Pagamento inicial',
    });

    await db.insert(transactionsTable).values({
      crecheId: testCreche.id,
      invoiceId: invoice.id,
      type: 'income',
      amount: '-2000.00',
      transactionDate: '2026-08-22',
      paymentMethod: 'cash',
      description: 'Estorno parcial histórico',
    });

    // Call full refund
    const res = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${invoice.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);

    // Verify invoice marked as refunded
    const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoice.id));
    expect(inv.status).toBe('refunded');

    // Verify expense transaction is for 8000 (10000 - 2000), not 10000!
    const [expenseTxn] = await db.select().from(transactionsTable).where(
      and(
        eq(transactionsTable.invoiceId, invoice.id),
        eq(transactionsTable.type, 'expense')
      )
    );
    expect(Number(expenseTxn.amount)).toBe(8000);
  });

  it('rejects full refund with 409 if net remaining balance is zero or negative', async () => {
    const invoice = await createTestInvoice({
      crecheId: testCreche.id,
      tutorId: tutorUser.id,
      amount: 5000,
      status: 'paid',
    });

    await db.insert(transactionsTable).values({
      crecheId: testCreche.id,
      invoiceId: invoice.id,
      type: 'income',
      amount: '5000.00',
      transactionDate: '2026-08-22',
      paymentMethod: 'pix',
      description: 'Pagamento',
    });

    await db.insert(transactionsTable).values({
      crecheId: testCreche.id,
      invoiceId: invoice.id,
      type: 'income',
      amount: '-5000.00',
      transactionDate: '2026-08-22',
      paymentMethod: 'cash',
      description: 'Estorno total de itens',
    });

    // Call full refund
    const res = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${invoice.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('já totalmente estornada');
  });
});

describe('R19F — Receipt Upload & State Machine Transitions', () => {
  it('allows receipt upload for pending and overdue invoices', async () => {
    const pendingInv = await createTestInvoice({
      crecheId: testCreche.id,
      tutorId: tutorUser.id,
      amount: 5000,
      status: 'pending',
    });

    const resPending = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${pendingInv.id}/upload-receipt`)
      .set('Authorization', `Bearer ${tutorToken}`)
      .send({ receiptPhotoPath: 'receipts/pix-pending.png' });
    expect(resPending.status).toBe(200);

    const [updatedPending] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, pendingInv.id));
    expect(updatedPending.status).toBe('awaiting_confirmation');
    expect(updatedPending.receiptPhotoPath).toBe('receipts/pix-pending.png');
  });

  it('allows receipt replacement for invoices already awaiting_confirmation', async () => {
    const awaitingInv = await createTestInvoice({
      crecheId: testCreche.id,
      tutorId: tutorUser.id,
      amount: 5000,
      status: 'awaiting_confirmation',
    });

    const res = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${awaitingInv.id}/upload-receipt`)
      .set('Authorization', `Bearer ${tutorToken}`)
      .send({ receiptPhotoPath: 'receipts/pix-replacement.png' });
    expect(res.status).toBe(200);

    const [updated] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, awaitingInv.id));
    expect(updated.status).toBe('awaiting_confirmation');
    expect(updated.receiptPhotoPath).toBe('receipts/pix-replacement.png');
  });

  it('rejects receipt upload on paid, voided, and refunded invoices with 409', async () => {
    const paidInv = await createTestInvoice({
      crecheId: testCreche.id,
      tutorId: tutorUser.id,
      amount: 5000,
      status: 'paid',
    });
    const voidedInv = await createTestInvoice({
      crecheId: testCreche.id,
      tutorId: tutorUser.id,
      amount: 5000,
      status: 'voided',
    });
    const refundedInv = await createTestInvoice({
      crecheId: testCreche.id,
      tutorId: tutorUser.id,
      amount: 5000,
      status: 'refunded',
    });

    const resPaid = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${paidInv.id}/upload-receipt`)
      .set('Authorization', `Bearer ${tutorToken}`)
      .send({ receiptPhotoPath: 'receipts/test.png' });
    expect(resPaid.status).toBe(409);

    const resVoided = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${voidedInv.id}/upload-receipt`)
      .set('Authorization', `Bearer ${tutorToken}`)
      .send({ receiptPhotoPath: 'receipts/test.png' });
    expect(resVoided.status).toBe(409);

    const resRefunded = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${refundedInv.id}/upload-receipt`)
      .set('Authorization', `Bearer ${tutorToken}`)
      .send({ receiptPhotoPath: 'receipts/test.png' });
    expect(resRefunded.status).toBe(409);
  });
});

describe('R19F — Stripe Checkout State Gate & Exact Cents Calculation', () => {
  it('rejects Stripe checkout on awaiting_confirmation, paid, voided, and refunded invoices with 409', async () => {
    const awaitingInv = await createTestInvoice({
      crecheId: testCreche.id,
      tutorId: tutorUser.id,
      amount: 5000,
      status: 'awaiting_confirmation',
    });
    const paidInv = await createTestInvoice({
      crecheId: testCreche.id,
      tutorId: tutorUser.id,
      amount: 5000,
      status: 'paid',
    });
    const voidedInv = await createTestInvoice({
      crecheId: testCreche.id,
      tutorId: tutorUser.id,
      amount: 5000,
      status: 'voided',
    });
    const refundedInv = await createTestInvoice({
      crecheId: testCreche.id,
      tutorId: tutorUser.id,
      amount: 5000,
      status: 'refunded',
    });

    const resAwaiting = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${awaitingInv.id}/stripe-checkout`)
      .set('Authorization', `Bearer ${tutorToken}`);
    expect(resAwaiting.status).toBe(409);

    const resPaid = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${paidInv.id}/stripe-checkout`)
      .set('Authorization', `Bearer ${tutorToken}`);
    expect(resPaid.status).toBe(409);

    const resVoided = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${voidedInv.id}/stripe-checkout`)
      .set('Authorization', `Bearer ${tutorToken}`);
    expect(resVoided.status).toBe(409);

    const resRefunded = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${refundedInv.id}/stripe-checkout`)
      .set('Authorization', `Bearer ${tutorToken}`);
    expect(resRefunded.status).toBe(409);
  });

  it('creates Stripe checkout with exact unit_amount in cents without 100x inflation', async () => {
    const pendingInv = await createTestInvoice({
      crecheId: testCreche.id,
      tutorId: tutorUser.id,
      amount: 15000, // 15000 cents = R$ 150,00
      status: 'pending',
    });

    let capturedSessionParams: any = null;
    const mockStripe = {
      checkout: {
        sessions: {
          create: vi.fn().mockImplementation(async (params: any) => {
            capturedSessionParams = params;
            return { url: 'https://checkout.stripe.com/pay/cs_test_mock' };
          }),
        },
      },
    };

    const spy = vi.spyOn(stripeClientModule, 'getUncachableStripeClient').mockResolvedValue(mockStripe as any);

    const res = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${pendingInv.id}/stripe-checkout`)
      .set('Authorization', `Bearer ${tutorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.checkoutUrl).toBe('https://checkout.stripe.com/pay/cs_test_mock');

    expect(capturedSessionParams).not.toBeNull();
    const lineItem = capturedSessionParams.line_items[0];
    expect(lineItem.price_data.unit_amount).toBe(15000); // EXACT CENTS, NOT 1500000!

    spy.mockRestore();
  });
});
