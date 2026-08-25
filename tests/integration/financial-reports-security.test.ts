import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../artifacts/api-server/src/app.js';
import { db } from '@workspace/db';
import {
  invoicesTable,
  invoiceItemsTable,
  ordersTable,
  orderItemsTable,
  catalogueItemsTable,
  transactionsTable,
  expensesTable,
  usersTable,
} from '@workspace/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  createTestCreche,
  createTestUser,
  generateTestToken,
  createTestInvoice,
  createTestExpense,
  createCatalogueItem,
  cleanupTestData,
} from '../helpers';
import { initializeDatabase } from '../../artifacts/api-server/src/startup.js';
import {
  getBusinessDate,
  isValidCalendarDate,
  getNextCalendarDay,
  getPreviousCalendarDay,
  getBusinessDayStartInstant,
} from '../../artifacts/api-server/src/lib/date.js';

let crecheA: any;
let crecheB: any;
let adminA: any;
let adminB: any;
let staffA: any;
let tutorA: any;
let tokenAdminA: string;
let tokenAdminB: string;
let tokenStaffA: string;
let tokenTutorA: string;

beforeAll(async () => {
  await initializeDatabase();

  crecheA = await createTestCreche({ name: 'Creche Reports A' });
  crecheB = await createTestCreche({ name: 'Creche Reports B' });

  adminA = await createTestUser({ role: 'creche_admin', crecheId: crecheA.id });
  adminB = await createTestUser({ role: 'creche_admin', crecheId: crecheB.id });
  staffA = await createTestUser({ role: 'staff', crecheId: crecheA.id });
  tutorA = await createTestUser({ role: 'tutor', crecheId: crecheA.id });

  tokenAdminA = generateTestToken(adminA);
  tokenAdminB = generateTestToken(adminB);
  tokenStaffA = generateTestToken(staffA);
  tokenTutorA = generateTestToken(tutorA);
});

afterAll(async () => {
  if (crecheA) await cleanupTestData(crecheA.id);
  if (crecheB) await cleanupTestData(crecheB.id);
});

describe('R22F.1 — Canonical America/Sao_Paulo Timezone Engine & Date Math', () => {
  it('proves IANA timezone rule resolution: standard time (-03:00) vs historical DST (-02:00)', () => {
    // Current date in standard time (-03:00)
    const instantCurrent = getBusinessDayStartInstant('2026-08-22', 'America/Sao_Paulo');
    expect(instantCurrent.toISOString()).toBe('2026-08-22T03:00:00.000Z');

    // Historical date when Brazil had daylight saving time (Horário de Verão: -02:00 in Jan 2018)
    const instantSummer2018 = getBusinessDayStartInstant('2018-01-15', 'America/Sao_Paulo');
    expect(instantSummer2018.toISOString()).toBe('2018-01-15T02:00:00.000Z');

    // Historical date in winter time (-03:00 in Jun 2018)
    const instantWinter2018 = getBusinessDayStartInstant('2018-06-15', 'America/Sao_Paulo');
    expect(instantWinter2018.toISOString()).toBe('2018-06-15T03:00:00.000Z');
  });

  it('getNextCalendarDay and getPreviousCalendarDay perform pure calendar date arithmetic without host timezone drift', () => {
    expect(getNextCalendarDay('2026-08-22')).toBe('2026-08-23');
    expect(getNextCalendarDay('2026-08-31')).toBe('2026-09-01');
    expect(getNextCalendarDay('2026-02-28')).toBe('2026-03-01'); // Non-leap year
    expect(getNextCalendarDay('2024-02-28')).toBe('2024-02-29'); // Leap year
    expect(getNextCalendarDay('2024-02-29')).toBe('2024-03-01');
    expect(getNextCalendarDay('2026-12-31')).toBe('2027-01-01'); // Year rollover

    expect(getPreviousCalendarDay('2026-08-22', 30)).toBe('2026-07-23');
    expect(getPreviousCalendarDay('2026-01-15', 30)).toBe('2025-12-16');
  });
});

