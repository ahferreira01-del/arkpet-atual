import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../artifacts/api-server/src/app.js';
import { db } from '@workspace/db';
import { petsTable, bookingsTable, tasksTable, usersTable } from '@workspace/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  createTestCreche,
  createTestUser,
  generateTestToken,
  createTestPet,
  createTestBooking,
  cleanupTestData,
} from '../helpers';

let creche: any;
let tutorA: any;
let tutorB: any;
let staff: any;
let admin: any;
let masterAdmin: any;

let tutorTokenA: string;
let tutorTokenB: string;
let staffToken: string;
let adminToken: string;
let masterAdminToken: string;

let petA: any;
let petB: any;
let bookingA: any;
let bookingB: any;

beforeAll(async () => {
  creche = await createTestCreche({ name: 'Creche Security Test' });

  tutorA = await createTestUser({ role: 'tutor', crecheId: creche.id, name: 'Tutor Alice' });
  tutorB = await createTestUser({ role: 'tutor', crecheId: creche.id, name: 'Tutor Bob' });
  staff = await createTestUser({ role: 'staff', crecheId: creche.id, name: 'Staff Charlie' });
  admin = await createTestUser({ role: 'creche_admin', crecheId: creche.id, name: 'Admin Diana' });
  masterAdmin = await createTestUser({ role: 'master_admin', crecheId: null, name: 'Master Admin' });

  tutorTokenA = generateTestToken(tutorA);
  tutorTokenB = generateTestToken(tutorB);
  staffToken = generateTestToken(staff);
  adminToken = generateTestToken(admin);
  masterAdminToken = generateTestToken(masterAdmin);

  const [pA] = await db.insert(petsTable).values({
    tutorId: tutorA.id,
    crecheId: creche.id,
    name: 'Pet Alpha',
    species: 'dog',
    feedingSchedule: [{ time: '08:00', amount: '200g', foodName: 'Ração Original' }],
    walkSchedule: [{ time: '07:00', durationMinutes: 30 }],
  }).returning();
  petA = pA;

  const [pB] = await db.insert(petsTable).values({
    tutorId: tutorB.id,
    crecheId: creche.id,
    name: 'Pet Beta',
    species: 'dog',
    feedingSchedule: [{ time: '09:00', amount: '150g', foodName: 'Ração Bob' }],
    walkSchedule: [{ time: '10:00', durationMinutes: 20 }],
  }).returning();
  petB = pB;

  const [bA] = await db.insert(bookingsTable).values({
    crecheId: creche.id,
    petId: petA.id,
    tutorId: tutorA.id,
    type: 'day_use',
    status: 'confirmed',
    startDate: '2026-08-20',
    endDate: '2026-08-20',
  }).returning();
  bookingA = bA;

  const [bB] = await db.insert(bookingsTable).values({
    crecheId: creche.id,
    petId: petB.id,
    tutorId: tutorB.id,
    type: 'day_use',
    status: 'confirmed',
    startDate: '2026-08-20',
    endDate: '2026-08-20',
  }).returning();
  bookingB = bB;
});

afterAll(async () => {
  await cleanupTestData(creche.id);
});

