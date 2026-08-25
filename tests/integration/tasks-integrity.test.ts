import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../artifacts/api-server/src/app.js';
import { db } from '@workspace/db';
import { tasksTable, petsTable } from '@workspace/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  createTestCreche,
  createTestUser,
  generateTestToken,
  createTestPet,
  cleanupTestData,
} from '../helpers';

let crecheA: any;
let crecheB: any;
let staffA: any;
let staffB: any;
let adminA: any;
let masterAdmin: any;
let tutorA: any;

let staffTokenA: string;
let staffTokenB: string;
let adminTokenA: string;
let masterAdminToken: string;
let tutorTokenA: string;

let petA: any;
let petB: any;

beforeAll(async () => {
  crecheA = await createTestCreche({ name: 'Creche Tasks A' });
  crecheB = await createTestCreche({ name: 'Creche Tasks B' });

  staffA = await createTestUser({ role: 'staff', crecheId: crecheA.id, name: 'Staff Alpha' });
  staffB = await createTestUser({ role: 'staff', crecheId: crecheB.id, name: 'Staff Beta' });
  adminA = await createTestUser({ role: 'creche_admin', crecheId: crecheA.id, name: 'Admin Alpha' });
  masterAdmin = await createTestUser({ role: 'master_admin', crecheId: null, name: 'Super Master' });
  tutorA = await createTestUser({ role: 'tutor', crecheId: crecheA.id, name: 'Tutor Alpha' });

  staffTokenA = generateTestToken(staffA);
  staffTokenB = generateTestToken(staffB);
  adminTokenA = generateTestToken(adminA);
  masterAdminToken = generateTestToken(masterAdmin);
  tutorTokenA = generateTestToken(tutorA);

  petA = await createTestPet({ tutorId: tutorA.id, crecheId: crecheA.id, name: 'Thor A' });
  petB = await createTestPet({ tutorId: tutorA.id, crecheId: crecheB.id, name: 'Loki B' });
});

afterAll(async () => {
  await cleanupTestData(crecheA.id);
  await cleanupTestData(crecheB.id);
});

describe('R10-01: Task Completion Idempotency & Audit Immutability', () => {
  it('first completion transitions pending -> completed and captures audit metadata', async () => {
    const [task] = await db.insert(tasksTable).values({
      crecheId: crecheA.id,
      petId: petA.id,
      type: 'medication',
      title: 'Dar Antibiótico',
      scheduledFor: new Date(),
      status: 'pending',
    }).returning();

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/tasks/${task.id}/complete`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .send({ notes: 'Dose 1 administrada com água.' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.completedBy).toBe(staffA.name);
    expect(res.body.notes).toBe('Dose 1 administrada com água.');
    expect(res.body.completedAt).toBeDefined();

    // Verify in DB
    const [saved] = await db.select().from(tasksTable).where(eq(tasksTable.id, task.id));
    expect(saved.status).toBe('completed');
    expect(saved.completedBy).toBe(staffA.name);
    expect(saved.notes).toBe('Dose 1 administrada com água.');
  });

  it('second completion is idempotent: returns 200 without altering completedAt, completedBy or notes', async () => {
    const [task] = await db.insert(tasksTable).values({
      crecheId: crecheA.id,
      petId: petA.id,
      type: 'feeding',
      title: 'Ração Especial',
      scheduledFor: new Date(),
      status: 'pending',
    }).returning();

    // Request #1 by Staff A
    const res1 = await request(app)
      .post(`/api/creches/${crecheA.id}/tasks/${task.id}/complete`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .send({ notes: 'Comeu tudo.' });

    expect(res1.status).toBe(200);
    const firstCompletedAt = res1.body.completedAt;
    const firstCompletedBy = res1.body.completedBy;
    const firstNotes = res1.body.notes;

    // Small delay to ensure any timestamp modification would be detectably different
    await new Promise(r => setTimeout(r, 50));

    // Request #2 by Staff B / Admin A with different notes
    const res2 = await request(app)
      .post(`/api/creches/${crecheA.id}/tasks/${task.id}/complete`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ notes: 'Tentativa de sobrescrever nota.' });

    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('completed');
    expect(res2.body.completedAt).toBe(firstCompletedAt);
    expect(res2.body.completedBy).toBe(firstCompletedBy);
    expect(res2.body.notes).toBe(firstNotes);

    // Verify DB remains immutable
    const [saved] = await db.select().from(tasksTable).where(eq(tasksTable.id, task.id));
    expect(saved.status).toBe('completed');
    expect(saved.completedBy).toBe(firstCompletedBy);
    expect(saved.notes).toBe(firstNotes);
    expect(new Date(saved.completedAt!).toISOString()).toBe(new Date(firstCompletedAt).toISOString());
  });

  it('complete returns 404 if task belongs to a different creche', async () => {
    const [taskB] = await db.insert(tasksTable).values({
      crecheId: crecheB.id,
      petId: petB.id,
      type: 'walk',
      title: 'Passeio Creche B',
      scheduledFor: new Date(),
      status: 'pending',
    }).returning();

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/tasks/${taskB.id}/complete`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .send({});

    expect(res.status).toBe(404);
  });
});

