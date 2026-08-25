import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../artifacts/api-server/src/app.js';
import { db } from '@workspace/db';
import { petsTable, bookingsTable, tasksTable, medicationsTable, vaccinesTable, incidentsTable } from '@workspace/db/schema';
import { eq, and } from 'drizzle-orm';
import { generateTasksForPetToday } from '../../artifacts/api-server/src/lib/scheduler.js';
import {
  createTestCreche,
  createTestUser,
  generateTestToken,
  cleanupTestData,
} from '../helpers';

let crecheA: any;
let crecheB: any;
let tutorA: any;
let tutorB: any;
let staffA: any;
let adminA: any;
let masterAdmin: any;

let tutorTokenA: string;
let tutorTokenB: string;
let staffTokenA: string;
let adminTokenA: string;
let masterAdminToken: string;

let petA: any;
let petB: any;
let petOtherCreche: any;

beforeAll(async () => {
  crecheA = await createTestCreche({ name: 'Creche Med Test A' });
  crecheB = await createTestCreche({ name: 'Creche Med Test B' });

  tutorA = await createTestUser({ role: 'tutor', crecheId: crecheA.id, name: 'Tutor Alice Med' });
  tutorB = await createTestUser({ role: 'tutor', crecheId: crecheA.id, name: 'Tutor Bob Med' });
  staffA = await createTestUser({ role: 'staff', crecheId: crecheA.id, name: 'Staff Charlie Med' });
  adminA = await createTestUser({ role: 'creche_admin', crecheId: crecheA.id, name: 'Admin Diana Med' });
  masterAdmin = await createTestUser({ role: 'master_admin', crecheId: null, name: 'Master Admin Med' });

  tutorTokenA = generateTestToken(tutorA);
  tutorTokenB = generateTestToken(tutorB);
  staffTokenA = generateTestToken(staffA);
  adminTokenA = generateTestToken(adminA);
  masterAdminToken = generateTestToken(masterAdmin);

  const [pA] = await db.insert(petsTable).values({
    tutorId: tutorA.id,
    crecheId: crecheA.id,
    name: 'Rex Med',
    species: 'dog',
    status: 'active',
    isCheckedIn: true,
  }).returning();
  petA = pA;

  const [pB] = await db.insert(petsTable).values({
    tutorId: tutorB.id,
    crecheId: crecheA.id,
    name: 'Thor Med',
    species: 'dog',
    status: 'active',
    isCheckedIn: false,
  }).returning();
  petB = pB;

  const [pOther] = await db.insert(petsTable).values({
    tutorId: tutorB.id,
    crecheId: crecheB.id,
    name: 'Bella Creche B',
    species: 'dog',
    status: 'active',
    isCheckedIn: true,
  }).returning();
  petOtherCreche = pOther;
});

afterAll(async () => {
  await cleanupTestData();
});