describe('R11-01: Pet Detail & Medical Child Read Ownership', () => {
  it('allows tutor to access their own pet detail (200 OK)', async () => {
    const res = await request(app)
      .get(`/api/creches/${creche.id}/pets/${petA.id}`)
      .set('Authorization', `Bearer ${tutorTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(petA.id);
    expect(res.body.name).toBe('Pet Alpha');
    expect(res.body.tutorId).toBe(tutorA.id);
  });

  it('blocks tutor from accessing another tutor pet detail in the same creche (404 Not Found)', async () => {
    const res = await request(app)
      .get(`/api/creches/${creche.id}/pets/${petB.id}`)
      .set('Authorization', `Bearer ${tutorTokenA}`);

    expect(res.status).toBe(404);
    expect(res.body.qrToken).toBeUndefined();
    expect(res.body.name).toBeUndefined();
    expect(res.body.feedingSchedule).toBeUndefined();
  });

  it('allows staff, creche_admin, and master_admin to view any pet in the creche', async () => {
    const resStaff = await request(app)
      .get(`/api/creches/${creche.id}/pets/${petB.id}`)
      .set('Authorization', `Bearer ${staffToken}`);
    expect(resStaff.status).toBe(200);
    expect(resStaff.body.name).toBe('Pet Beta');

    const resMaster = await request(app)
      .get(`/api/creches/${creche.id}/pets/${petB.id}`)
      .set('Authorization', `Bearer ${masterAdminToken}`);
    expect(resMaster.status).toBe(200);
  });

  it('blocks tutor from reading vaccines of another tutor pet (404)', async () => {
    const res = await request(app)
      .get(`/api/creches/${creche.id}/pets/${petB.id}/vaccines`)
      .set('Authorization', `Bearer ${tutorTokenA}`);

    expect(res.status).toBe(404);
  });

  it('blocks tutor from reading medications of another tutor pet (404)', async () => {
    const res = await request(app)
      .get(`/api/creches/${creche.id}/pets/${petB.id}/medications`)
      .set('Authorization', `Bearer ${tutorTokenA}`);

    expect(res.status).toBe(404);
  });

  it('blocks tutor from reading medical incidents of another tutor pet (404)', async () => {
    const res = await request(app)
      .get(`/api/creches/${creche.id}/medical/incidents/${petB.id}`)
      .set('Authorization', `Bearer ${tutorTokenA}`);

    expect(res.status).toBe(404);
  });
});

describe('R11-02: Pet Mutation Ownership & Field Authorization', () => {
  it('allows tutor to update allowed profile fields of their own pet', async () => {
    const res = await request(app)
      .put(`/api/creches/${creche.id}/pets/${petA.id}`)
      .set('Authorization', `Bearer ${tutorTokenA}`)
      .send({
        name: 'Pet Alpha Updated',
        breed: 'Labrador',
        weight: 22.5,
        allergies: 'Frango',
      });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Pet Alpha Updated');
    expect(res.body.breed).toBe('Labrador');
    expect(res.body.weight).toBe(22.5);
    expect(res.body.allergies).toBe('Frango');

    // DB verify
    const [saved] = await db.select().from(petsTable).where(eq(petsTable.id, petA.id));
    expect(saved.name).toBe('Pet Alpha Updated');
    expect(saved.allergies).toBe('Frango');
  });

  it('blocks tutor from mutating another tutor pet in the same creche (404)', async () => {
    const res = await request(app)
      .put(`/api/creches/${creche.id}/pets/${petB.id}`)
      .set('Authorization', `Bearer ${tutorTokenA}`)
      .send({
        name: 'Pet Beta Hacked',
      });

    expect(res.status).toBe(404);

    // Verify petB remains unmodified
    const [saved] = await db.select().from(petsTable).where(eq(petsTable.id, petB.id));
    expect(saved.name).toBe('Pet Beta');
  });

  it('blocks tutor from modifying operational care plans or pet status directly', async () => {
    const res = await request(app)
      .put(`/api/creches/${creche.id}/pets/${petA.id}`)
      .set('Authorization', `Bearer ${tutorTokenA}`)
      .send({
        feedingSchedule: [{ time: '12:00', amount: '500g', foodName: 'Injetado por Tutor' }],
        walkSchedule: [{ time: '15:00', durationMinutes: 90 }],
        status: 'archived',
      });

    expect(res.status).toBe(200);

    // Verify operational fields were ignored
    const [saved] = await db.select().from(petsTable).where(eq(petsTable.id, petA.id));
    expect(saved.status).toBe('active');
    expect(saved.feedingSchedule).not.toEqual([{ time: '12:00', amount: '500g', foodName: 'Injetado por Tutor' }]);
  });

  it('allows staff to edit operational care plan and status', async () => {
    const res = await request(app)
      .put(`/api/creches/${creche.id}/pets/${petA.id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        feedingSchedule: [{ time: '11:00', amount: '300g', foodName: 'Ração Staff' }],
        walkSchedule: [{ time: '16:00', durationMinutes: 45 }],
      });

    expect(res.status).toBe(200);
    const [saved] = await db.select().from(petsTable).where(eq(petsTable.id, petA.id));
    expect(saved.feedingSchedule).toEqual([{ time: '11:00', amount: '300g', foodName: 'Ração Staff' }]);
  });
});

describe('R11-03: On-The-Way Ownership Boundary', () => {
  it('allows tutor to signal on-the-way for their own booking', async () => {
    const res = await request(app)
      .post(`/api/creches/${creche.id}/bookings/${bookingA.id}/on-the-way`)
      .set('Authorization', `Bearer ${tutorTokenA}`)
      .send({ type: 'drop_off', etaMinutes: 15 });

    expect(res.status).toBe(200);
    expect(res.body.onTheWayType).toBe('drop_off');
    expect(res.body.onTheWayEtaMinutes).toBe(15);
  });

  it('blocks tutor from signaling on-the-way for another tutor booking (404)', async () => {
    const res = await request(app)
      .post(`/api/creches/${creche.id}/bookings/${bookingB.id}/on-the-way`)
      .set('Authorization', `Bearer ${tutorTokenA}`)
      .send({ type: 'drop_off', etaMinutes: 5 });

    expect(res.status).toBe(404);

    // Verify bookingB was not updated
    const [saved] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingB.id));
    expect(saved.onTheWayType).toBeNull();
  });
});

describe('R11-04: Check-in Role Boundary', () => {
  it('denies tutor from performing check-in (403 Forbidden)', async () => {
    const res = await request(app)
      .post(`/api/creches/${creche.id}/bookings/${bookingA.id}/checkin`)
      .set('Authorization', `Bearer ${tutorTokenA}`);

    expect(res.status).toBe(403);

    // Verify booking and pet remained in confirmed/not-checked-in state
    const [savedBooking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingA.id));
    expect(savedBooking.status).toBe('confirmed');
    const [savedPet] = await db.select().from(petsTable).where(eq(petsTable.id, petA.id));
    expect(savedPet.isCheckedIn).toBe(false);
  });

  it('allows staff to perform check-in and transitions pet to checked-in', async () => {
    const res = await request(app)
      .post(`/api/creches/${creche.id}/bookings/${bookingA.id}/checkin`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');

    // Verify pet is checked in
    const [savedPet] = await db.select().from(petsTable).where(eq(petsTable.id, petA.id));
    expect(savedPet.isCheckedIn).toBe(true);
  });
});