describe('R10-02: Tenant Reference Integrity on Creation and Batching', () => {
  it('blocks creating task with petId belonging to another creche', async () => {
    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/tasks`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .send({
        type: 'feeding',
        title: 'Alimentar Pet B na Creche A (Inválido)',
        scheduledFor: new Date().toISOString(),
        petId: petB.id, // Pet from Creche B
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Pet não encontrado/);

    // Verify no task was created
    const tasks = await db.select().from(tasksTable).where(
      and(eq(tasksTable.crecheId, crecheA.id), eq(tasksTable.petId, petB.id))
    );
    expect(tasks.length).toBe(0);
  });

  it('blocks creating task with assignedToId belonging to another creche', async () => {
    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/tasks`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .send({
        type: 'walk',
        title: 'Passeio atribuído a staff de outra creche (Inválido)',
        scheduledFor: new Date().toISOString(),
        petId: petA.id,
        assignedToId: staffB.id, // Staff from Creche B
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Funcionário não encontrado/);
  });

  it('allows creating task with same-creche pet and same-creche staff', async () => {
    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/tasks`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .send({
        type: 'walk',
        title: 'Passeio Válido',
        scheduledFor: new Date().toISOString(),
        petId: petA.id,
        assignedToId: staffA.id,
        priority: 'high',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.crecheId).toBe(crecheA.id);
    expect(res.body.petId).toBe(petA.id);
    expect(res.body.assignedToId).toBe(staffA.id);
  });

  it('complete-by-pet blocks petId belonging to another creche', async () => {
    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/tasks/complete-by-pet/${petB.id}`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Pet não encontrado/);
  });

  it('complete-by-pet is idempotent on repeated execution', async () => {
    await db.insert(tasksTable).values([
      { crecheId: crecheA.id, petId: petA.id, type: 'feeding', title: 'Batch Task 1', scheduledFor: new Date(), status: 'pending' },
      { crecheId: crecheA.id, petId: petA.id, type: 'walk', title: 'Batch Task 2', scheduledFor: new Date(), status: 'pending' },
    ]);

    // Batch call #1
    const res1 = await request(app)
      .post(`/api/creches/${crecheA.id}/tasks/complete-by-pet/${petA.id}`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .send({});

    expect(res1.status).toBe(200);
    expect(res1.body.completed).toBeGreaterThanOrEqual(2);

    // Batch call #2 (immediately after)
    const res2 = await request(app)
      .post(`/api/creches/${crecheA.id}/tasks/complete-by-pet/${petA.id}`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .send({});

    expect(res2.status).toBe(200);
    expect(res2.body.completed).toBe(0);
  });
});

describe('R10-03: Mutation Role Authorization & Tutor Protection', () => {
  it('denies tutor from creating tasks (403 Forbidden)', async () => {
    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/tasks`)
      .set('Authorization', `Bearer ${tutorTokenA}`)
      .send({
        type: 'feeding',
        title: 'Tutor tentando criar tarefa',
        scheduledFor: new Date().toISOString(),
        petId: petA.id,
      });

    expect(res.status).toBe(403);
  });

  it('denies tutor from completing tasks (403 Forbidden)', async () => {
    const [task] = await db.insert(tasksTable).values({
      crecheId: crecheA.id,
      petId: petA.id,
      type: 'feeding',
      title: 'Tarefa para teste de tutor complete',
      scheduledFor: new Date(),
      status: 'pending',
    }).returning();

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/tasks/${task.id}/complete`)
      .set('Authorization', `Bearer ${tutorTokenA}`)
      .send({});

    expect(res.status).toBe(403);

    // Task must remain pending
    const [saved] = await db.select().from(tasksTable).where(eq(tasksTable.id, task.id));
    expect(saved.status).toBe('pending');
  });

  it('denies tutor from batch-completing tasks (403 Forbidden)', async () => {
    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/tasks/complete-by-pet/${petA.id}`)
      .set('Authorization', `Bearer ${tutorTokenA}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('preserves tutor GET /tasks returning 200 with empty array []', async () => {
    const res = await request(app)
      .get(`/api/creches/${crecheA.id}/tasks`)
      .set('Authorization', `Bearer ${tutorTokenA}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  it('allows creche_admin and master_admin to perform task mutations', async () => {
    // Admin creates task
    const createRes = await request(app)
      .post(`/api/creches/${crecheA.id}/tasks`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({
        type: 'grooming',
        title: 'Escovação por Admin',
        scheduledFor: new Date().toISOString(),
        petId: petA.id,
      });

    expect(createRes.status).toBe(201);
    const taskId = createRes.body.id;

    // Master admin completes task on crecheA
    const completeRes = await request(app)
      .post(`/api/creches/${crecheA.id}/tasks/${taskId}/complete`)
      .set('Authorization', `Bearer ${masterAdminToken}`)
      .send({ notes: 'Concluído pelo Master Admin' });

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.status).toBe('completed');
    expect(completeRes.body.completedBy).toBe(masterAdmin.name);
  });
});