describe('R12-01: Medication Task Multiplicity-Aware Deduplication', () => {
  it('generates 2 tasks for two different medications at the same time (08:00)', async () => {
    await db.delete(tasksTable).where(eq(tasksTable.petId, petA.id));
    await db.delete(medicationsTable).where(eq(medicationsTable.petId, petA.id));

    const todayStr = new Date().toISOString().split('T')[0];

    await db.insert(medicationsTable).values({
      crecheId: crecheA.id,
      petId: petA.id,
      name: 'Amoxicilina',
      dosage: '10mg',
      frequency: '12/12h',
      startDate: todayStr,
      times: ['08:00'],
      isActive: true,
    });

    await db.insert(medicationsTable).values({
      crecheId: crecheA.id,
      petId: petA.id,
      name: 'Prednisona',
      dosage: '5mg',
      frequency: 'Diário',
      startDate: todayStr,
      times: ['08:00'],
      isActive: true,
    });

    await generateTasksForPetToday(petA.id, crecheA.id);

    const tasks = await db.select().from(tasksTable).where(and(
      eq(tasksTable.petId, petA.id),
      eq(tasksTable.type, 'medication')
    ));

    expect(tasks.length).toBe(2);
    const descriptions = tasks.map(t => t.description);
    expect(descriptions).toContain('Amoxicilina · 10mg');
    expect(descriptions).toContain('Prednisona · 5mg');
  });

  it('generates 2 tasks for two distinct rows of identical medication at 08:00', async () => {
    await db.delete(tasksTable).where(eq(tasksTable.petId, petA.id));
    await db.delete(medicationsTable).where(eq(medicationsTable.petId, petA.id));

    const todayStr = new Date().toISOString().split('T')[0];

    await db.insert(medicationsTable).values([
      {
        crecheId: crecheA.id,
        petId: petA.id,
        name: 'Amoxicilina',
        dosage: '10mg',
        frequency: 'Diário',
        startDate: todayStr,
        times: ['08:00'],
        isActive: true,
      },
      {
        crecheId: crecheA.id,
        petId: petA.id,
        name: 'Amoxicilina',
        dosage: '10mg',
        frequency: 'Diário',
        startDate: todayStr,
        times: ['08:00'],
        isActive: true,
      },
    ]);

    await generateTasksForPetToday(petA.id, crecheA.id);

    const tasks = await db.select().from(tasksTable).where(and(
      eq(tasksTable.petId, petA.id),
      eq(tasksTable.type, 'medication')
    ));

    expect(tasks.length).toBe(2);
  });

  it('is idempotent on rerun: task count remains 2', async () => {
    await generateTasksForPetToday(petA.id, crecheA.id);

    const tasks = await db.select().from(tasksTable).where(and(
      eq(tasksTable.petId, petA.id),
      eq(tasksTable.type, 'medication')
    ));

    expect(tasks.length).toBe(2);
  });

  it('generates missing delta when partial historical tasks exist (desired 2, existing 1 -> adds 1)', async () => {
    const allTasks = await db.select().from(tasksTable).where(and(
      eq(tasksTable.petId, petA.id),
      eq(tasksTable.type, 'medication')
    ));

    await db.delete(tasksTable).where(eq(tasksTable.id, allTasks[0].id));

    const remainingTasks = await db.select().from(tasksTable).where(and(
      eq(tasksTable.petId, petA.id),
      eq(tasksTable.type, 'medication')
    ));
    expect(remainingTasks.length).toBe(1);

    await generateTasksForPetToday(petA.id, crecheA.id);

    const restoredTasks = await db.select().from(tasksTable).where(and(
      eq(tasksTable.petId, petA.id),
      eq(tasksTable.type, 'medication')
    ));
    expect(restoredTasks.length).toBe(2);
  });

  it('deduplicates duplicate times in a single medication row (times: ["08:00", "08:00"] -> 1 task)', async () => {
    await db.delete(tasksTable).where(eq(tasksTable.petId, petA.id));
    await db.delete(medicationsTable).where(eq(medicationsTable.petId, petA.id));

    const todayStr = new Date().toISOString().split('T')[0];

    await db.insert(medicationsTable).values({
      crecheId: crecheA.id,
      petId: petA.id,
      name: 'Vitamina C',
      dosage: '1 comprimido',
      frequency: 'Diário',
      startDate: todayStr,
      times: ['08:00', '08:00'],
      isActive: true,
    });

    await generateTasksForPetToday(petA.id, crecheA.id);

    const tasks = await db.select().from(tasksTable).where(and(
      eq(tasksTable.petId, petA.id),
      eq(tasksTable.type, 'medication')
    ));

    expect(tasks.length).toBe(1);
  });
});