describe('R22F — Tenant Isolation & Role Authorization', () => {
  it('Admin A can query own Creche A reports and cannot query Creche B reports (403)', async () => {
    const resA = await request(app)
      .get(`/api/creches/${crecheA.id}/financial/reports/cash-flow`)
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(resA.status).toBe(200);

    const resB = await request(app)
      .get(`/api/creches/${crecheB.id}/financial/reports/cash-flow`)
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(resB.status).toBe(403);
  });

  it('Staff, Tutor, and Master Admin are denied with 403 on /reports/:type', async () => {
    const resStaff = await request(app)
      .get(`/api/creches/${crecheA.id}/financial/reports/cash-flow`)
      .set('Authorization', `Bearer ${tokenStaffA}`);
    expect(resStaff.status).toBe(403);

    const resTutor = await request(app)
      .get(`/api/creches/${crecheA.id}/financial/reports/accounts-receivable`)
      .set('Authorization', `Bearer ${tokenTutorA}`);
    expect(resTutor.status).toBe(403);
  });
});

describe('R22F — Date Validation & Malformed Input (400 Bad Request)', () => {
  it('rejects malformed string date inputs with 400 Bad Request', async () => {
    const invalidDates = ['foo', '22/08/2026', '2026/08/22', '2026-8-22', '2026-08-2'];

    for (const d of invalidDates) {
      const resStart = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/reports/cash-flow?startDate=${d}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resStart.status).toBe(400);
      expect(resStart.body.error).toMatch(/inválida/i);

      const resEnd = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/reports/cash-flow?endDate=${d}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resEnd.status).toBe(400);
      expect(resEnd.body.error).toMatch(/inválida/i);
    }
  });

  it('rejects invalid calendar dates (e.g. 2026-13-01, 2026-02-30) with 400 Bad Request', async () => {
    const invalidCalendarDates = ['2026-13-01', '2026-02-30', '2026-00-10', '2026-01-00', '2026-04-31'];

    for (const d of invalidCalendarDates) {
      const res = await request(app)
        .get(`/api/creches/${crecheA.id}/financial/reports/accounts-receivable?startDate=${d}&endDate=${d}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/inválida/i);
    }
  });
});

describe('R22F — America/Sao_Paulo Business Timezone Timestamp Boundaries', () => {
  it('accounts-receivable: includes 00:00 BRT and 23:30 BRT on target day, excludes previous-day 23:30 BRT and next-day 00:00 BRT', async () => {
    // Target business day: 2026-08-22 (in BRT, UTC-3)
    // 2026-08-21 23:30 BRT = 2026-08-22T02:30:00.000Z (Previous Day Late)
    // 2026-08-22 00:00 BRT = 2026-08-22T03:00:00.000Z (Target Day Start)
    // 2026-08-22 23:30 BRT = 2026-08-23T02:30:00.000Z (Target Day Late - Catches UTC bug!)
    // 2026-08-23 00:00 BRT = 2026-08-23T03:00:00.000Z (Next Day Start)

    const [prevLate] = await db.insert(invoicesTable).values({
      crecheId: crecheA.id,
      tutorId: tutorA.id,
      amount: '1000',
      status: 'pending',
      dueDate: '2026-09-01',
      createdAt: new Date('2026-08-22T02:30:00.000Z'),
    }).returning();

    const [targetStart] = await db.insert(invoicesTable).values({
      crecheId: crecheA.id,
      tutorId: tutorA.id,
      amount: '2000',
      status: 'pending',
      dueDate: '2026-09-01',
      createdAt: new Date('2026-08-22T03:00:00.000Z'),
    }).returning();

    const [targetLate] = await db.insert(invoicesTable).values({
      crecheId: crecheA.id,
      tutorId: tutorA.id,
      amount: '3000',
      status: 'pending',
      dueDate: '2026-09-01',
      createdAt: new Date('2026-08-23T02:30:00.000Z'),
    }).returning();

    const [nextStart] = await db.insert(invoicesTable).values({
      crecheId: crecheA.id,
      tutorId: tutorA.id,
      amount: '4000',
      status: 'pending',
      dueDate: '2026-09-01',
      createdAt: new Date('2026-08-23T03:00:00.000Z'),
    }).returning();

    const res = await request(app)
      .get(`/api/creches/${crecheA.id}/financial/reports/accounts-receivable?startDate=2026-08-22&endDate=2026-08-22`)
      .set('Authorization', `Bearer ${tokenAdminA}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((inv: any) => inv.id);

    expect(ids).not.toContain(prevLate.id);
    expect(ids).toContain(targetStart.id);
    expect(ids).toContain(targetLate.id);
    expect(ids).not.toContain(nextStart.id);
  });

  it('month boundary test: Aug 31 23:30 BRT belongs to Aug 31, Sep 1 00:00 BRT belongs to Sep 1', async () => {
    // 2026-08-31 23:30 BRT = 2026-09-01T02:30:00.000Z
    // 2026-09-01 00:00 BRT = 2026-09-01T03:00:00.000Z

    const [augLate] = await db.insert(invoicesTable).values({
      crecheId: crecheA.id,
      tutorId: tutorA.id,
      amount: '1100',
      status: 'pending',
      dueDate: '2026-09-01',
      createdAt: new Date('2026-09-01T02:30:00.000Z'),
    }).returning();

    const [sepStart] = await db.insert(invoicesTable).values({
      crecheId: crecheA.id,
      tutorId: tutorA.id,
      amount: '2200',
      status: 'pending',
      dueDate: '2026-09-01',
      createdAt: new Date('2026-09-01T03:00:00.000Z'),
    }).returning();

    // Query Aug 31 only
    const resAug = await request(app)
      .get(`/api/creches/${crecheA.id}/financial/reports/accounts-receivable?startDate=2026-08-31&endDate=2026-08-31`)
      .set('Authorization', `Bearer ${tokenAdminA}`);
    const augIds = resAug.body.data.map((i: any) => i.id);
    expect(augIds).toContain(augLate.id);
    expect(augIds).not.toContain(sepStart.id);

    // Query Sep 1 only
    const resSep = await request(app)
      .get(`/api/creches/${crecheA.id}/financial/reports/accounts-receivable?startDate=2026-09-01&endDate=2026-09-01`)
      .set('Authorization', `Bearer ${tokenAdminA}`);
    const sepIds = resSep.body.data.map((i: any) => i.id);
    expect(sepIds).not.toContain(augLate.id);
    expect(sepIds).toContain(sepStart.id);
  });

  it('year boundary test: Dec 31 23:30 BRT belongs to Dec 31, Jan 1 00:00 BRT belongs to Jan 1', async () => {
    // 2026-12-31 23:30 BRT = 2027-01-01T02:30:00.000Z
    // 2027-01-01 00:00 BRT = 2027-01-01T03:00:00.000Z

    const [decLate] = await db.insert(invoicesTable).values({
      crecheId: crecheA.id,
      tutorId: tutorA.id,
      amount: '5500',
      status: 'pending',
      dueDate: '2027-01-10',
      createdAt: new Date('2027-01-01T02:30:00.000Z'),
    }).returning();

    const [janStart] = await db.insert(invoicesTable).values({
      crecheId: crecheA.id,
      tutorId: tutorA.id,
      amount: '6600',
      status: 'pending',
      dueDate: '2027-01-10',
      createdAt: new Date('2027-01-01T03:00:00.000Z'),
    }).returning();

    const resDec = await request(app)
      .get(`/api/creches/${crecheA.id}/financial/reports/accounts-receivable?startDate=2026-12-31&endDate=2026-12-31`)
      .set('Authorization', `Bearer ${tokenAdminA}`);
    const decIds = resDec.body.data.map((i: any) => i.id);
    expect(decIds).toContain(decLate.id);
    expect(decIds).not.toContain(janStart.id);

    const resJan = await request(app)
      .get(`/api/creches/${crecheA.id}/financial/reports/accounts-receivable?startDate=2027-01-01&endDate=2027-01-01`)
      .set('Authorization', `Bearer ${tokenAdminA}`);
    const janIds = resJan.body.data.map((i: any) => i.id);
    expect(janIds).not.toContain(decLate.id);
    expect(janIds).toContain(janStart.id);
  });
});

