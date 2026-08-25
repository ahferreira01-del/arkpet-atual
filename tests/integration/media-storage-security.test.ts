import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import app from '../../artifacts/api-server/src/app.js';
import { db } from '@workspace/db';
import {
  petsTable,
  usersTable,
  timelineEventsTable,
  timelineEventPetsTable,
  vaccinesTable,
  bookingsTable,
  invoicesTable,
  catalogueItemsTable,
  chatMessagesTable,
} from '@workspace/db/schema';
import { eq } from 'drizzle-orm';
import {
  createTestCreche,
  createTestUser,
  generateTestToken,
  cleanupTestData,
} from '../helpers';
import { generateMediaToken } from '../../artifacts/api-server/src/lib/mediaToken.js';
import { ObjectStorageService, ObjectNotFoundError } from '../../artifacts/api-server/src/lib/objectStorage.js';

describe('Private Media Resource Authorization & Storage Hardening (R17F)', () => {
  let creche1: any;
  let creche2: any;

  let tutor1A: any;
  let tutor1B: any;
  let tutor1C: any;
  let staff1A: any;
  let admin1A: any;

  let tutor2A: any;
  let staff2A: any;
  let masterAdmin: any;

  let tokenTutor1A: string;
  let tokenTutor1B: string;
  let tokenTutor1C: string;
  let tokenStaff1A: string;
  let tokenAdmin1A: string;
  let tokenTutor2A: string;
  let tokenStaff2A: string;
  let tokenMasterAdmin: string;

  let mediaTokenTutor1A: string;
  let mediaTokenTutor1B: string;
  let mediaTokenTutor1C: string;
  let mediaTokenTutor2A: string;

  let pet1A: any;
  let pet1B: any;
  let pet2A: any;

  // Mocked files in storage
  const existingFiles = new Set<string>();

  beforeAll(async () => {
    // 1. Setup Spies on ObjectStorageService
    vi.spyOn(ObjectStorageService.prototype, 'getObjectEntityFile').mockImplementation(async (objectPath: string) => {
      if (existingFiles.has(objectPath)) {
        return {
          name: objectPath,
          getMetadata: async () => [{ contentType: 'image/webp', size: 16 }],
        } as any;
      }
      throw new ObjectNotFoundError();
    });

    vi.spyOn(ObjectStorageService.prototype, 'downloadObject').mockImplementation(async (file: any) => {
      return new Response(new Uint8Array(Buffer.from('fake-image-bytes')), {
        status: 200,
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': '16',
          'Cache-Control': 'private, max-age=3600',
        },
      });
    });

    vi.spyOn(ObjectStorageService.prototype, 'uploadBuffer').mockImplementation(async (buffer, contentType, ownerId, crecheId) => {
      const ext = contentType.includes('video') ? '.mp4' : '.webp';
      const uuid = '00000000-0000-4000-8000-000000000001';
      const path = crecheId
        ? `/objects/uploads/c${crecheId}/${uuid}${ext}`
        : `/objects/uploads/${uuid}${ext}`;
      existingFiles.add(path);
      return path;
    });

    // 2. Seed Creches
    creche1 = await createTestCreche({ name: 'Storage Creche 1' });
    creche2 = await createTestCreche({ name: 'Storage Creche 2' });

    // 3. Seed Users
    tutor1A = await createTestUser({ role: 'tutor', crecheId: creche1.id, name: 'Tutor 1A' });
    tutor1B = await createTestUser({ role: 'tutor', crecheId: creche1.id, name: 'Tutor 1B' });
    tutor1C = await createTestUser({ role: 'tutor', crecheId: creche1.id, name: 'Tutor 1C' });
    staff1A = await createTestUser({ role: 'staff', crecheId: creche1.id, name: 'Staff 1A' });
    admin1A = await createTestUser({ role: 'creche_admin', crecheId: creche1.id, name: 'Admin 1A' });

    tutor2A = await createTestUser({ role: 'tutor', crecheId: creche2.id, name: 'Tutor 2A' });
    staff2A = await createTestUser({ role: 'staff', crecheId: creche2.id, name: 'Staff 2A' });

    const [mAdmin] = await db.insert(usersTable).values({
      name: 'Master Admin Global',
      email: `master-${Date.now()}@test.com`,
      passwordHash: 'dummyhash',
      role: 'master_admin',
      crecheId: null,
      isActive: true,
    }).returning();
    masterAdmin = mAdmin;

    // 4. Tokens
    tokenTutor1A = generateTestToken(tutor1A);
    tokenTutor1B = generateTestToken(tutor1B);
    tokenTutor1C = generateTestToken(tutor1C);
    tokenStaff1A = generateTestToken(staff1A);
    tokenAdmin1A = generateTestToken(admin1A);
    tokenTutor2A = generateTestToken(tutor2A);
    tokenStaff2A = generateTestToken(staff2A);
    tokenMasterAdmin = generateTestToken(masterAdmin);

    mediaTokenTutor1A = generateMediaToken(tutor1A.id, creche1.id);
    mediaTokenTutor1B = generateMediaToken(tutor1B.id, creche1.id);
    mediaTokenTutor1C = generateMediaToken(tutor1C.id, creche1.id);
    mediaTokenTutor2A = generateMediaToken(tutor2A.id, creche2.id);

    // 5. Seed Pets
    const [p1A] = await db.insert(petsTable).values({
      crecheId: creche1.id,
      tutorId: tutor1A.id,
      name: 'Pet 1A',
      species: 'dog',
      size: 'medium',
      breed: 'Labrador',
    }).returning();
    pet1A = p1A;

    const [p1B] = await db.insert(petsTable).values({
      crecheId: creche1.id,
      tutorId: tutor1B.id,
      name: 'Pet 1B',
      species: 'dog',
      size: 'small',
      breed: 'Poodle',
    }).returning();
    pet1B = p1B;

    const [p2A] = await db.insert(petsTable).values({
      crecheId: creche2.id,
      tutorId: tutor2A.id,
      name: 'Pet 2A',
      species: 'cat',
      size: 'small',
      breed: 'Siamese',
    }).returning();
    pet2A = p2A;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await cleanupTestData();
  });

  describe('1. Feed & Timeline Media Authorization (JWT & MediaToken)', () => {
    beforeAll(async () => {
      const path1A = `/objects/uploads/c${creche1.id}/11111111-1111-4111-8111-111111111111.webp`;
      const path1AB = `/objects/uploads/c${creche1.id}/22222222-2222-4222-8222-222222222222.webp`;
      const path1B = `/objects/uploads/c${creche1.id}/33333333-3333-4333-8333-333333333333.webp`;

      existingFiles.add(path1A);
      existingFiles.add(path1AB);
      existingFiles.add(path1B);

      // Event 1: Exclusive to Pet 1A
      const [ev1] = await db.insert(timelineEventsTable).values({
        crecheId: creche1.id,
        authorId: staff1A.id,
        type: 'photo',
        content: 'Exclusive 1A post',
        mediaUrl: path1A,
        mediaType: 'photo',
      }).returning();
      await db.insert(timelineEventPetsTable).values({ eventId: ev1.id, petId: pet1A.id });

      // Event 2: Shared between Pet 1A and Pet 1B
      const [ev2] = await db.insert(timelineEventsTable).values({
        crecheId: creche1.id,
        authorId: staff1A.id,
        type: 'photo',
        content: 'Shared 1AB post',
        mediaUrl: path1AB,
        mediaType: 'photo',
      }).returning();
      await db.insert(timelineEventPetsTable).values([
        { eventId: ev2.id, petId: pet1A.id },
        { eventId: ev2.id, petId: pet1B.id },
      ]);

      // Event 3: Exclusive to Pet 1B
      const [ev3] = await db.insert(timelineEventsTable).values({
        crecheId: creche1.id,
        authorId: staff1A.id,
        type: 'photo',
        content: 'Exclusive 1B post',
        mediaUrl: path1B,
        mediaType: 'photo',
      }).returning();
      await db.insert(timelineEventPetsTable).values({ eventId: ev3.id, petId: pet1B.id });
    });

    it('Tutor 1A can download own exclusive Feed media via Bearer JWT (200)', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/11111111-1111-4111-8111-111111111111.webp`)
        .set('Authorization', `Bearer ${tokenTutor1A}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/webp');
    });

    it('Tutor 1A can download own exclusive Feed media via ?mt= MediaToken (200)', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/11111111-1111-4111-8111-111111111111.webp?mt=${mediaTokenTutor1A}`);
      expect(res.status).toBe(200);
    });

    it('Tutor 1A CANNOT download Tutor 1B exclusive Feed media via Bearer JWT (403)', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/33333333-3333-4333-8333-333333333333.webp`)
        .set('Authorization', `Bearer ${tokenTutor1A}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Sem acesso a este arquivo');
    });

    it('Tutor 1A CANNOT download Tutor 1B exclusive Feed media via ?mt= MediaToken (403)', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/33333333-3333-4333-8333-333333333333.webp?mt=${mediaTokenTutor1A}`);
      expect(res.status).toBe(403);
    });

    it('Both Tutor 1A and Tutor 1B can download Shared Feed media (200)', async () => {
      const resA = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/22222222-2222-4222-8222-222222222222.webp`)
        .set('Authorization', `Bearer ${tokenTutor1A}`);
      expect(resA.status).toBe(200);

      const resB = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/22222222-2222-4222-8222-222222222222.webp`)
        .set('Authorization', `Bearer ${tokenTutor1B}`);
      expect(resB.status).toBe(200);
    });

    it('Unrelated Tutor 1C in same creche CANNOT download Shared 1AB Feed media (403)', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/22222222-2222-4222-8222-222222222222.webp`)
        .set('Authorization', `Bearer ${tokenTutor1C}`);
      expect(res.status).toBe(403);

      const resMt = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/22222222-2222-4222-8222-222222222222.webp?mt=${mediaTokenTutor1C}`);
      expect(resMt.status).toBe(403);
    });
  });

  describe('2. Cross-Tenant Direct Storage Isolation', () => {
    it('Tutor 1A (Creche 1) requesting Creche 2 media returns 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche2.id}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`)
        .set('Authorization', `Bearer ${tokenTutor1A}`);
      expect(res.status).toBe(403);
    });

    it('Staff 1A (Creche 1) requesting Creche 2 media returns 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche2.id}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`)
        .set('Authorization', `Bearer ${tokenStaff1A}`);
      expect(res.status).toBe(403);
    });

    it('Tutor 2A (Creche 2) with MediaToken requesting Creche 1 media returns 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/11111111-1111-4111-8111-111111111111.webp?mt=${mediaTokenTutor2A}`);
      expect(res.status).toBe(403);
    });
  });

  describe('3. Pet Photos, Check-in Photos & Vaccine Receipts Authorization', () => {
    beforeAll(async () => {
      const photoPath = `/objects/uploads/c${creche1.id}/44444444-4444-4444-8444-444444444444.webp`;
      const checkinPath = `/objects/uploads/c${creche1.id}/55555555-5555-4555-8555-555555555555.webp`;
      const vaccinePath = `/objects/uploads/c${creche1.id}/66666666-6666-4666-8666-666666666666.webp`;

      existingFiles.add(photoPath);
      existingFiles.add(checkinPath);
      existingFiles.add(vaccinePath);

      await db.update(petsTable)
        .set({ photoUrl: photoPath, lastCheckinPhotoUrl: checkinPath })
        .where(eq(petsTable.id, pet1A.id));

      await db.insert(vaccinesTable).values({
        crecheId: creche1.id,
        petId: pet1A.id,
        name: 'Rabies',
        appliedDate: '2026-01-01',
        receiptUrl: vaccinePath,
      });
    });

    it('Tutor 1A can download own Pet profile photo (200)', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/44444444-4444-4444-8444-444444444444.webp`)
        .set('Authorization', `Bearer ${tokenTutor1A}`);
      expect(res.status).toBe(200);
    });

    it('Tutor 1B CANNOT download Pet 1A profile photo (403)', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/44444444-4444-4444-8444-444444444444.webp`)
        .set('Authorization', `Bearer ${tokenTutor1B}`);
      expect(res.status).toBe(403);
    });

    it('Tutor 1A can download own Pet check-in photo (200)', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/55555555-5555-4555-8555-555555555555.webp`)
        .set('Authorization', `Bearer ${tokenTutor1A}`);
      expect(res.status).toBe(200);
    });

    it('Tutor 1A can download own Pet vaccine receipt (200)', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/66666666-6666-4666-8666-666666666666.webp`)
        .set('Authorization', `Bearer ${tokenTutor1A}`);
      expect(res.status).toBe(200);
    });

    it('Tutor 1B CANNOT download Pet 1A vaccine receipt (403)', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/66666666-6666-4666-8666-666666666666.webp`)
        .set('Authorization', `Bearer ${tokenTutor1B}`);
      expect(res.status).toBe(403);
    });
  });

  describe('4. Bookings, Invoices & Store Catalog Media Authorization', () => {
    beforeAll(async () => {
      const bookingPath = `/objects/uploads/c${creche1.id}/77777777-7777-4777-8777-777777777777.webp`;
      const invoicePath = `/objects/uploads/c${creche1.id}/88888888-8888-4888-8888-888888888888.webp`;
      const storePath   = `/objects/uploads/c${creche1.id}/99999999-9999-4999-8999-999999999999.webp`;

      existingFiles.add(bookingPath);
      existingFiles.add(invoicePath);
      existingFiles.add(storePath);

      // Booking for Tutor 1A
      await db.insert(bookingsTable).values({
        crecheId: creche1.id,
        petId: pet1A.id,
        tutorId: tutor1A.id,
        type: 'day_use',
        startDate: '2026-08-20',
        endDate: '2026-08-20',
        status: 'active',
        personalItemsPhotoUrl: bookingPath,
      });

      // Invoice for Tutor 1A
      await db.insert(invoicesTable).values({
        crecheId: creche1.id,
        tutorId: tutor1A.id,
        status: 'paid',
        amount: '150.00',
        dueDate: '2026-08-20',
        receiptPhotoPath: invoicePath,
      });

      // Store Product for Creche 1
      await db.insert(catalogueItemsTable).values({
        crecheId: creche1.id,
        name: 'Ração Premium',
        type: 'product',
        basePrice: '120.00',
        isActive: true,
        mediaUrls: [storePath],
      });
    });

    it('Tutor 1A can download own Booking personal items photo (200)', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/77777777-7777-4777-8777-777777777777.webp`)
        .set('Authorization', `Bearer ${tokenTutor1A}`);
      expect(res.status).toBe(200);
    });

    it('Tutor 1B CANNOT download Tutor 1A Booking personal items photo (403)', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/77777777-7777-4777-8777-777777777777.webp`)
        .set('Authorization', `Bearer ${tokenTutor1B}`);
      expect(res.status).toBe(403);
    });

    it('Tutor 1A can download own Invoice payment receipt (200)', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/88888888-8888-4888-8888-888888888888.webp`)
        .set('Authorization', `Bearer ${tokenTutor1A}`);
      expect(res.status).toBe(200);
    });

    it('Tutor 1B CANNOT download Tutor 1A Invoice payment receipt (403)', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/88888888-8888-4888-8888-888888888888.webp`)
        .set('Authorization', `Bearer ${tokenTutor1B}`);
      expect(res.status).toBe(403);
    });

    it('Any same-creche Tutor (Tutor 1A and Tutor 1B) can download active Store product image (200)', async () => {
      const resA = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/99999999-9999-4999-8999-999999999999.webp`)
        .set('Authorization', `Bearer ${tokenTutor1A}`);
      expect(resA.status).toBe(200);

      const resB = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/99999999-9999-4999-8999-999999999999.webp`)
        .set('Authorization', `Bearer ${tokenTutor1B}`);
      expect(resB.status).toBe(200);
    });

    it('Foreign Tutor 2A CANNOT download Creche 1 Store product image (403)', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/99999999-9999-4999-8999-999999999999.webp`)
        .set('Authorization', `Bearer ${tokenTutor2A}`);
      expect(res.status).toBe(403);
    });
  });

  describe('5. Chat Historical Media & Unreferenced Orphan Objects', () => {
    beforeAll(async () => {
      const chatPath = `/objects/uploads/c${creche1.id}/abababab-abab-4aba-8aba-abababababab.webp`;
      const orphanPath = `/objects/uploads/c${creche1.id}/efefefef-efef-4efe-8efe-efefefefefef.webp`;

      existingFiles.add(chatPath);
      existingFiles.add(orphanPath);

      // Chat message in Tutor 1A thread
      await db.insert(chatMessagesTable).values({
        crecheId: creche1.id,
        tutorId: tutor1A.id,
        senderId: staff1A.id,
        content: 'Foto do passeio',
        mediaUrl: chatPath,
      });
    });

    it('Tutor 1A can download media from own Chat thread (200)', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/abababab-abab-4aba-8aba-abababababab.webp`)
        .set('Authorization', `Bearer ${tokenTutor1A}`);
      expect(res.status).toBe(200);
    });

    it('Tutor 1B CANNOT download media from Tutor 1A Chat thread (403)', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/abababab-abab-4aba-8aba-abababababab.webp`)
        .set('Authorization', `Bearer ${tokenTutor1B}`);
      expect(res.status).toBe(403);
    });

    it('Tutor 1A CANNOT download an unreferenced orphan object (403)', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/efefefef-efef-4efe-8efe-efefefefefef.webp`)
        .set('Authorization', `Bearer ${tokenTutor1A}`);
      expect(res.status).toBe(403);
    });
  });

  describe('6. Operational Role Access (Staff, Admin, Master)', () => {
    it('Staff 1A can download any media in Creche 1 (200)', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/11111111-1111-4111-8111-111111111111.webp`)
        .set('Authorization', `Bearer ${tokenStaff1A}`);
      expect(res.status).toBe(200);
    });

    it('Creche Admin 1A can download any media in Creche 1 (200)', async () => {
      const res = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/88888888-8888-4888-8888-888888888888.webp`)
        .set('Authorization', `Bearer ${tokenAdmin1A}`);
      expect(res.status).toBe(200);
    });

    it('Master Admin can download media from Creche 1 and Creche 2 (200)', async () => {
      const res1 = await request(app)
        .get(`/api/storage/objects/uploads/c${creche1.id}/11111111-1111-4111-8111-111111111111.webp`)
        .set('Authorization', `Bearer ${tokenMasterAdmin}`);
      expect(res1.status).toBe(200);

      const path2 = `/objects/uploads/c${creche2.id}/20202020-2020-4020-8020-202020202020.webp`;
      existingFiles.add(path2);
      const res2 = await request(app)
        .get(`/api/storage${path2}`)
        .set('Authorization', `Bearer ${tokenMasterAdmin}`);
      expect(res2.status).toBe(200);
    });
  });

  describe('7. Upload Scoping & Master Admin Target-Creche Validation', () => {
    it('Master Admin upload with valid ?crecheId produces target-creche scoped path', async () => {
      const res = await request(app)
        .post(`/api/storage/uploads/direct?crecheId=${creche1.id}`)
        .set('Authorization', `Bearer ${tokenMasterAdmin}`)
        .set('Content-Type', 'image/webp')
        .send(Buffer.from('fake-image-bytes'));
      expect(res.status).toBe(200);
      expect(res.body.objectPath).toMatch(new RegExp(`^/objects/uploads/c${creche1.id}/`));
    });

    it('Master Admin upload without ?crecheId is rejected (400)', async () => {
      const res = await request(app)
        .post('/api/storage/uploads/direct')
        .set('Authorization', `Bearer ${tokenMasterAdmin}`)
        .set('Content-Type', 'image/webp')
        .send(Buffer.from('fake-image-bytes'));
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('crecheId é obrigatório para upload por master_admin');
    });

    it('Master Admin upload with invalid/non-existent ?crecheId returns 404', async () => {
      const res = await request(app)
        .post('/api/storage/uploads/direct?crecheId=999999')
        .set('Authorization', `Bearer ${tokenMasterAdmin}`)
        .set('Content-Type', 'image/webp')
        .send(Buffer.from('fake-image-bytes'));
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Creche de destino não encontrada');
    });

    it('Non-Master user supplying ?crecheId cannot override assigned session creche', async () => {
      const res = await request(app)
        .post(`/api/storage/uploads/direct?crecheId=${creche2.id}`)
        .set('Authorization', `Bearer ${tokenStaff1A}`)
        .set('Content-Type', 'image/webp')
        .send(Buffer.from('fake-image-bytes'));
      expect(res.status).toBe(200);
      // Bound to Creche 1 (Staff 1A session), ignoring query override
      expect(res.body.objectPath).toMatch(new RegExp(`^/objects/uploads/c${creche1.id}/`));
    });
  });

  describe('8. Feed Media Validation & Injection Guards', () => {
    it('Publishing Feed post in Creche 1 with Creche 2 media is rejected (400)', async () => {
      const creche2Path = `/objects/uploads/c${creche2.id}/20202020-2020-4020-8020-202020202020.webp`;
      existingFiles.add(creche2Path);

      const res = await request(app)
        .post(`/api/creches/${creche1.id}/feed`)
        .set('Authorization', `Bearer ${tokenStaff1A}`)
        .send({
          type: 'photo',
          content: 'Illegal cross-tenant media feed post',
          mediaUrl: creche2Path,
          mediaType: 'photo',
          petIds: [pet1A.id],
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('URL de mídia inválida para esta creche');
    });

    it('Publishing Feed post with malformed media path is rejected (400)', async () => {
      const res = await request(app)
        .post(`/api/creches/${creche1.id}/feed`)
        .set('Authorization', `Bearer ${tokenStaff1A}`)
        .send({
          type: 'photo',
          content: 'Malformed media path',
          mediaUrl: `/objects/uploads/c${creche1.id}/not-a-valid-uuid.webp`,
          mediaType: 'photo',
          petIds: [pet1A.id],
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('URL de mídia inválida para esta creche');
    });

    it('Publishing Feed post with nonexistent backing storage object is rejected (400)', async () => {
      const nonexistentPath = `/objects/uploads/c${creche1.id}/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp`;
      // Ensure file is NOT in existingFiles
      existingFiles.delete(nonexistentPath);

      const res = await request(app)
        .post(`/api/creches/${creche1.id}/feed`)
        .set('Authorization', `Bearer ${tokenStaff1A}`)
        .send({
          type: 'photo',
          content: 'Nonexistent backing object',
          mediaUrl: nonexistentPath,
          mediaType: 'photo',
          petIds: [pet1A.id],
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Arquivo de mídia não encontrado no armazenamento');
    });

    it('Publishing Feed post with valid same-creche existing media succeeds (201)', async () => {
      const validPath = `/objects/uploads/c${creche1.id}/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp`;
      existingFiles.add(validPath);

      const res = await request(app)
        .post(`/api/creches/${creche1.id}/feed`)
        .set('Authorization', `Bearer ${tokenStaff1A}`)
        .send({
          type: 'photo',
          content: 'Valid feed post',
          mediaUrl: validPath,
          mediaType: 'photo',
          petIds: [pet1A.id],
        });
      expect(res.status).toBe(201);
      expect(res.body.post.mediaItems[0].objectPath).toBe(validPath);
    });
  });

  describe('9. Feed N:N Precedence over Legacy pet_id (R17F.1 Micro-Gate)', () => {
    let inconsistentEventMedia: string;
    let legacyOnlyEventMedia: string;

    beforeAll(async () => {
      inconsistentEventMedia = `/objects/uploads/c${creche1.id}/f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0.webp`;
      legacyOnlyEventMedia   = `/objects/uploads/c${creche1.id}/f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1.webp`;

      existingFiles.add(inconsistentEventMedia);
      existingFiles.add(legacyOnlyEventMedia);

      // Inconsistent Event: petId = Pet 1A (Tutor 1A), but N:N relations = Pet 1B (Tutor 1B)
      const [evInconsistent] = await db.insert(timelineEventsTable).values({
        crecheId: creche1.id,
        authorId: staff1A.id,
        petId: pet1A.id, // Legacy owner: Tutor 1A
        type: 'photo',
        content: 'Inconsistent N:N vs legacy event',
        mediaUrl: inconsistentEventMedia,
        mediaType: 'photo',
      }).returning();

      // N:N relation points exclusively to Pet 1B (Tutor 1B)
      await db.insert(timelineEventPetsTable).values({
        eventId: evInconsistent.id,
        petId: pet1B.id,
      });

      // Legacy-only Event: petId = Pet 1A (Tutor 1A), ZERO rows in timeline_event_pets
      await db.insert(timelineEventsTable).values({
        crecheId: creche1.id,
        authorId: staff1A.id,
        petId: pet1A.id, // Legacy owner: Tutor 1A
        type: 'photo',
        content: 'Legacy-only event with zero N:N rows',
        mediaUrl: legacyOnlyEventMedia,
        mediaType: 'photo',
      });
    });

    it('Tutor A (stale legacy owner) CANNOT download media of event with N:N pointing to Tutor B (Bearer JWT -> 403)', async () => {
      const res = await request(app)
        .get(`/api/storage${inconsistentEventMedia}`)
        .set('Authorization', `Bearer ${tokenTutor1A}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Sem acesso a este arquivo');
    });

    it('Tutor A (stale legacy owner) CANNOT download media of event with N:N pointing to Tutor B (?mt= MediaToken -> 403)', async () => {
      const res = await request(app)
        .get(`/api/storage${inconsistentEventMedia}?mt=${mediaTokenTutor1A}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Sem acesso a este arquivo');
    });

    it('Tutor B (active N:N owner) can download media of event despite stale legacy petId pointing to A (Bearer JWT -> 200)', async () => {
      const res = await request(app)
        .get(`/api/storage${inconsistentEventMedia}`)
        .set('Authorization', `Bearer ${tokenTutor1B}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/webp');
    });

    it('Tutor B (active N:N owner) can download media of event despite stale legacy petId pointing to A (?mt= MediaToken -> 200)', async () => {
      const res = await request(app)
        .get(`/api/storage${inconsistentEventMedia}?mt=${mediaTokenTutor1B}`);
      expect(res.status).toBe(200);
    });

    it('Tutor A can download legacy-only event media when zero N:N rows exist (Bearer JWT -> 200)', async () => {
      const res = await request(app)
        .get(`/api/storage${legacyOnlyEventMedia}`)
        .set('Authorization', `Bearer ${tokenTutor1A}`);
      expect(res.status).toBe(200);
    });

    it('Tutor A can download legacy-only event media when zero N:N rows exist (?mt= MediaToken -> 200)', async () => {
      const res = await request(app)
        .get(`/api/storage${legacyOnlyEventMedia}?mt=${mediaTokenTutor1A}`);
      expect(res.status).toBe(200);
    });

    it('Foreign Tutor B CANNOT download legacy-only event media owned by Tutor A (403)', async () => {
      const res = await request(app)
        .get(`/api/storage${legacyOnlyEventMedia}`)
        .set('Authorization', `Bearer ${tokenTutor1B}`);
      expect(res.status).toBe(403);

      const resMt = await request(app)
        .get(`/api/storage${legacyOnlyEventMedia}?mt=${mediaTokenTutor1B}`);
      expect(resMt.status).toBe(403);
    });
  });
});
