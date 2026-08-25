import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../artifacts/api-server/src/app.js';
import { db } from '@workspace/db';
import { catalogueItemsTable, financialAuditLogsTable, tutorCreditsTable, invoicesTable, invoiceItemsTable, transactionsTable, usersTable } from '@workspace/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import {
  createTestCreche, createTestUser, generateTestToken, createTestPet,
  createActiveBooking, createCatalogueItem, createTutorCredits,
  createTestInvoice, createTestExpense, createTestTransaction, cleanupTestData
} from '../helpers';

let testCreche: any;
let adminUser: any;
let staffUser: any;
let tutorUser: any;
let otherTutorUser: any;
let adminToken: string;
let staffToken: string;
let tutorToken: string;
let otherTutorToken: string;
let testPet: any;

beforeAll(async () => {
  testCreche = await createTestCreche({ name: 'Creche Teste QA' });

  adminUser = await createTestUser({ role: 'creche_admin', crecheId: testCreche.id });
  staffUser = await createTestUser({ role: 'staff', crecheId: testCreche.id });
  tutorUser = await createTestUser({ role: 'tutor', crecheId: testCreche.id });
  otherTutorUser = await createTestUser({ role: 'tutor', crecheId: testCreche.id });

  adminToken = generateTestToken(adminUser);
  staffToken = generateTestToken(staffUser);
  tutorToken = generateTestToken(tutorUser);
  otherTutorToken = generateTestToken(otherTutorUser);

  testPet = await createTestPet({ tutorId: tutorUser.id, crecheId: testCreche.id, size: 'medium' });
});

afterAll(async () => {
  await cleanupTestData(testCreche.id);
});

describe('Catálogo de Serviços', () => {
  it('GET /catalogue retorna apenas itens ativos', async () => {
    const activeItem = await createCatalogueItem({
      crecheId: testCreche.id, name: 'Banho Médio', isActive: true, basePrice: 40.00
    });
    const inactiveItem = await createCatalogueItem({
      crecheId: testCreche.id, name: 'Item Descontinuado', isActive: false, basePrice: 10.00
    });

    const res = await request(app)
      .get(`/api/creches/${testCreche.id}/financial/catalogue`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    expect(res.body.some((i: any) => i.id === inactiveItem.id)).toBe(false);
    expect(res.body.some((i: any) => i.id === activeItem.id)).toBe(true);
  });

  it('GET /catalogue com ?includeInactive=true retorna todos (apenas admin)', async () => {
    const resAdmin = await request(app)
      .get(`/api/creches/${testCreche.id}/financial/catalogue?includeInactive=true`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resAdmin.status).toBe(200);
    expect(resAdmin.body.some((i: any) => i.isActive === false)).toBe(true);

    const resStaff = await request(app)
      .get(`/api/creches/${testCreche.id}/financial/catalogue?includeInactive=true`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(resStaff.body.every((i: any) => i.isActive === true)).toBe(true);
  });

  it('POST /catalogue cria item e persiste preços por porte', async () => {
    const payload = {
      name: 'Banho por Porte', type: 'service', price: 40.00,
      pricingBySize: { small: 30.00, medium: 45.00, large: 60.00 }, trackStock: false
    };

    const res = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/catalogue`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.priceMedium).toBe('45.00');
    expect(res.body.priceLarge).toBe('60.00');
  });

  it('DELETE /catalogue/:id apaga o item fisicamente (hard delete)', async () => {
    const item = await createCatalogueItem({ crecheId: testCreche.id, isActive: true });

    const res = await request(app)
      .delete(`/api/creches/${testCreche.id}/financial/catalogue/${item.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);

    const updated = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, item.id));
    expect(updated.length).toBe(0);
  });
});