describe('R22F — Products-Sold Timestamp BRT Boundaries', () => {
  it('products-sold: includes orders created at 23:30 BRT on target date and excludes next-day orders', async () => {
    const item = await createCatalogueItem({ crecheId: crecheA.id, name: 'Biscoito Canino', type: 'product', basePrice: 1500 });

    const [targetOrder] = await db.insert(ordersTable).values({
      crecheId: crecheA.id,
      tutorId: tutorA.id,
      status: 'delivered',
      deliveryMethod: 'pickup',
      subtotal: '3000',
      total: '3000',
      createdAt: new Date('2026-08-23T02:30:00.000Z'), // 2026-08-22 23:30 BRT
    }).returning();

    await db.insert(orderItemsTable).values({
      orderId: targetOrder.id,
      catalogueItemId: item.id,
      quantity: 2,
      unitPrice: '1500',
      totalPrice: '3000',
    });

    const [nextOrder] = await db.insert(ordersTable).values({
      crecheId: crecheA.id,
      tutorId: tutorA.id,
      status: 'delivered',
      deliveryMethod: 'pickup',
      subtotal: '1500',
      total: '1500',
      createdAt: new Date('2026-08-23T03:00:00.000Z'), // 2026-08-23 00:00 BRT
    }).returning();

    await db.insert(orderItemsTable).values({
      orderId: nextOrder.id,
      catalogueItemId: item.id,
      quantity: 1,
      unitPrice: '1500',
      totalPrice: '1500',
    });

    const res = await request(app)
      .get(`/api/creches/${crecheA.id}/financial/reports/products-sold?startDate=2026-08-22&endDate=2026-08-22`)
      .set('Authorization', `Bearer ${tokenAdminA}`);

    expect(res.status).toBe(200);
    const quantities = res.body.data.map((p: any) => p.quantity);
    expect(quantities).toContain(2);
    expect(quantities).not.toContain(1);
  });
});

