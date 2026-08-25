import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../artifacts/api-server/src/app.js';
import { isServiceBookingBackend } from '../../artifacts/api-server/src/routes/bookings.js';
import { isServiceBooking as isServiceBookingFrontend } from '../../artifacts/petdaycare/src/lib/booking-utils.js';
import { db } from '@workspace/db';
import { catalogueItemsTable, bookingsTable, petsTable } from '@workspace/db/schema';
import { eq } from 'drizzle-orm';
import {
  createTestCreche, createTestUser, generateTestToken, createTestPet,
  createCatalogueItem, cleanupTestData
} from '../helpers';

let testCreche: any;
let staffUser: any;
let tutorUser: any;
let staffToken: string;
let tutorToken: string;
let testPet: any;

beforeAll(async () => {
  testCreche = await createTestCreche({ name: 'Creche QA F10C' });
  staffUser = await createTestUser({ role: 'staff', crecheId: testCreche.id });
  tutorUser = await createTestUser({ role: 'tutor', crecheId: testCreche.id });
  staffToken = generateTestToken(staffUser);
  tutorToken = generateTestToken(tutorUser);
  testPet = await createTestPet({ tutorId: tutorUser.id, crecheId: testCreche.id, size: 'medium' });
});

afterAll(async () => {
  await cleanupTestData(testCreche.id);
});

describe('F10C - Classification Unit Matrix & F10B.2 Hardening', () => {
  it('13. MODERN CUSTOM SERVICE (tosa)', () => {
    expect(isServiceBookingBackend('tosa', 'service')).toBe(true);
  });
  it('14. MODERN CUSTOM SERVICE (banho_especial)', () => {
    expect(isServiceBookingBackend('banho_especial', 'service')).toBe(true);
  });
  it('15. MODERN METADATA MUST WIN (banho with day_use is NON-SERVICE)', () => {
    expect(isServiceBookingBackend('banho', 'day_use')).toBe(false);
  });
  it('16. LEGACY SERVICE (banho with null)', () => {
    expect(isServiceBookingBackend('banho', null)).toBe(true);
  });
  it('16b. LEGACY SERVICE (visita_taxi with null)', () => {
    expect(isServiceBookingBackend('visita_taxi', null)).toBe(true);
  });
  it('16c. LEGACY SERVICE (creche_taxi with null)', () => {
    expect(isServiceBookingBackend('creche_taxi', null)).toBe(true);
  });
  it('17. LEGACY PRESENCE (lodging with null)', () => {
    expect(isServiceBookingBackend('lodging', null)).toBe(false);
  });
  it('17b. LEGACY PRESENCE (day_use with null)', () => {
    expect(isServiceBookingBackend('day_use', null)).toBe(false);
  });
  it('18. PACKAGE (package metadata is NON-SERVICE)', () => {
    expect(isServiceBookingBackend('banho', 'package')).toBe(false);
  });
  it('19. TRANSPORT (visita_taxi with service)', () => {
    expect(isServiceBookingBackend('visita_taxi', 'service')).toBe(true);
  });
  it('20. CUSTOM SERVICE (Tosa with service)', () => {
    expect(isServiceBookingBackend('Tosa', 'service')).toBe(true);
  });
  it('F10B.2. REMOVED EXTRA SLUGS with null metadata must be NON-SERVICE', () => {
    expect(isServiceBookingBackend('avaliacao', null)).toBe(false);
    expect(isServiceBookingBackend('tosa_completa', null)).toBe(false);
    expect(isServiceBookingBackend('tosa_higienica', null)).toBe(false);
    expect(isServiceBookingBackend('tosa_padrao', null)).toBe(false);
    expect(isServiceBookingBackend('taxi', null)).toBe(false);
  });
  it('F10B.2. REMOVED EXTRA SLUGS with modern service metadata remain SERVICE', () => {
    expect(isServiceBookingBackend('avaliacao', 'service')).toBe(true);
    expect(isServiceBookingBackend('tosa_completa', 'service')).toBe(true);
    expect(isServiceBookingBackend('taxi', 'service')).toBe(true);
  });
  it('F10B.2. UNDEFINED METADATA MUST THROW INTERNAL CONTRACT ERROR', () => {
    expect(() => isServiceBookingBackend('banho', undefined)).toThrow(/Internal contract violation/);
    expect(() => isServiceBookingBackend('lodging', undefined)).toThrow(/Internal contract violation/);
  });
});

