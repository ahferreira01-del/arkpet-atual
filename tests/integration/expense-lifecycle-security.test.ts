import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../artifacts/api-server/src/app.js';
import { db } from '@workspace/db';
import {
  expensesTable,
  transactionsTable,
  financialAuditLogsTable,
} from '@workspace/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  createTestCreche,
  createTestUser,
  generateTestToken,
  createTestExpense,
  cleanupTestData,
} from '../helpers';
import { initializeDatabase } from '../../artifacts/api-server/src/startup.js';

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

  crecheA = await createTestCreche({ name: 'Creche Expense A' });
  crecheB = await createTestCreche({ name: 'Creche Expense B' });

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

describe('R21F — Integer-Cent Money Validation', () => {
  it('POST /expenses accepts integer cents (15000 and 1)', async () => {
    const res1 = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/expenses`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        description: 'Conta de Energia',
        category: 'operacional',
        amount: 15000,
        dueDate: '2026-09-01',
      });
    expect(res1.status).toBe(201);
    expect(Number(res1.body.amount)).toBe(15000);

    const res2 = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/expenses`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        description: 'Café',
        category: 'operacional',
        amount: 1,
        dueDate: '2026-09-01',
      });
    expect(res2.status).toBe(201);
    expect(Number(res2.body.amount)).toBe(1);
  });

  it('POST /expenses rejects zero, negative, fractional cents, and non-numbers with 400', async () => {
    const invalidAmounts = [0, -100, 100.5, '150.00', null, NaN, Infinity];

    for (const amount of invalidAmounts) {
      const res = await request(app)
        .post(`/api/creches/${crecheA.id}/financial/expenses`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          description: 'Teste Invalido',
          category: 'operacional',
          amount,
          dueDate: '2026-09-01',
        });
      expect(res.status).toBe(400);
    }
  });
});

