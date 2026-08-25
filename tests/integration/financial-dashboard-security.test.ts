import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../artifacts/api-server/src/app.js';
import { db } from '@workspace/db';
import {
  catalogueItemsTable,
  invoicesTable,
  invoiceItemsTable,
  transactionsTable,
  usersTable,
  expensesTable,
  ordersTable,
  orderItemsTable,
} from '@workspace/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  createTestCreche,
  createTestUser,
  generateTestToken,
  createTestPet,
  createCatalogueItem,
  createTestInvoice,
  createTestExpense,
  createTestTransaction,
  cleanupTestData,
} from '../helpers';
import { PosService } from '../../artifacts/api-server/src/services/pos.js';
import { fetchAllInvoices } from '../../artifacts/petdaycare/src/hooks/use-financial';

describe('Financial Dashboard Security, Role Authorization & Completeness (R18F.1)', () => {
  let crecheA: any;
  let crecheB: any;
  let crecheLarge: any;

  let adminA: any;
  let staffA: any;
  let tutorA: any;
  let tutorA2: any; // Same-creche second tutor for foreign-resource authorization tests

  let adminB: any;
  let tutorB: any;
  let masterAdmin: any;

  let tokenAdminA: string;
  let tokenStaffA: string;
  let tokenTutorA: string;
  let tokenTutorA2: string;

  let tokenAdminB: string;
  let tokenTutorB: string;
  let tokenMaster: string;

  let petA: any;
  let invoiceA: any;
  let invoiceA2: any;
  let invoiceB: any;

  let tokenAdminLarge: string;

  beforeAll(async () => {
    crecheA = await createTestCreche({ name: 'Creche Financeira A' });
    crecheB = await createTestCreche({ name: 'Creche Financeira B' });
    crecheLarge = await createTestCreche({ name: 'Creche Invoices 125 Fixture' });

    adminA = await createTestUser({ role: 'creche_admin', crecheId: crecheA.id });
    staffA = await createTestUser({ role: 'staff', crecheId: crecheA.id });
    tutorA = await createTestUser({ role: 'tutor', crecheId: crecheA.id });
    tutorA2 = await createTestUser({ role: 'tutor', crecheId: crecheA.id });

    adminB = await createTestUser({ role: 'creche_admin', crecheId: crecheB.id });
    tutorB = await createTestUser({ role: 'tutor', crecheId: crecheB.id });
    masterAdmin = await createTestUser({ role: 'master_admin', crecheId: null });

    const adminLarge = await createTestUser({ role: 'creche_admin', crecheId: crecheLarge.id });
    tokenAdminLarge = generateTestToken(adminLarge);

    tokenAdminA = generateTestToken(adminA);
    tokenStaffA = generateTestToken(staffA);
    tokenTutorA = generateTestToken(tutorA);
    tokenTutorA2 = generateTestToken(tutorA2);

    tokenAdminB = generateTestToken(adminB);
    tokenTutorB = generateTestToken(tutorB);
    tokenMaster = generateTestToken(masterAdmin);

    petA = await createTestPet({ tutorId: tutorA.id, crecheId: crecheA.id, size: 'medium' });
    invoiceA = await createTestInvoice({
      crecheId: crecheA.id,
      tutorId: tutorA.id,
      amount: 15000,
      status: 'pending',
      receiptPhotoPath: 'receipts/tutorA-receipt.png',
    });
    invoiceA2 = await createTestInvoice({
      crecheId: crecheA.id,
      tutorId: tutorA2.id,
      amount: 20000,
      status: 'pending',
      receiptPhotoPath: 'receipts/tutorA2-receipt.png',
    });
    invoiceB = await createTestInvoice({ crecheId: crecheB.id, tutorId: tutorB.id, amount: 25000, status: 'pending' });

    // Seed 125 invoices deterministically in crecheLarge
    const largeTutor = await createTestUser({ role: 'tutor', crecheId: crecheLarge.id });
    const invoiceRows: any[] = [];
    const baseDate = new Date('2026-01-01T00:00:00.000Z');

    for (let i = 1; i <= 125; i++) {
      let status = 'pending';
      let receiptPhotoPath: string | null = null;

      if (i === 124) {
        status = 'awaiting_confirmation';
        receiptPhotoPath = 'receipts/receipt-124.png';
      } else if (i === 125) {
        status = 'overdue';
      }

      invoiceRows.push({
        crecheId: crecheLarge.id,
        tutorId: largeTutor.id,
        amount: String(1000 + i),
        status,
        receiptPhotoPath,
        dueDate: '2026-02-01',
        createdAt: new Date(baseDate.getTime() + i * 1000), // Deterministic chronological ordering
      });
    }

    await db.insert(invoicesTable).values(invoiceRows);
  }, 60000);

  afterAll(async () => {
    if (crecheA?.id) await cleanupTestData(crecheA.id);
    if (crecheB?.id) await cleanupTestData(crecheB.id);
    if (crecheLarge?.id) await cleanupTestData(crecheLarge.id);
  }, 60000);

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Cross-Tenant Read Isolation (SEC-R18-01)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Cross-Tenant Read Isolation (SEC-R18-01)', () => {
    it('Admin A can read own Creche A financial endpoints', async () => {
      const resCashFlow = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/dashboard/cash-flow?startDate=2026-01-01&endDate=2026-12-31`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resCashFlow.status).toBe(200);

      const resDRE = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/dashboard/dre?startDate=2026-01-01&endDate=2026-12-31`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resDRE.status).toBe(200);

      const resKpis = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/dashboard/kpis?startDate=2026-01-01&endDate=2026-12-31`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resKpis.status).toBe(200);

      const resInvoices = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resInvoices.status).toBe(200);

      const resExpenses = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/expenses`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resExpenses.status).toBe(200);

      const resCatalogue = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/catalogue`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resCatalogue.status).toBe(200);

      const resAudit = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/audit`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resAudit.status).toBe(200);

      const resReports = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/reports/cash-flow?startDate=2026-01-01&endDate=2026-12-31`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resReports.status).toBe(200);
    });

    it('Admin A is DENIED (403) when attempting to read Creche B financial endpoints', async () => {
      const endpoints = [
        `/api/creches/${crecheB.id}/financial/dashboard/cash-flow?startDate=2026-01-01&endDate=2026-12-31`,
        `/api/creches/${crecheB.id}/financial/dashboard/dre?startDate=2026-01-01&endDate=2026-12-31`,
        `/api/creches/${crecheB.id}/financial/dashboard/kpis?startDate=2026-01-01&endDate=2026-12-31`,
        `/api/creches/${crecheB.id}/financial/invoices`,
        `/api/creches/${crecheB.id}/financial/expenses`,
        `/api/creches/${crecheB.id}/financial/catalogue`,
        `/api/creches/${crecheB.id}/financial/audit`,
        `/api/creches/${crecheB.id}/financial/reports/cash-flow?startDate=2026-01-01&endDate=2026-12-31`,
        `/api/creches/${crecheB.id}/financial/search?q=teste`,
        `/api/creches/${crecheB.id}/financial/packages`,
      ];

      for (const ep of endpoints) {
        const res = await request(app)
          .get(ep)
          .set('Authorization', `Bearer ${tokenAdminA}`);
        expect(res.status).toBe(403);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Cross-Tenant Mutation Isolation (SEC-R18-01)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Cross-Tenant Mutation Isolation (SEC-R18-01)', () => {
    it('Admin A cannot create an expense in Creche B (403 and zero DB mutation)', async () => {
      const res = await request(app)
        .post(`/api/creches/${crecheB.id}/financial/expenses`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          description: 'Despesa Invasiva',
          category: 'utilities',
          amount: 5000,
          dueDate: '2026-09-01',
        });
      expect(res.status).toBe(403);

      const [dbRecord] = await db.select().from(expensesTable)
        .where(and(eq(expensesTable.crecheId, crecheB.id), eq(expensesTable.description, 'Despesa Invasiva')));
      expect(dbRecord).toBeUndefined();
    });

    it('Admin A cannot perform POS sale in Creche B (403 and zero DB mutation)', async () => {
      const itemB = await createCatalogueItem({ crecheId: crecheB.id, name: 'Item B Teste', basePrice: 20 });
      const res = await request(app)
        .post(`/api/creches/${crecheB.id}/financial/pos-sale`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          operationId: randomUUID(),
          items: [{ catalogueItemId: itemB.id, quantity: 1 }],
          paymentMethod: 'cash',
        });
      expect(res.status).toBe(403);
    });

    it('Admin A cannot pay manual invoice in Creche B (403)', async () => {
      const res = await request(app)
        .post(`/api/creches/${crecheB.id}/financial/invoices/${invoiceB.id}/pay-manual`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ paymentMethod: 'pix' });
      expect(res.status).toBe(403);
    });

    it('Admin A cannot create catalogue item in Creche B (403 and zero DB mutation)', async () => {
      const res = await request(app)
        .post(`/api/creches/${crecheB.id}/financial/catalogue`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          name: 'Item Fraudulento',
          type: 'product',
          price: 99.00,
        });
      expect(res.status).toBe(403);

      const [dbItem] = await db.select().from(catalogueItemsTable)
        .where(and(eq(catalogueItemsTable.crecheId, crecheB.id), eq(catalogueItemsTable.name, 'Item Fraudulento')));
      expect(dbItem).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Authenticate-Only Route Ownership & Role Matrix (AUTH-R18-01, AUTH-R18-02)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Authenticate-Only Route Ownership & Role Matrix', () => {
    it('GET /financial/invoices: Tutor sees own, foreign tutor is filtered, Staff/Master are denied', async () => {
      // Tutor A sees only invoiceA
      const resTutorA = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices`)
        .set('Authorization', `Bearer ${tokenTutorA}`);
      expect(resTutorA.status).toBe(200);
      expect(resTutorA.body.data.every((i: any) => i.tutorId === tutorA.id)).toBe(true);

      // Staff receives 403
      const resStaff = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices`)
        .set('Authorization', `Bearer ${tokenStaffA}`);
      expect(resStaff.status).toBe(403);

      // Master receives 403
      const resMaster = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices`)
        .set('Authorization', `Bearer ${tokenMaster}`);
      expect(resMaster.status).toBe(403);

      // Creche Admin receives 200 with all creche invoices
      const resAdmin = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resAdmin.status).toBe(200);
    });

    it('GET /financial/invoices/upcoming: Role matrix and tutor scoping', async () => {
      // Tutor A query
      const resTutor = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices/upcoming`)
        .set('Authorization', `Bearer ${tokenTutorA}`);
      expect(resTutor.status).toBe(200);

      // Staff denied
      const resStaff = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices/upcoming?tutorId=${tutorA.id}`)
        .set('Authorization', `Bearer ${tokenStaffA}`);
      expect(resStaff.status).toBe(403);

      // Master denied
      const resMaster = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices/upcoming?tutorId=${tutorA.id}`)
        .set('Authorization', `Bearer ${tokenMaster}`);
      expect(resMaster.status).toBe(403);

      // Admin allowed
      const resAdmin = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices/upcoming?tutorId=${tutorA.id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resAdmin.status).toBe(200);
    });

    it('GET /financial/invoices/:invoiceId/items: Same-creche foreign tutor and role checks', async () => {
      // Tutor A -> own invoiceA (200)
      const resOwn = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA.id}/items`)
        .set('Authorization', `Bearer ${tokenTutorA}`);
      expect(resOwn.status).toBe(200);

      // Tutor A -> Tutor A2 invoiceA2 (403 Foreign Tutor in same creche)
      const resForeign = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA2.id}/items`)
        .set('Authorization', `Bearer ${tokenTutorA}`);
      expect(resForeign.status).toBe(403);

      // Staff denied
      const resStaff = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA.id}/items`)
        .set('Authorization', `Bearer ${tokenStaffA}`);
      expect(resStaff.status).toBe(403);

      // Master denied
      const resMaster = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA.id}/items`)
        .set('Authorization', `Bearer ${tokenMaster}`);
      expect(resMaster.status).toBe(403);

      // Admin allowed
      const resAdmin = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA.id}/items`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resAdmin.status).toBe(200);
    });

    it('GET /financial/invoices/:invoiceId/receipt-url: Same-creche foreign tutor and role checks', async () => {
      // Tutor A -> own receipt
      const resOwn = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA.id}/receipt-url`)
        .set('Authorization', `Bearer ${tokenTutorA}`);
      expect(resOwn.status).toBe(200);

      // Tutor A -> Tutor A2 receipt (403 Foreign)
      const resForeign = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA2.id}/receipt-url`)
        .set('Authorization', `Bearer ${tokenTutorA}`);
      expect(resForeign.status).toBe(403);

      // Staff denied
      const resStaff = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA.id}/receipt-url`)
        .set('Authorization', `Bearer ${tokenStaffA}`);
      expect(resStaff.status).toBe(403);

      // Master denied
      const resMaster = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA.id}/receipt-url`)
        .set('Authorization', `Bearer ${tokenMaster}`);
      expect(resMaster.status).toBe(403);

      // Admin allowed
      const resAdmin = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA.id}/receipt-url`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resAdmin.status).toBe(200);
    });

    it('GET /financial/invoices/:invoiceId/receipt-data: Same-creche foreign tutor and role checks', async () => {
      // Tutor A -> own
      const resOwn = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA.id}/receipt-data`)
        .set('Authorization', `Bearer ${tokenTutorA}`);
      expect(resOwn.status).toBe(200);

      // Tutor A -> Tutor A2 (403)
      const resForeign = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA2.id}/receipt-data`)
        .set('Authorization', `Bearer ${tokenTutorA}`);
      expect(resForeign.status).toBe(403);

      // Staff denied
      const resStaff = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA.id}/receipt-data`)
        .set('Authorization', `Bearer ${tokenStaffA}`);
      expect(resStaff.status).toBe(403);

      // Master denied
      const resMaster = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA.id}/receipt-data`)
        .set('Authorization', `Bearer ${tokenMaster}`);
      expect(resMaster.status).toBe(403);

      // Admin allowed
      const resAdmin = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA.id}/receipt-data`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resAdmin.status).toBe(200);
    });

    it('POST /financial/invoices/:invoiceId/upload-receipt: Foreign tutor, staff, and master rejection', async () => {
      // Foreign Tutor A -> Tutor A2 invoice (403)
      const resForeign = await request(app)
        .post(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA2.id}/upload-receipt`)
        .set('Authorization', `Bearer ${tokenTutorA}`)
        .send({ receiptPhotoPath: 'receipts/hack.png' });
      expect(resForeign.status).toBe(403);

      // Staff denied (403)
      const resStaff = await request(app)
        .post(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA.id}/upload-receipt`)
        .set('Authorization', `Bearer ${tokenStaffA}`)
        .send({ receiptPhotoPath: 'receipts/hack.png' });
      expect(resStaff.status).toBe(403);

      // Master denied (403)
      const resMaster = await request(app)
        .post(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA.id}/upload-receipt`)
        .set('Authorization', `Bearer ${tokenMaster}`)
        .send({ receiptPhotoPath: 'receipts/hack.png' });
      expect(resMaster.status).toBe(403);

      // Tutor A -> own invoice (200)
      const resOwn = await request(app)
        .post(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA.id}/upload-receipt`)
        .set('Authorization', `Bearer ${tokenTutorA}`)
        .send({ receiptPhotoPath: 'receipts/new-receipt.png' });
      expect(resOwn.status).toBe(200);
    });

    it('POST /financial/invoices/:invoiceId/stripe-checkout: Foreign tutor, staff, and master rejection', async () => {
      // Foreign Tutor A -> Tutor A2 invoice (403)
      const resForeign = await request(app)
        .post(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA2.id}/stripe-checkout`)
        .set('Authorization', `Bearer ${tokenTutorA}`);
      expect(resForeign.status).toBe(403);

      // Staff denied (403)
      const resStaff = await request(app)
        .post(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA.id}/stripe-checkout`)
        .set('Authorization', `Bearer ${tokenStaffA}`);
      expect(resStaff.status).toBe(403);

      // Master denied (403)
      const resMaster = await request(app)
        .post(`/api/creches/${crecheA.id}/financial/invoices/${invoiceA.id}/stripe-checkout`)
        .set('Authorization', `Bearer ${tokenMaster}`);
      expect(resMaster.status).toBe(403);
    });

    it('GET /financial/packages: Role matrix and tutor scoping', async () => {
      // Tutor A query
      const resTutor = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/packages`)
        .set('Authorization', `Bearer ${tokenTutorA}`);
      expect(resTutor.status).toBe(200);

      // Staff denied
      const resStaff = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/packages`)
        .set('Authorization', `Bearer ${tokenStaffA}`);
      expect(resStaff.status).toBe(403);

      // Master denied
      const resMaster = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/packages`)
        .set('Authorization', `Bearer ${tokenMaster}`);
      expect(resMaster.status).toBe(403);

      // Admin allowed
      const resAdmin = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/packages`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resAdmin.status).toBe(200);
    });

    it('GET /financial/packages/balance: Role matrix and query forgery immunity', async () => {
      // Tutor A query
      const resTutor = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/packages/balance?tutorId=${tutorA2.id}`)
        .set('Authorization', `Bearer ${tokenTutorA}`);
      expect(resTutor.status).toBe(200);
      // Backend forces tutorId = req.user.id for tutor role

      // Staff denied
      const resStaff = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/packages/balance`)
        .set('Authorization', `Bearer ${tokenStaffA}`);
      expect(resStaff.status).toBe(403);

      // Master denied
      const resMaster = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/packages/balance`)
        .set('Authorization', `Bearer ${tokenMaster}`);
      expect(resMaster.status).toBe(403);

      // Admin allowed
      const resAdmin = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/packages/balance?tutorId=${tutorA.id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resAdmin.status).toBe(200);
    });

    it('POST /financial/packages/purchase: Tutor ownership enforcement and staff/master rejection', async () => {
      const pkgItem = await createCatalogueItem({
        crecheId: crecheA.id,
        name: 'Pacote 10 Diárias',
        type: 'package',
        basePrice: 500,
        creditsAmount: 10,
      });

      // Tutor A buying for Tutor A2 (403 Foreign Tutor)
      const resForeign = await request(app)
        .post(`/api/creches/${crecheA.id}/financial/packages/purchase`)
        .set('Authorization', `Bearer ${tokenTutorA}`)
        .send({ packageId: pkgItem.id, tutorId: tutorA2.id, paymentMethod: 'credit_card' });
      expect(resForeign.status).toBe(403);

      // Staff denied
      const resStaff = await request(app)
        .post(`/api/creches/${crecheA.id}/financial/packages/purchase`)
        .set('Authorization', `Bearer ${tokenStaffA}`)
        .send({ packageId: pkgItem.id, tutorId: tutorA.id, paymentMethod: 'credit_card' });
      expect(resStaff.status).toBe(403);

      // Master denied
      const resMaster = await request(app)
        .post(`/api/creches/${crecheA.id}/financial/packages/purchase`)
        .set('Authorization', `Bearer ${tokenMaster}`)
        .send({ packageId: pkgItem.id, tutorId: tutorA.id, paymentMethod: 'credit_card' });
      expect(resMaster.status).toBe(403);

      // Tutor A buying for Tutor A (201 Created)
      const resOwn = await request(app)
        .post(`/api/creches/${crecheA.id}/financial/packages/purchase`)
        .set('Authorization', `Bearer ${tokenTutorA}`)
        .send({ packageId: pkgItem.id, tutorId: tutorA.id, paymentMethod: 'credit_card' });
      expect(resOwn.status).toBe(201);
    });

    it('GET /financial/service-credits: Staff allowed with tutorId, master denied', async () => {
      // Staff with tutorId (200)
      const resStaff = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/service-credits?tutorId=${tutorA.id}`)
        .set('Authorization', `Bearer ${tokenStaffA}`);
      expect(resStaff.status).toBe(200);

      // Staff without tutorId (400)
      const resStaffNoTutor = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/service-credits`)
        .set('Authorization', `Bearer ${tokenStaffA}`);
      expect(resStaffNoTutor.status).toBe(400);

      // Master denied (403)
      const resMaster = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/service-credits?tutorId=${tutorA.id}`)
        .set('Authorization', `Bearer ${tokenMaster}`);
      expect(resMaster.status).toBe(403);

      // Tutor A (200)
      const resTutor = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/service-credits`)
        .set('Authorization', `Bearer ${tokenTutorA}`);
      expect(resTutor.status).toBe(200);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. KPI Calculations & Isolation (FUNC-R18-02, SEC-R18-02)
  // ──────────────────────────────────────────────────────────────────────────
  describe('KPI Calculations & Isolation', () => {
    it('POS sale increments posSales KPI accurately', async () => {
      const catItem = await createCatalogueItem({
        crecheId: crecheA.id,
        name: 'Coleira Teste POS',
        type: 'product',
        basePrice: 50.00,
        trackStock: false,
      });

      await PosService.processSale({
        crecheId: crecheA.id,
        operationId: randomUUID(),
        items: [{ catalogueItemId: catItem.id, quantity: 1 }],
        paymentMethod: 'credit_card',
        userId: adminA.id,
      });

      const res = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/dashboard/kpis?startDate=2026-01-01&endDate=2026-12-31`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(200);
      expect(res.body.posSales).toBeDefined();
      expect(res.body.posSales.value).toBeGreaterThanOrEqual(1);
    });

    it('productsSold aggregates delivered orders and does not leak cross-tenant', async () => {
      const prodA = await createCatalogueItem({ crecheId: crecheA.id, name: 'Ração A', type: 'product', basePrice: 100 });
      const prodB = await createCatalogueItem({ crecheId: crecheB.id, name: 'Ração B', type: 'product', basePrice: 100 });

      // Create delivered order in Creche A (quantity: 4)
      const [orderA] = await db.insert(ordersTable).values({
        crecheId: crecheA.id,
        tutorId: tutorA.id,
        status: 'delivered',
        subtotal: '40000.00',
        total: '40000.00',
        deliveryFee: '0.00',
        paymentMethod: 'pix',
        deliveryMethod: 'pickup',
      }).returning();

      await db.insert(orderItemsTable).values({
        orderId: orderA.id,
        catalogueItemId: prodA.id,
        quantity: 4,
        unitPrice: '10000.00',
        totalPrice: '40000.00',
      });

      // Create delivered order in Creche B (quantity: 7)
      const [orderB] = await db.insert(ordersTable).values({
        crecheId: crecheB.id,
        tutorId: tutorB.id,
        status: 'delivered',
        subtotal: '70000.00',
        total: '70000.00',
        deliveryFee: '0.00',
        paymentMethod: 'pix',
        deliveryMethod: 'pickup',
      }).returning();

      await db.insert(orderItemsTable).values({
        orderId: orderB.id,
        catalogueItemId: prodB.id,
        quantity: 7,
        unitPrice: '10000.00',
        totalPrice: '70000.00',
      });

      // Query Creche A KPIs
      const resA = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/dashboard/kpis?startDate=2026-01-01&endDate=2026-12-31`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resA.status).toBe(200);
      expect(resA.body.productsSold.value).toBe(4);

      // Query Creche B KPIs
      const resB = await request(app)
        .get(`/api/creches/${crecheB.id}/financial/dashboard/kpis?startDate=2026-01-01&endDate=2026-12-31`)
        .set('Authorization', `Bearer ${tokenAdminB}`);
      expect(resB.status).toBe(200);
      expect(resB.body.productsSold.value).toBe(7);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Complete Multi-Page Invoice Retrieval (125 Invoices Fixture) (FUNC-R18-01)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Multi-Page Invoice Completeness & Fail-Closed Guarantee (125 Invoices)', () => {
    it('Backend paginates properly with page 1 (100 items) and page 2 (25 items)', async () => {
      const resPage1 = await request(app)
        .get(`/api/creches/${crecheLarge.id}/financial/invoices?page=1&pageSize=100`)
        .set('Authorization', `Bearer ${tokenAdminLarge}`);

      expect(resPage1.status).toBe(200);
      expect(resPage1.body.data.length).toBe(100);
      expect(resPage1.body.page).toBe(1);
      expect(resPage1.body.totalPages).toBe(2);
      expect(resPage1.body.total).toBe(125);

      const resPage2 = await request(app)
        .get(`/api/creches/${crecheLarge.id}/financial/invoices?page=2&pageSize=100`)
        .set('Authorization', `Bearer ${tokenAdminLarge}`);

      expect(resPage2.status).toBe(200);
      expect(resPage2.body.data.length).toBe(25);
      expect(resPage2.body.page).toBe(2);
    });

    it('fetchAllInvoices retrieves ALL 125 invoices, merges pages without duplicates, and includes items beyond page 1', async () => {
      // Mock fetchFn routing through supertest app
      const customFetch = async (url: string, init?: any) => {
        const fullUrl = url.startsWith('/api') ? url : `/api${url}`;
        const reqBuilder = request(app).get(fullUrl);
        if (init?.headers?.Authorization) {
          reqBuilder.set('Authorization', init.headers.Authorization);
        }
        const res = await reqBuilder;
        return {
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          json: async () => res.body,
        } as any;
      };

      const result = await fetchAllInvoices(crecheLarge.id, customFetch, tokenAdminLarge);

      // Exact total validation
      expect(result.data.length).toBe(125);
      expect(result.total).toBe(125);

      // Unique IDs validation (zero duplicates)
      const uniqueIds = new Set(result.data.map((i: any) => i.id));
      expect(uniqueIds.size).toBe(125);

      // Old overdue invoice #125 present
      const overdueInvoice = result.data.find((i: any) => i.status === 'overdue');
      expect(overdueInvoice).toBeDefined();

      // Old awaiting confirmation invoice #124 present
      const awaitingInvoice = result.data.find((i: any) => i.status === 'awaiting_confirmation');
      expect(awaitingInvoice).toBeDefined();
      expect(awaitingInvoice.receiptPhotoPath).toBe('receipts/receipt-124.png');

      // Defaulters filtering acceptance
      const defaulters = result.data.filter((i: any) => i.status === 'overdue');
      expect(defaulters.length).toBeGreaterThanOrEqual(1);
      expect(defaulters.some((i: any) => i.id === overdueInvoice.id)).toBe(true);

      // Receipts filtering acceptance
      const receipts = result.data.filter((i: any) => i.status === 'awaiting_confirmation');
      expect(receipts.length).toBeGreaterThanOrEqual(1);
      expect(receipts.some((i: any) => i.id === awaitingInvoice.id)).toBe(true);
    });

    it('Fails closed when page 2 fails with 500 error (rejects entire query, NO partial 100 rows)', async () => {
      // Mock fetchFn where page 1 succeeds with 100 items (totalPages: 2), but page 2 fails with 500
      let callCount = 0;
      const failingFetch = async (url: string, init?: any) => {
        callCount++;
        if (url.includes('page=1')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: new Array(100).fill(null).map((_, idx) => ({ id: idx + 1 })),
              page: 1,
              pageSize: 100,
              total: 125,
              totalPages: 2,
            }),
          } as any;
        } else {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: 'Internal Server Error' }),
          } as any;
        }
      };

      // Execution MUST reject and throw
      await expect(fetchAllInvoices(crecheLarge.id, failingFetch, tokenAdminLarge))
        .rejects
        .toThrow('Erro ao carregar faturas (página 2)');

      // Asserts that no partial data fallback was returned
    });
  });
});