describe('Consumíveis e Estoque', () => {
  it('POST /consumables registra consumo com chargedPrice do catálogo', async () => {
    const item = await createCatalogueItem({
      crecheId: testCreche.id, basePrice: 40.00, priceMedium: 45.00, trackStock: false
    });
    const catItemCheckout = await createCatalogueItem({ crecheId: testCreche.id, type: 'day_use' }); const booking = await createActiveBooking({ petId: testPet.id, crecheId: testCreche.id, primaryCatalogueItemId: catItemCheckout.id });

    const res = await request(app)
      .post(`/api/creches/${testCreche.id}/bookings/${booking.id}/consumables`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ itemId: item.id, quantity: 1 });

    expect(res.status).toBe(200);
    expect(Number(res.body.chargedPrice)).toBe(45.00);
  });

  it('POST /consumables deduz estoque quando trackStock é true', async () => {
    const item = await createCatalogueItem({
      crecheId: testCreche.id, type: 'product', trackStock: true, stockQuantity: 10
    });
    const catItemCheckout = await createCatalogueItem({ crecheId: testCreche.id, type: 'day_use' }); const booking = await createActiveBooking({ petId: testPet.id, crecheId: testCreche.id, primaryCatalogueItemId: catItemCheckout.id });

    await request(app)
      .post(`/api/creches/${testCreche.id}/bookings/${booking.id}/consumables`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ itemId: item.id, quantity: 3 });

    const updated = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, item.id));
    expect(updated[0].stockQuantity).toBe(7);
  });

  it('POST /consumables gera log stock_adjustment quando deduz estoque', async () => {
    const item = await createCatalogueItem({
      crecheId: testCreche.id, type: 'product', trackStock: true, stockQuantity: 5
    });
    const catItemCheckout = await createCatalogueItem({ crecheId: testCreche.id, type: 'day_use' }); const booking = await createActiveBooking({ petId: testPet.id, crecheId: testCreche.id, primaryCatalogueItemId: catItemCheckout.id });

    await request(app)
      .post(`/api/creches/${testCreche.id}/bookings/${booking.id}/consumables`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ itemId: item.id, quantity: 1 });

    const logs = await db.select().from(financialAuditLogsTable).where(
      and(eq(financialAuditLogsTable.referenceId, item.id), eq(financialAuditLogsTable.action, 'stock_adjustment'))
    );
    expect(logs.length).toBeGreaterThan(0);
  });

  it('DELETE /consumables/:id restaura estoque deduzido', async () => {
    const item = await createCatalogueItem({
      crecheId: testCreche.id, type: 'product', trackStock: true, stockQuantity: 10
    });
    const catItemCheckout = await createCatalogueItem({ crecheId: testCreche.id, type: 'day_use' }); const booking = await createActiveBooking({ petId: testPet.id, crecheId: testCreche.id, primaryCatalogueItemId: catItemCheckout.id });

    const addRes = await request(app)
      .post(`/api/creches/${testCreche.id}/bookings/${booking.id}/consumables`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ itemId: item.id, quantity: 2 });

    await request(app)
      .delete(`/api/creches/${testCreche.id}/bookings/${booking.id}/consumables/${addRes.body.id}`)
      .set('Authorization', `Bearer ${staffToken}`);

    const updated = await db.select().from(catalogueItemsTable).where(eq(catalogueItemsTable.id, item.id));
    expect(updated[0].stockQuantity).toBe(10);
  });
});