describe('R21F — Unpaid Expense Lifecycle (Create, Edit, Delete)', () => {
  it('creating unpaid expense stores isPaid = false and zero transactions', async () => {
    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/expenses`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        description: 'Aluguel Unpaid',
        category: 'aluguel',
        amount: 300000,
        dueDate: '2026-09-10',
      });
    expect(res.status).toBe(201);
    const expenseId = res.body.id;

    const [dbExp] = await db.select().from(expensesTable).where(eq(expensesTable.id, expenseId));
    expect(dbExp.isPaid).toBe(false);
    expect(dbExp.paidDate).toBeNull();

    const txs = await db.select().from(transactionsTable).where(eq(transactionsTable.expenseId, expenseId));
    expect(txs.length).toBe(0);
  });

  it('editing unpaid expense updates fields cleanly with zero transactions', async () => {
    const exp = await createTestExpense({ crecheId: crecheA.id, amount: 10000, isPaid: false });

    const res = await request(app)
      .put(`/api/creches/${crecheA.id}/financial/expenses/${exp.id}`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        description: 'Aluguel Atualizado',
        category: 'aluguel',
        amount: 20000,
        dueDate: '2026-09-15',
      });

    expect(res.status).toBe(200);
    expect(Number(res.body.amount)).toBe(20000);
    expect(res.body.description).toBe('Aluguel Atualizado');

    const txs = await db.select().from(transactionsTable).where(eq(transactionsTable.expenseId, exp.id));
    expect(txs.length).toBe(0);
  });

  it('deleting unpaid expense removes row and creates zero orphan transactions', async () => {
    const exp = await createTestExpense({ crecheId: crecheA.id, amount: 10000, isPaid: false });

    const res = await request(app)
      .delete(`/api/creches/${crecheA.id}/financial/expenses/${exp.id}`)
      .set('Authorization', `Bearer ${tokenAdminA}`);

    expect(res.status).toBe(200);

    const [dbExp] = await db.select().from(expensesTable).where(eq(expensesTable.id, exp.id));
    expect(dbExp).toBeUndefined();

    const txs = await db.select().from(transactionsTable).where(eq(transactionsTable.expenseId, exp.id));
    expect(txs.length).toBe(0);
  });
});

describe('R21F — Paid Expense Immutability & Ledger Consistency', () => {
  it('paying expense creates exactly 1 transaction with correct integer amount and sets isPaid = true', async () => {
    const exp = await createTestExpense({ crecheId: crecheA.id, amount: 15000, isPaid: false });

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/expenses/${exp.id}/pay`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ paymentMethod: 'pix' });

    expect(res.status).toBe(200);

    const [dbExp] = await db.select().from(expensesTable).where(eq(expensesTable.id, exp.id));
    expect(dbExp.isPaid).toBe(true);
    expect(dbExp.paidDate).not.toBeNull();

    const txs = await db.select().from(transactionsTable).where(eq(transactionsTable.expenseId, exp.id));
    expect(txs.length).toBe(1);
    expect(txs[0].type).toBe('expense');
    expect(Number(txs[0].amount)).toBe(15000);
    expect(txs[0].paymentMethod).toBe('pix');
  });

  it('attempting to edit amount of a paid expense returns 409 Conflict and preserves ledger parity', async () => {
    const exp = await createTestExpense({ crecheId: crecheA.id, amount: 10000, isPaid: false });

    // Pay
    await request(app)
      .post(`/api/creches/${crecheA.id}/financial/expenses/${exp.id}/pay`)
      .set('Authorization', `Bearer ${tokenAdminA}`);

    // Attempt edit
    const res = await request(app)
      .put(`/api/creches/${crecheA.id}/financial/expenses/${exp.id}`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        description: 'Tentativa Alterar Valor',
        category: 'aluguel',
        amount: 20000,
        dueDate: '2026-09-20',
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/não é possível editar uma despesa que já foi paga/i);

    // Verify DB integrity: expense and transaction remain 10000
    const [dbExp] = await db.select().from(expensesTable).where(eq(expensesTable.id, exp.id));
    expect(Number(dbExp.amount)).toBe(10000);

    const [tx] = await db.select().from(transactionsTable).where(eq(transactionsTable.expenseId, exp.id));
    expect(Number(tx.amount)).toBe(10000);
  });

  it('attempting to edit description/category only of a paid expense returns 409 Conflict', async () => {
    const exp = await createTestExpense({ crecheId: crecheA.id, amount: 10000, isPaid: false });

    // Pay
    await request(app)
      .post(`/api/creches/${crecheA.id}/financial/expenses/${exp.id}/pay`)
      .set('Authorization', `Bearer ${tokenAdminA}`);

    const res = await request(app)
      .put(`/api/creches/${crecheA.id}/financial/expenses/${exp.id}`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        description: 'Tentativa Alterar Descricao',
        category: 'outros',
        amount: 10000,
        dueDate: '2026-09-20',
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/não é possível editar uma despesa que já foi paga/i);

    const [dbExp] = await db.select().from(expensesTable).where(eq(expensesTable.id, exp.id));
    expect(dbExp.description).toBe(exp.description);
  });

  it('attempting to delete a paid expense returns 409 Conflict and preserves transaction history', async () => {
    const exp = await createTestExpense({ crecheId: crecheA.id, amount: 10000, isPaid: false });

    // Pay
    await request(app)
      .post(`/api/creches/${crecheA.id}/financial/expenses/${exp.id}/pay`)
      .set('Authorization', `Bearer ${tokenAdminA}`);

    // Attempt delete
    const res = await request(app)
      .delete(`/api/creches/${crecheA.id}/financial/expenses/${exp.id}`)
      .set('Authorization', `Bearer ${tokenAdminA}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/não é possível excluir uma despesa que já foi paga/i);

    // Expense and transaction both remain intact
    const [dbExp] = await db.select().from(expensesTable).where(eq(expensesTable.id, exp.id));
    expect(dbExp).toBeDefined();

    const txs = await db.select().from(transactionsTable).where(eq(transactionsTable.expenseId, exp.id));
    expect(txs.length).toBe(1);
    expect(Number(txs[0].amount)).toBe(10000);
  });
});

describe('R21F — Concurrency & Race Safety', () => {
  it('concurrent PUT and POST /pay never allows expense and transaction amounts to diverge', async () => {
    const exp = await createTestExpense({ crecheId: crecheA.id, amount: 10000, isPaid: false });

    const [resEdit, resPay] = await Promise.all([
      request(app)
        .put(`/api/creches/${crecheA.id}/financial/expenses/${exp.id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          description: 'Despesa Concorrente',
          category: 'aluguel',
          amount: 20000,
          dueDate: '2026-09-20',
        }),
      request(app)
        .post(`/api/creches/${crecheA.id}/financial/expenses/${exp.id}/pay`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ paymentMethod: 'cash' }),
    ]);

    expect([200, 409]).toContain(resEdit.status);
    expect(resPay.status).toBe(200);

    const [dbExp] = await db.select().from(expensesTable).where(eq(expensesTable.id, exp.id));
    const [tx] = await db.select().from(transactionsTable).where(eq(transactionsTable.expenseId, exp.id));

    expect(dbExp.isPaid).toBe(true);
    expect(tx).toBeDefined();
    // Invariant: expense amount MUST equal transaction amount
    expect(Number(dbExp.amount)).toBe(Number(tx.amount));
  });

  it('concurrent DELETE and POST /pay never produces an orphan transaction without expense record', async () => {
    const exp = await createTestExpense({ crecheId: crecheA.id, amount: 10000, isPaid: false });

    const [resDel, resPay] = await Promise.all([
      request(app)
        .delete(`/api/creches/${crecheA.id}/financial/expenses/${exp.id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`),
      request(app)
        .post(`/api/creches/${crecheA.id}/financial/expenses/${exp.id}/pay`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ paymentMethod: 'cash' }),
    ]);

    expect([200, 409]).toContain(resDel.status);

    const [dbExp] = await db.select().from(expensesTable).where(eq(expensesTable.id, exp.id));
    const txs = await db.select().from(transactionsTable).where(eq(transactionsTable.expenseId, exp.id));

    if (txs.length > 0) {
      // Pay succeeded: expense MUST exist and be marked paid
      expect(dbExp).toBeDefined();
      expect(dbExp.isPaid).toBe(true);
      expect(resDel.status).toBe(409);
    } else {
      // Delete succeeded: expense absent, zero transactions
      expect(dbExp).toBeUndefined();
      expect(resDel.status).toBe(200);
    }
  });

  it('concurrent POST /pay requests create exactly 1 transaction without double payment', async () => {
    const exp = await createTestExpense({ crecheId: crecheA.id, amount: 25000, isPaid: false });

    const [resPay1, resPay2] = await Promise.all([
      request(app)
        .post(`/api/creches/${crecheA.id}/financial/expenses/${exp.id}/pay`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ paymentMethod: 'pix' }),
      request(app)
        .post(`/api/creches/${crecheA.id}/financial/expenses/${exp.id}/pay`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ paymentMethod: 'pix' }),
    ]);

    expect([200, 400]).toContain(resPay1.status);
    expect([200, 400]).toContain(resPay2.status);

    const txs = await db.select().from(transactionsTable).where(eq(transactionsTable.expenseId, exp.id));
    expect(txs.length).toBe(1);
    expect(Number(txs[0].amount)).toBe(25000);
  });

  it('sequential POST /pay on already paid expense returns 400 Bad Request', async () => {
    const exp = await createTestExpense({ crecheId: crecheA.id, amount: 5000, isPaid: false });

    // First pay
    const res1 = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/expenses/${exp.id}/pay`)
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(res1.status).toBe(200);

    // Sequential second pay
    const res2 = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/expenses/${exp.id}/pay`)
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(res2.status).toBe(400);
    expect(res2.body.error).toMatch(/já está paga/i);
  });
});