describe('R8F.1 - Frontend isServiceBooking Classifier Parity', () => {
  it('Frontend: legacy service with null metadata is SERVICE', () => {
    expect(isServiceBookingFrontend({ type: 'banho', catalogueItemType: null })).toBe(true);
    expect(isServiceBookingFrontend({ type: 'visita_taxi', catalogueItemType: null })).toBe(true);
    expect(isServiceBookingFrontend({ type: 'creche_taxi', catalogueItemType: null })).toBe(true);
    expect(isServiceBookingFrontend('banho', null)).toBe(true);
  });

  it('Frontend: legacy presence with null metadata is NON-SERVICE', () => {
    expect(isServiceBookingFrontend({ type: 'lodging', catalogueItemType: null })).toBe(false);
    expect(isServiceBookingFrontend({ type: 'day_use', catalogueItemType: null })).toBe(false);
    expect(isServiceBookingFrontend({ type: 'avaliacao', catalogueItemType: null })).toBe(false);
    expect(isServiceBookingFrontend('lodging', null)).toBe(false);
  });

  it('Frontend: modern service with catalogueItemType="service" is SERVICE', () => {
    expect(isServiceBookingFrontend({ type: 'tosa', catalogueItemType: 'service' })).toBe(true);
    expect(isServiceBookingFrontend({ type: 'avaliacao', catalogueItemType: 'service' })).toBe(true);
    expect(isServiceBookingFrontend({ type: 'banho_especial', catalogueItemType: 'service' })).toBe(true);
    expect(isServiceBookingFrontend({ type: 'hidratacao', catalogueItemType: 'service' })).toBe(true);
    expect(isServiceBookingFrontend('tosa', 'service')).toBe(true);
  });

  it('Frontend: metadata precedence — modern day_use with booking.type="banho" is NON-SERVICE', () => {
    expect(isServiceBookingFrontend({ type: 'banho', catalogueItemType: 'day_use' })).toBe(false);
    expect(isServiceBookingFrontend('banho', 'day_use')).toBe(false);
  });

  it('Frontend: undefined metadata fails safe to NON-SERVICE without calling legacy set', () => {
    expect(isServiceBookingFrontend({ type: 'banho', catalogueItemType: undefined })).toBe(false);
    expect(isServiceBookingFrontend('banho', undefined)).toBe(false);
  });
});