describe('Checkout Inteligente', () => {
  it('Confirmação debita crédito válido sem gerar fatura', { timeout: 30000 }, async () => {
    const validTutor = await createTestUser({ role: 'tutor', crecheId: testCreche.id, name: 'Valid Tutor' });
    const validPet = await createTestPet({ tutorId: validTutor.id, crecheId: testCreche.id, size: 'medium' });
    const credit = await createTutorCredits({
      tutorId: validTutor.id, crecheId: testCreche.id, totalCredits: 5, usedCredits: 0, expirationDate: null
    });
    const catItemCheckout = await createCatalogueItem({ crecheId: testCreche.id, type: 'day_use' });
    const bReq = await request(app).post(`/api/creches/${testCreche.id}/bookings`).set('Authorization', `Bearer ${staffToken}`).send({
      petId: validPet.id, type: 'day_use', startDate: new Date().toISOString(), endDate: new Date().toISOString(), primaryCatalogueItemId: catItemCheckout.id, packageMaxPets: 1
    });
    const bookingId = bReq.body.id;

    const res = await request(app).put(`/api/creches/${testCreche.id}/bookings/${bookingId}`).set('Authorization', `Bearer ${staffToken}`).send({ status: 'confirmed' });
    expect(res.status).toBe(200);

    const credits = await db.select().from(tutorCreditsTable).where(eq(tutorCreditsTable.id, credit.id));
    expect(credits[0].usedCredits).toBe(1);

    const items = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.bookingId, bookingId));
    expect(items.length).toBe(0);
  });

  it('Confirmação NÃO usa crédito expirado e gera fatura', { timeout: 30000 }, async () => {
    const expiredTutor = await createTestUser({ role: 'tutor', crecheId: testCreche.id, name: 'Expired Tutor' });
    const expiredPet = await createTestPet({ tutorId: expiredTutor.id, crecheId: testCreche.id, size: 'medium' });
    const credit = await createTutorCredits({
      tutorId: expiredTutor.id, crecheId: testCreche.id, totalCredits: 10, usedCredits: 0, expirationDate: '2020-01-01'
    });
    const catItemCheckout = await createCatalogueItem({ crecheId: testCreche.id, type: 'day_use', basePrice: 100 });
    const bReq = await request(app).post(`/api/creches/${testCreche.id}/bookings`).set('Authorization', `Bearer ${staffToken}`).send({
      petId: expiredPet.id, type: 'day_use', startDate: new Date().toISOString(), endDate: new Date().toISOString(), primaryCatalogueItemId: catItemCheckout.id, packageMaxPets: 1
    });
    const bookingId = bReq.body.id;

    const res = await request(app).put(`/api/creches/${testCreche.id}/bookings/${bookingId}`).set('Authorization', `Bearer ${staffToken}`).send({ status: 'confirmed' });
    expect(res.status).toBe(200);

    const credits = await db.select().from(tutorCreditsTable).where(eq(tutorCreditsTable.id, credit.id));
    expect(credits[0].usedCredits).toBe(0);

    const items = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.bookingId, bookingId));
    expect(items.length).toBeGreaterThan(0);
  });

  it('Check-out gera fatura APENAS com consumíveis (base price cobrado na confirmação)', { timeout: 30000 }, async () => {
    const checkoutTutor = await createTestUser({ role: 'tutor', crecheId: testCreche.id, name: 'Checkout Tutor' });
    const checkoutPet = await createTestPet({ tutorId: checkoutTutor.id, crecheId: testCreche.id, size: 'medium' });
    const item = await createCatalogueItem({ crecheId: testCreche.id, basePrice: 40.00, trackStock: false });
    const catItemCheckout = await createCatalogueItem({ crecheId: testCreche.id, type: 'day_use', basePrice: 100 });
    const bReq = await request(app).post(`/api/creches/${testCreche.id}/bookings`).set('Authorization', `Bearer ${staffToken}`).send({
      petId: checkoutPet.id, type: 'day_use', startDate: new Date().toISOString(), endDate: new Date().toISOString(), primaryCatalogueItemId: catItemCheckout.id
    });
    const bookingId = bReq.body.id;

    // Confirma (gera fatura base da diária)
    await request(app).put(`/api/creches/${testCreche.id}/bookings/${bookingId}`).set('Authorization', `Bearer ${staffToken}`).send({ status: 'confirmed' });

    // Check-in e consumível
    await request(app).post(`/api/creches/${testCreche.id}/bookings/${bookingId}/checkin`).set('Authorization', `Bearer ${staffToken}`);
    await request(app).post(`/api/creches/${testCreche.id}/bookings/${bookingId}/consumables`).set('Authorization', `Bearer ${staffToken}`).send({ itemId: item.id, quantity: 1 });

    // Check-out (gera fatura do consumível)
    const res = await request(app).post(`/api/creches/${testCreche.id}/bookings/${bookingId}/checkout`).set('Authorization', `Bearer ${staffToken}`);
    expect(res.status).toBe(200);

    const items = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.bookingId, bookingId));
    expect(items.length).toBeGreaterThan(0);
  });

  it('Check-out gera log de auditoria invoice_create ou credits_deduct', { timeout: 30000 }, async () => {
    const auditTutor = await createTestUser({ role: 'tutor', crecheId: testCreche.id, name: 'Audit Tutor' });
    const auditPet = await createTestPet({ tutorId: auditTutor.id, crecheId: testCreche.id, size: 'medium' });
    const catItemCheckout = await createCatalogueItem({ crecheId: testCreche.id, type: 'day_use' });
    const bReq = await request(app).post(`/api/creches/${testCreche.id}/bookings`).set('Authorization', `Bearer ${staffToken}`).send({
      petId: auditPet.id, type: 'day_use', startDate: new Date().toISOString(), endDate: new Date().toISOString(), primaryCatalogueItemId: catItemCheckout.id, packageMaxPets: 1
    });
    const bookingId = bReq.body.id;

    await request(app).put(`/api/creches/${testCreche.id}/bookings/${bookingId}`).set('Authorization', `Bearer ${staffToken}`).send({ status: 'confirmed' });

    const logs = await db.select().from(financialAuditLogsTable).where(
      and(eq(financialAuditLogsTable.crecheId, testCreche.id), inArray(financialAuditLogsTable.action, ['invoice_create', 'credits_deduct']))
    );
    expect(logs.length).toBeGreaterThan(0);
  });
});