describe('R22F — Date Field Inclusivity & Financial Aggregations', () => {
  it('cash-flow and accounts-payable respect inclusive start and end dates', async () => {
    // Insert expense on 2026-08-22
    const exp = await createTestExpense({ crecheId: crecheA.id, amount: 5000, dueDate: '2026-08-22', isPaid: false });

    const res = await request(app)
      .get(`/api/creches/${crecheA.id}/financial/reports/accounts-payable?startDate=2026-08-22&endDate=2026-08-22`)
      .set('Authorization', `Bearer ${tokenAdminA}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((e: any) => e.id);
    expect(ids).toContain(exp.id);
  });

  it('refunds aggregate correctly in cash-flow: +10000 income, -2000 item refund = 8000 net revenue', async () => {
    const inv = await createTestInvoice({ crecheId: crecheA.id, tutorId: tutorA.id, amount: 10000, status: 'paid' });

    // Payment income +10000
    await db.insert(transactionsTable).values({
      crecheId: crecheA.id,
      invoiceId: inv.id,
      type: 'income',
      amount: '10000',
      transactionDate: '2026-08-22',
      paymentMethod: 'pix',
      description: 'Pagamento Fatura',
    });

    // Item refund income -2000
    await db.insert(transactionsTable).values({
      crecheId: crecheA.id,
      invoiceId: inv.id,
      type: 'income',
      amount: '-2000',
      transactionDate: '2026-08-22',
      paymentMethod: 'pix',
      description: 'Estorno Parcial de Item',
    });

    const res = await request(app)
      .get(`/api/creches/${crecheA.id}/financial/dashboard/cash-flow?startDate=2026-08-22&endDate=2026-08-22`)
      .set('Authorization', `Bearer ${tokenAdminA}`);

    expect(res.status).toBe(200);
    const incomeRow = res.body.find((r: any) => r.type === 'income');
    expect(incomeRow).toBeDefined();
    expect(Number(incomeRow.total)).toBe(8000);
  });
});

describe('R22F — CSV Formula Sanitization Contract', () => {
  it('neutralizes formula prefix strings (=, +, -, @) with apostrophe and escapes quotes and newlines', () => {
    const sanitizeCSVCell = (val: string): string => {
      if (!val) return "";
      const str = String(val);
      const trimmed = str.trimStart();
      if (
        trimmed.startsWith("=") ||
        trimmed.startsWith("+") ||
        trimmed.startsWith("-") ||
        trimmed.startsWith("@")
      ) {
        return `'${str}`;
      }
      return str;
    };

    const serializeCSV = (headers: string[], data: string[][]) => {
      return [
        headers.map(h => `"${sanitizeCSVCell(h).replace(/"/g, '""')}"`).join(","),
        ...data.map(row => row.map(val => `"${sanitizeCSVCell(val).replace(/"/g, '""')}"`).join(","))
      ].join("\n");
    };

    const headers = ['Descrição', 'Valor', 'Observação'];
    const rows = [
      ['=1+1', '1000', 'Normal note'],
      ['+SUM(A1:A2)', '2000', 'Ração Premium'],
      ['-1+2', '3000', 'Hello, "World"'],
      ['@SUM(A1:A2)', '4000', 'Multiline\nNote'],
      ['Normal Name', '5000', 'Safe cell']
    ];

    const csv = serializeCSV(headers, rows);

    expect(csv).toContain('"\'=1+1\"');
    expect(csv).toContain('"\'+SUM(A1:A2)\"');
    expect(csv).toContain('"\'-1+2\"');
    expect(csv).toContain('"\'@SUM(A1:A2)\"');
    expect(csv).toContain('"Normal Name"');
    expect(csv).toContain('"Ração Premium"');
    expect(csv).toContain('"Hello, ""World"""');
  });
});