describe('R21F — Tenant & Role Authorization Security', () => {
  it('Admin A cannot edit, delete, or pay an expense belonging to Creche B (403/404)', async () => {
    const expB = await createTestExpense({ crecheId: crecheB.id, amount: 10000, isPaid: false });

    // Try edit via Creche B route (403)
    const resEdit = await request(app)
      .put(`/api/creches/${crecheB.id}/financial/expenses/${expB.id}`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ description: 'Hack', category: 'outros', amount: 9999, dueDate: '2026-09-01' });
    expect(resEdit.status).toBe(403);

    // Try delete via Creche B route (403)
    const resDel = await request(app)
      .delete(`/api/creches/${crecheB.id}/financial/expenses/${expB.id}`)
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(resDel.status).toBe(403);

    // Try pay via Creche B route (403)
    const resPay = await request(app)
      .post(`/api/creches/${crecheB.id}/financial/expenses/${expB.id}/pay`)
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(resPay.status).toBe(403);

    // Try pass expB ID under Creche A route (404)
    const resPayCross = await request(app)
      .post(`/api/creches/${crecheA.id}/financial/expenses/${expB.id}/pay`)
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(resPayCross.status).toBe(404);
  });

  it('Staff and Tutor users are rejected with 403 on all expense endpoints', async () => {
    const exp = await createTestExpense({ crecheId: crecheA.id, amount: 10000, isPaid: false });

    // Staff
    const s1 = await request(app).get(`/api/creches/${crecheA.id}/financial/expenses`).set('Authorization', `Bearer ${tokenStaffA}`);
    expect(s1.status).toBe(403);

    const s2 = await request(app).post(`/api/creches/${crecheA.id}/financial/expenses`).set('Authorization', `Bearer ${tokenStaffA}`).send({ description: 'X', category: 'x', amount: 100, dueDate: '2026-09-01' });
    expect(s2.status).toBe(403);

    const s3 = await request(app).post(`/api/creches/${crecheA.id}/financial/expenses/${exp.id}/pay`).set('Authorization', `Bearer ${tokenStaffA}`);
    expect(s3.status).toBe(403);

    // Tutor
    const t1 = await request(app).get(`/api/creches/${crecheA.id}/financial/expenses`).set('Authorization', `Bearer ${tokenTutorA}`);
    expect(t1.status).toBe(403);

    const t2 = await request(app).post(`/api/creches/${crecheA.id}/financial/expenses/${exp.id}/pay`).set('Authorization', `Bearer ${tokenTutorA}`);
    expect(t2.status).toBe(403);
  });
});