describe('R12-02: Late Medication Creation Task Trigger', () => {
  it('triggers task generation when medication is created for checked-in pet via /pets/:petId/medications', async () => {
    await db.delete(tasksTable).where(eq(tasksTable.petId, petA.id));
    await db.delete(medicationsTable).where(eq(medicationsTable.petId, petA.id));

    const todayStr = new Date().toISOString().split('T')[0];

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/pets/${petA.id}/medications`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .send({
        name: 'Late Antibiotic',
        dosage: '250mg',
        frequency: 'Diário',
        startDate: todayStr,
        times: ['18:00'],
      });

    expect(res.status).toBe(201);

    // Wait for async task generation
    let tasks: any[] = [];
    for (let i = 0; i < 20; i++) {
      tasks = await db.select().from(tasksTable).where(and(
        eq(tasksTable.petId, petA.id),
        eq(tasksTable.type, 'medication')
      ));
      if (tasks.length === 1) break;
      await new Promise(r => setTimeout(r, 50));
    }

    expect(tasks.length).toBe(1);
    expect(tasks[0].description).toBe('Late Antibiotic · 250mg');
  });

  it('triggers task generation when medication is created for checked-in pet via /medical/medications', async () => {
    const todayStr = new Date().toISOString().split('T')[0];

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/medical/medications`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .send({
        petId: petA.id,
        name: 'Late Anti-inflammatory',
        dosage: '20mg',
        frequency: 'Diário',
        startDate: todayStr,
        times: ['19:00'],
      });

    expect(res.status).toBe(201);

    // Wait for async task generation
    let tasks: any[] = [];
    for (let i = 0; i < 20; i++) {
      tasks = await db.select().from(tasksTable).where(and(
        eq(tasksTable.petId, petA.id),
        eq(tasksTable.type, 'medication')
      ));
      if (tasks.length === 2) break;
      await new Promise(r => setTimeout(r, 50));
    }

    expect(tasks.length).toBe(2);
    const descriptions = tasks.map(t => t.description);
    expect(descriptions).toContain('Late Anti-inflammatory · 20mg');
  });

  it('does NOT trigger task generation when pet is NOT checked-in (petB)', async () => {
    await db.delete(tasksTable).where(eq(tasksTable.petId, petB.id));
    await db.delete(medicationsTable).where(eq(medicationsTable.petId, petB.id));

    const todayStr = new Date().toISOString().split('T')[0];

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/medical/medications`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .send({
        petId: petB.id,
        name: 'Home Medication',
        dosage: '10mg',
        frequency: 'Diário',
        startDate: todayStr,
        times: ['20:00'],
      });

    expect(res.status).toBe(201);

    await new Promise(r => setTimeout(r, 200));

    const tasks = await db.select().from(tasksTable).where(and(
      eq(tasksTable.petId, petB.id),
      eq(tasksTable.type, 'medication')
    ));

    expect(tasks.length).toBe(0);
  });
});

describe('R12-03, R12-04, R12-05: Direct Medical Routes Security & Authorization', () => {
  it('allows tutor to create vaccine for own pet via POST /medical/vaccines', async () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/medical/vaccines`)
      .set('Authorization', `Bearer ${tutorTokenA}`)
      .send({
        petId: petA.id,
        name: 'Raiva Own Pet',
        appliedDate: todayStr,
        receiptUrl: 'https://example.com/receipt.jpg',
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Raiva Own Pet');
  });

  it('blocks tutor from creating vaccine for foreign pet via POST /medical/vaccines (404)', async () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/medical/vaccines`)
      .set('Authorization', `Bearer ${tutorTokenA}`)
      .send({
        petId: petB.id,
        name: 'Raiva Foreign Pet',
        appliedDate: todayStr,
      });

    expect(res.status).toBe(404);
  });

  it('blocks staff from creating vaccine for pet of another creche via POST /medical/vaccines (404)', async () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/medical/vaccines`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .send({
        petId: petOtherCreche.id,
        name: 'Raiva Other Creche',
        appliedDate: todayStr,
      });

    expect(res.status).toBe(404);
  });

  it('allows tutor to update vaccine receipt for own pet via POST /medical/vaccines/:id/receipt', async () => {
    const [vaccine] = await db.insert(vaccinesTable).values({
      crecheId: crecheA.id,
      petId: petA.id,
      name: 'V8 Own',
      appliedDate: '2026-08-01',
    }).returning();

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/medical/vaccines/${vaccine.id}/receipt`)
      .set('Authorization', `Bearer ${tutorTokenA}`)
      .send({ receiptUrl: 'https://example.com/new-receipt.jpg' });

    expect(res.status).toBe(200);
    expect(res.body.receiptUrl).toBe('https://example.com/new-receipt.jpg');
  });

  it('blocks tutor from updating vaccine receipt for foreign pet (404)', async () => {
    const [foreignVaccine] = await db.insert(vaccinesTable).values({
      crecheId: crecheA.id,
      petId: petB.id,
      name: 'V8 Foreign',
      appliedDate: '2026-08-01',
      receiptUrl: 'https://example.com/original.jpg',
    }).returning();

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/medical/vaccines/${foreignVaccine.id}/receipt`)
      .set('Authorization', `Bearer ${tutorTokenA}`)
      .send({ receiptUrl: 'https://example.com/hacked.jpg' });

    expect(res.status).toBe(404);

    const [check] = await db.select().from(vaccinesTable).where(eq(vaccinesTable.id, foreignVaccine.id));
    expect(check.receiptUrl).toBe('https://example.com/original.jpg');
  });

  it('blocks staff from updating vaccine receipt for vaccine of another creche (404)', async () => {
    const [otherCrecheVaccine] = await db.insert(vaccinesTable).values({
      crecheId: crecheB.id,
      petId: petOtherCreche.id,
      name: 'V8 Creche B',
      appliedDate: '2026-08-01',
    }).returning();

    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/medical/vaccines/${otherCrecheVaccine.id}/receipt`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .send({ receiptUrl: 'https://example.com/cross.jpg' });

    expect(res.status).toBe(404);
  });

  it('blocks tutor from creating medications via POST /medical/medications (403)', async () => {
    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/medical/medications`)
      .set('Authorization', `Bearer ${tutorTokenA}`)
      .send({
        petId: petA.id,
        name: 'Tutor Med',
        dosage: '10mg',
        frequency: 'Diário',
        startDate: '2026-08-20',
      });

    expect(res.status).toBe(403);
  });

  it('blocks staff from creating medication for pet of another creche (404)', async () => {
    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/medical/medications`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .send({
        petId: petOtherCreche.id,
        name: 'Cross Med',
        dosage: '10mg',
        frequency: 'Diário',
        startDate: '2026-08-20',
      });

    expect(res.status).toBe(404);
  });

  it('blocks tutor from creating incidents via POST /medical/incidents (403)', async () => {
    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/medical/incidents`)
      .set('Authorization', `Bearer ${tutorTokenA}`)
      .send({
        petId: petA.id,
        description: 'Tutor reported scratch',
        severity: 'low',
      });

    expect(res.status).toBe(403);
  });

  it('blocks staff from creating incident for pet of another creche (404)', async () => {
    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/medical/incidents`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .send({
        petId: petOtherCreche.id,
        description: 'Cross creche incident',
        severity: 'low',
      });

    expect(res.status).toBe(404);
  });

  it('allows master_admin (with crecheId=null) to operate target creche medical endpoints', async () => {
    const res = await request(app)
      .get(`/api/creches/${crecheA.id}/medical/vaccines/${petA.id}`)
      .set('Authorization', `Bearer ${masterAdminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const medRes = await request(app)
      .post(`/api/creches/${crecheA.id}/medical/medications`)
      .set('Authorization', `Bearer ${masterAdminToken}`)
      .send({
        petId: petA.id,
        name: 'Master Admin Med',
        dosage: '5mg',
        frequency: 'Diário',
        startDate: '2026-08-20',
      });

    expect(medRes.status).toBe(201);
  });

  it('blocks master_admin from operating on pet of another creche within target creche URL (404)', async () => {
    const res = await request(app)
      .post(`/api/creches/${crecheA.id}/medical/medications`)
      .set('Authorization', `Bearer ${masterAdminToken}`)
      .send({
        petId: petOtherCreche.id,
        name: 'Master Admin Cross Med',
        dosage: '5mg',
        frequency: 'Diário',
        startDate: '2026-08-20',
      });

    expect(res.status).toBe(404);
  });
});