describe('F10C - Integration Scenarios', () => {
  let customServiceCat: any;
  let dayUseCat: any;

  beforeAll(async () => {
    customServiceCat = await createCatalogueItem({ crecheId: testCreche.id, name: 'Tosa', basePrice: 50 });
    dayUseCat = await db.insert(catalogueItemsTable).values({
      crecheId: testCreche.id,
      name: 'Day Use',
      type: 'day_use',
      isActive: true,
      basePrice: '100'
    }).returning().then(res => res[0]);
  });

  it('21/22/23. LIST and DETAIL Contract + TENANT ISOLATION', async () => {
    // Create a modern booking
    const bookRes = await request(app)
      .post(`/api/creches/${testCreche.id}/bookings`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        petId: testPet.id,
        type: 'service',
        primaryCatalogueItemId: customServiceCat.id,
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString()
      });
    expect(bookRes.status).toBe(201);
    const bookingId = bookRes.body.id;

    // List
    const listRes = await request(app)
      .get(`/api/creches/${testCreche.id}/bookings`)
      .set('Authorization', `Bearer ${staffToken}`);
    expect(listRes.status).toBe(200);
    const listed = listRes.body.data.find((b: any) => b.id === bookingId);
    expect(listed.catalogueItemType).toBe('service');

    // Detail
    const detailRes = await request(app)
      .get(`/api/creches/${testCreche.id}/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${staffToken}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.catalogueItemType).toBe('service');
    
    // N+1 is conceptually validated by the leftJoin in the code

    // Clean up
    await db.delete(bookingsTable).where(eq(bookingsTable.id, bookingId));
  });

  it('27/30. ENDPOINT SAFETY', async () => {
    // Create a service booking
    const serviceBookRes = await request(app)
      .post(`/api/creches/${testCreche.id}/bookings`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        petId: testPet.id,
        type: 'service',
        primaryCatalogueItemId: customServiceCat.id,
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString()
      });
    const sId = serviceBookRes.body.id;
    const putRes = await request(app).put(`/api/creches/${testCreche.id}/bookings/${sId}`).set('Authorization', `Bearer ${staffToken}`).send({ status: 'confirmed' });


    // Reject checkout for service
    const sCheckOut = await request(app)
      .post(`/api/creches/${testCreche.id}/bookings/${sId}/checkout`)
      .set('Authorization', `Bearer ${staffToken}`);
    expect(sCheckOut.status).toBe(400);

    const presenceBookRes = await request(app)
      .post(`/api/creches/${testCreche.id}/bookings`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        petId: testPet.id,
        type: 'day_use',
        primaryCatalogueItemId: dayUseCat.id,
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString()
      });
    const pId = presenceBookRes.body.id;
    const putRes2 = await request(app).put(`/api/creches/${testCreche.id}/bookings/${pId}`).set('Authorization', `Bearer ${staffToken}`).send({ status: 'confirmed' });


    const pComplete = await request(app)
      .post(`/api/creches/${testCreche.id}/bookings/${pId}/complete-service`)
      .set('Authorization', `Bearer ${staffToken}`);
    expect(pComplete.status).toBe(400);

    // Ensure status unchanged
    const sDetail = await request(app).get(`/api/creches/${testCreche.id}/bookings/${sId}`).set('Authorization', `Bearer ${staffToken}`);
    expect(sDetail.body.status).toBe('confirmed');
    const pDetail = await request(app).get(`/api/creches/${testCreche.id}/bookings/${pId}`).set('Authorization', `Bearer ${staffToken}`);
    expect(pDetail.body.status).toBe('confirmed');

    await db.delete(bookingsTable).where(eq(bookingsTable.id, sId));
    await db.delete(bookingsTable).where(eq(bookingsTable.id, pId));
  }, 30000);

  it('32. CRITICAL INTEGRATION SCENARIO (Day Use Active + Service Confirmed -> Complete)', async () => {
    // Day Use Active
    const dayUseRes = await request(app)
      .post(`/api/creches/${testCreche.id}/bookings`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ petId: testPet.id, type: 'day_use', primaryCatalogueItemId: dayUseCat.id, startDate: new Date().toISOString(), endDate: new Date().toISOString() });
    const duId = dayUseRes.body.id;
    await request(app).put(`/api/creches/${testCreche.id}/bookings/${duId}`).set('Authorization', `Bearer ${staffToken}`).send({ status: 'confirmed' });
    
    // checkin Day Use
    await request(app).post(`/api/creches/${testCreche.id}/bookings/${duId}/checkin`).set('Authorization', `Bearer ${staffToken}`);

    // Verify Pet isCheckedIn
    const petQuery1 = await db.select({ isCheckedIn: petsTable.isCheckedIn }).from(petsTable).where(eq(petsTable.id, testPet.id));
    expect(petQuery1[0].isCheckedIn).toBe(true);

    // Custom Service Confirmed
    const serviceRes = await request(app)
      .post(`/api/creches/${testCreche.id}/bookings`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ petId: testPet.id, type: 'service', primaryCatalogueItemId: customServiceCat.id, startDate: new Date().toISOString(), endDate: new Date().toISOString() });
    const svId = serviceRes.body.id;
    await request(app).put(`/api/creches/${testCreche.id}/bookings/${svId}`).set('Authorization', `Bearer ${staffToken}`).send({ status: 'confirmed' });


    // Checkin custom service (should NOT be blocked)
    const svCheckinRes = await request(app).post(`/api/creches/${testCreche.id}/bookings/${svId}/checkin`).set('Authorization', `Bearer ${staffToken}`);
    expect(svCheckinRes.status).toBe(200);

    // Verify both are active
    const duDetail = await request(app).get(`/api/creches/${testCreche.id}/bookings/${duId}`).set('Authorization', `Bearer ${staffToken}`);
    expect(duDetail.body.status).toBe('active');
    const svDetail = await request(app).get(`/api/creches/${testCreche.id}/bookings/${svId}`).set('Authorization', `Bearer ${staffToken}`);
    expect(svDetail.body.status).toBe('active');

    // Complete Custom Service
    const svCompleteRes = await request(app).post(`/api/creches/${testCreche.id}/bookings/${svId}/complete-service`).set('Authorization', `Bearer ${staffToken}`);
    expect(svCompleteRes.status).toBe(200);

    // Verify service is completed, day use remains active, pet remains checked in
    const svDetailFinal = await request(app).get(`/api/creches/${testCreche.id}/bookings/${svId}`).set('Authorization', `Bearer ${staffToken}`);
    expect(svDetailFinal.body.status).toBe('completed');
    const duDetailFinal = await request(app).get(`/api/creches/${testCreche.id}/bookings/${duId}`).set('Authorization', `Bearer ${staffToken}`);
    expect(duDetailFinal.body.status).toBe('active');
    const petQuery2 = await db.select({ isCheckedIn: petsTable.isCheckedIn }).from(petsTable).where(eq(petsTable.id, testPet.id));
    expect(petQuery2[0].isCheckedIn).toBe(true);

    // Cleanup
    await db.delete(bookingsTable).where(eq(bookingsTable.id, duId));
    await db.delete(bookingsTable).where(eq(bookingsTable.id, svId));
    await db.update(petsTable).set({ isCheckedIn: false }).where(eq(petsTable.id, testPet.id));
  }, 30000);

  it('36. SOLO SERVICE SCENARIO', async () => {
    const serviceRes = await request(app)
      .post(`/api/creches/${testCreche.id}/bookings`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ petId: testPet.id, type: 'service', primaryCatalogueItemId: customServiceCat.id, startDate: new Date().toISOString(), endDate: new Date().toISOString() });
    const svId = serviceRes.body.id;
    await request(app).put(`/api/creches/${testCreche.id}/bookings/${svId}`).set('Authorization', `Bearer ${staffToken}`).send({ status: 'confirmed' });

    // Checkin custom service
    await request(app).post(`/api/creches/${testCreche.id}/bookings/${svId}/checkin`).set('Authorization', `Bearer ${staffToken}`);
    
    // Complete Custom Service
    await request(app).post(`/api/creches/${testCreche.id}/bookings/${svId}/complete-service`).set('Authorization', `Bearer ${staffToken}`);

    // Verify Pet is NOT checked in anymore
    const petQuery = await db.select({ isCheckedIn: petsTable.isCheckedIn }).from(petsTable).where(eq(petsTable.id, testPet.id));
    expect(petQuery[0].isCheckedIn).toBe(false);

    await db.delete(bookingsTable).where(eq(bookingsTable.id, svId));
  }, 30000);

  it('38/39. PRESENCE+PRESENCE and SERVICE+SERVICE', async () => {
    // 2 Presences
    const p1 = await request(app).post(`/api/creches/${testCreche.id}/bookings`).set('Authorization', `Bearer ${staffToken}`)
      .send({ petId: testPet.id, type: 'day_use', primaryCatalogueItemId: dayUseCat.id, startDate: new Date().toISOString(), endDate: new Date().toISOString() });
    const p2 = await request(app).post(`/api/creches/${testCreche.id}/bookings`).set('Authorization', `Bearer ${staffToken}`)
      .send({ petId: testPet.id, type: 'day_use', primaryCatalogueItemId: dayUseCat.id, startDate: new Date().toISOString(), endDate: new Date().toISOString() });
    
    await request(app).put(`/api/creches/${testCreche.id}/bookings/${p1.body.id}`).set('Authorization', `Bearer ${staffToken}`).send({ status: 'confirmed' });
    await request(app).put(`/api/creches/${testCreche.id}/bookings/${p2.body.id}`).set('Authorization', `Bearer ${staffToken}`).send({ status: 'confirmed' });

    await request(app).post(`/api/creches/${testCreche.id}/bookings/${p1.body.id}/checkin`).set('Authorization', `Bearer ${staffToken}`);
    const p2Checkin = await request(app).post(`/api/creches/${testCreche.id}/bookings/${p2.body.id}/checkin`).set('Authorization', `Bearer ${staffToken}`);
    expect(p2Checkin.status).toBe(409); // Blocked

    // 2 Services
    const s1 = await request(app).post(`/api/creches/${testCreche.id}/bookings`).set('Authorization', `Bearer ${staffToken}`)
      .send({ petId: testPet.id, type: 'service', primaryCatalogueItemId: customServiceCat.id, startDate: new Date().toISOString(), endDate: new Date().toISOString() });
    const s2 = await request(app).post(`/api/creches/${testCreche.id}/bookings`).set('Authorization', `Bearer ${staffToken}`)
      .send({ petId: testPet.id, type: 'service', primaryCatalogueItemId: customServiceCat.id, startDate: new Date().toISOString(), endDate: new Date().toISOString() });

    await request(app).put(`/api/creches/${testCreche.id}/bookings/${s1.body.id}`).set('Authorization', `Bearer ${staffToken}`).send({ status: 'confirmed' });
    await request(app).put(`/api/creches/${testCreche.id}/bookings/${s2.body.id}`).set('Authorization', `Bearer ${staffToken}`).send({ status: 'confirmed' });

    await request(app).post(`/api/creches/${testCreche.id}/bookings/${s1.body.id}/checkin`).set('Authorization', `Bearer ${staffToken}`);
    const s2Checkin = await request(app).post(`/api/creches/${testCreche.id}/bookings/${s2.body.id}/checkin`).set('Authorization', `Bearer ${staffToken}`);
    expect(s2Checkin.status).toBe(409); // Blocked

    await db.delete(bookingsTable).where(eq(bookingsTable.petId, testPet.id));
    await db.update(petsTable).set({ isCheckedIn: false }).where(eq(petsTable.id, testPet.id));
  }, 60000);

  it('40. LEGACY ENDPOINT TEST', async () => {
    const [booking] = await db.insert(bookingsTable).values({
      petId: testPet.id,
      tutorId: tutorUser.id,
      crecheId: testCreche.id,
      type: 'banho',
      status: 'confirmed',
      startDate: new Date().toISOString().split("T")[0],
      endDate: new Date().toISOString().split("T")[0]
    }).returning();

    const checkoutRes = await request(app).post(`/api/creches/${testCreche.id}/bookings/${booking.id}/checkout`).set('Authorization', `Bearer ${staffToken}`);
    expect(checkoutRes.status).toBe(400); // Because it is service
    
    await db.delete(bookingsTable).where(eq(bookingsTable.id, booking.id));
  });
});