describe('Faturamento e Pagamentos', () => {
  it('POST /pay-manual marca fatura como paga e insere transação', async () => {
    const invoice = await createTestInvoice({
      crecheId: testCreche.id, tutorId: tutorUser.id, status: 'pending', amount: 150.00
    });

    const res = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${invoice.id}/pay-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ paymentMethod: 'cash', transactionDate: new Date().toISOString().split('T')[0] });

    expect(res.status).toBe(200);

    const updated = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoice.id));
    expect(updated[0].status).toBe('paid');

    const transactions = await db.select().from(transactionsTable).where(eq(transactionsTable.invoiceId, invoice.id));
    expect(transactions.length).toBe(1);
    expect(transactions[0].type).toBe('income');
    expect(Number(transactions[0].amount)).toBe(150.00);
  });

  it('POST /pay-manual falha se fatura já está paga (imutabilidade)', async () => {
    const invoice = await createTestInvoice({
      crecheId: testCreche.id, tutorId: tutorUser.id, status: 'paid', amount: 100.00
    });

    const res = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${invoice.id}/pay-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ paymentMethod: 'cash', transactionDate: '2026-01-01' });

    expect(res.status).toBe(409);
  });

  it('Duas chamadas simultâneas de pagamento não geram transação dupla', async () => {
    const invoice = await createTestInvoice({
      crecheId: testCreche.id, tutorId: tutorUser.id, status: 'pending', amount: 200.00
    });

    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/creches/${testCreche.id}/financial/invoices/${invoice.id}/pay-manual`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ paymentMethod: 'cash', transactionDate: '2026-01-01' }),
      request(app)
        .post(`/api/creches/${testCreche.id}/financial/invoices/${invoice.id}/pay-manual`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ paymentMethod: 'cash', transactionDate: '2026-01-01' }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const transactions = await db.select().from(transactionsTable).where(eq(transactionsTable.invoiceId, invoice.id));
    expect(transactions.length).toBe(1);
  });

  it('POST /upload-receipt muda status para awaiting_confirmation', async () => {
    const invoice = await createTestInvoice({ crecheId: testCreche.id, tutorId: tutorUser.id, status: 'pending' });

    const res = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${invoice.id}/upload-receipt`)
      .set('Authorization', `Bearer ${tutorToken}`)
      .send({ receiptPhotoPath: 'receipts/test-receipt.jpg' });

    expect(res.status).toBe(200);

    const updated = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoice.id));
    expect(updated[0].status).toBe('awaiting_confirmation');
    expect(updated[0].receiptPhotoPath).toBe('receipts/test-receipt.jpg');
  });

  it('GET /receipt-url retorna signed URL (não URL pública)', async () => {
    const invoice = await createTestInvoice({
      crecheId: testCreche.id, tutorId: tutorUser.id, status: 'awaiting_confirmation', receiptPhotoPath: 'receipts/test.jpg'
    });

    const res = await request(app)
      .get(`/api/creches/${testCreche.id}/financial/invoices/${invoice.id}/receipt-url`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.url).toBeDefined();
    expect(res.body.url).not.toBe('receipts/test.jpg');
  });

  it('POST /void cancela fatura pendente', async () => {
    const invoice = await createTestInvoice({ crecheId: testCreche.id, tutorId: tutorUser.id, status: 'pending' });

    const res = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${invoice.id}/void`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);

    const updated = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoice.id));
    expect(updated[0].status).toBe('voided');
  });

  it('POST /void falha se fatura já está paga', async () => {
    const invoice = await createTestInvoice({ crecheId: testCreche.id, tutorId: tutorUser.id, status: 'paid' });

    const res = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/invoices/${invoice.id}/void`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(409);
  });
});

describe('Despesas e DRE', () => {
  it('POST /expenses cria despesa com campos obrigatórios', async () => {
    const res = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/expenses`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        description: 'Aluguel Janeiro', category: 'aluguel', amount: 3500.00, dueDate: '2026-01-31', supplier: 'Imobiliária Central'
      });

    expect(res.status).toBe(201);
    expect(res.body.isPaid).toBe(false);
    expect(Number(res.body.amount)).toBe(3500.00);
  });

  it('POST /expenses rejeita valor negativo', async () => {
    const res = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/expenses`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ description: 'Despesa inválida', category: 'outros', amount: -100.00, dueDate: '2026-01-31' });

    expect(res.status).toBe(400);
  });

  it('POST /expenses/:id/pay marca como paga e insere transação de saída', async () => {
    const expense = await createTestExpense({ crecheId: testCreche.id, amount: 500.00, isPaid: false });

    const res = await request(app)
      .post(`/api/creches/${testCreche.id}/financial/expenses/${expense.id}/pay`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);

    const transactions = await db.select().from(transactionsTable).where(eq(transactionsTable.expenseId, expense.id));
    expect(transactions.length).toBe(1);
    expect(transactions[0].type).toBe('expense');
    expect(Number(transactions[0].amount)).toBe(500.00);
  });

  it('GET /dashboard/cash-flow retorna 400 sem startDate e endDate', async () => {
    const res = await request(app)
      .get(`/api/creches/${testCreche.id}/financial/dashboard/cash-flow`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('GET /dashboard/cash-flow retorna 400 com intervalo > 366 dias', async () => {
    const res = await request(app)
      .get(`/api/creches/${testCreche.id}/financial/dashboard/cash-flow`)
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ startDate: '2024-01-01', endDate: '2026-12-31' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('GET /dashboard/dre usa agregação SQL e reflete receitas e despesas', async () => {
    await createTestTransaction({ crecheId: testCreche.id, type: 'income', amount: 1000.00, transactionDate: '2026-01-15' });
    await createTestTransaction({ crecheId: testCreche.id, type: 'expense', amount: 300.00, transactionDate: '2026-01-20' });

    const res = await request(app)
      .get(`/api/creches/${testCreche.id}/financial/dashboard/dre`)
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ startDate: '2026-01-01', endDate: '2026-01-31' });

    expect(res.status).toBe(200);
    expect(Number(res.body.receitas)).toBeGreaterThanOrEqual(1000);
    expect(Number(res.body.despesas)).toBeGreaterThanOrEqual(300);
  });
});

describe('LGPD e Criptografia', () => {
  it('CPF é criptografado ao salvar e descriptografado ao ler', async () => {
    const rawCpf = '123.456.789-00';
    const email = `cpf-test-${Date.now()}@arkpet.com`;

    const createRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Tutor Teste CPF', email: email, password: 'senha123', cpf: rawCpf, role: 'tutor'
      });
      // the api returns a token if successful or we might need to get the user manually 

    const rawRecord = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (rawRecord.length > 0) {
      expect(rawRecord[0].cpf).not.toBe(rawCpf);
      expect(rawRecord[0].cpf).not.toBeNull();

      const token = generateTestToken(rawRecord[0]);
      const getRes = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
      expect(getRes.body.cpf).toBe(rawCpf);
    }
  });

  it('POST /users/:id/anonymize remove dados pessoais e preserva faturas', async () => {
    const tutorToAnonymize = await createTestUser({ role: 'tutor', crecheId: testCreche.id, name: 'Tutor Para Apagar', cpf: '999.999.999-99' });
    const invoice = await createTestInvoice({ crecheId: testCreche.id, tutorId: tutorToAnonymize.id, status: 'paid', amount: 250.00 });

    const res = await request(app)
      .post(`/api/users/${tutorToAnonymize.id}/anonymize`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);

    const user = await db.select().from(usersTable).where(eq(usersTable.id, tutorToAnonymize.id));
    expect(user[0].cpf).toBeNull();
    expect(user[0].phone).toBeNull();
    expect(user[0].name).toContain('Anonimizado');

    const invoiceCheck = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoice.id));
    expect(invoiceCheck.length).toBe(1);
    expect(Number(invoiceCheck[0].amount)).toBe(250.00);

    const logs = await db.select().from(financialAuditLogsTable).where(
      and(eq(financialAuditLogsTable.action, 'tutor_anonymize'), eq(financialAuditLogsTable.referenceId, tutorToAnonymize.id))
    );
    expect(logs.length).toBe(1);
  });
  it('Task #128: creche_admin pode listar pacotes de toda a creche sem tutorId', async () => {
    await createTutorCredits({ crecheId: testCreche.id, tutorId: tutorUser.id, totalCredits: 10, usedCredits: 0, expirationDate: null });
    const otherCreche = await createTestCreche({ name: 'other' });
    const otherAdmin = await createTestUser({ role: 'creche_admin', crecheId: otherCreche.id });
    await createTutorCredits({ crecheId: otherCreche.id, tutorId: otherAdmin.id, totalCredits: 5, usedCredits: 0, expirationDate: null });
    const res = await request(app).get(`/api/creches/${testCreche.id}/financial/packages`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((p: any) => p.crecheId === testCreche.id)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});
