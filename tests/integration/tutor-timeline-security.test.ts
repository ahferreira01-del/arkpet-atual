import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../artifacts/api-server/src/app.js';
import { db } from '@workspace/db';
import {
  petsTable,
  usersTable,
  timelineEventsTable,
  timelineEventPetsTable,
  timelineLikesTable,
} from '@workspace/db/schema';
import { eq } from 'drizzle-orm';
import {
  createTestCreche,
  createTestUser,
  generateTestToken,
  cleanupTestData,
} from '../helpers';

describe('Tutor Timeline Target Authorization & Unique Event Stabilization (R15F)', () => {
  let creche1: any;
  let creche2: any;

  let tutor1A: any; // owns pet1A1 and pet1A2
  let tutor1B: any; // owns pet1B
  let tutor2A: any; // owns pet2A in creche2
  let staff1: any;
  let admin1: any;
  let staff2: any;
  let masterAdmin: any;

  let tokenTutor1A: string;
  let tokenTutor1B: string;
  let tokenTutor2A: string;
  let tokenStaff1: string;
  let tokenAdmin1: string;
  let tokenStaff2: string;
  let tokenMasterAdmin: string;

  let pet1A1: any;
  let pet1A2: any;
  let pet1B: any;
  let pet2A: any;

  let eventSinglePet: any;
  let eventMultiOwn: any;
  let eventMultiOwnAndForeign: any;
  let eventOldest: any;
  let eventLegacyOnly: any;
  let eventCreche2: any;

  beforeAll(async () => {
    creche1 = await createTestCreche({ name: 'Timeline Creche Alpha' });
    creche2 = await createTestCreche({ name: 'Timeline Creche Beta' });

    tutor1A = await createTestUser({ role: 'tutor', crecheId: creche1.id, name: 'Tutor 1A' });
    tutor1B = await createTestUser({ role: 'tutor', crecheId: creche1.id, name: 'Tutor 1B' });
    tutor2A = await createTestUser({ role: 'tutor', crecheId: creche2.id, name: 'Tutor 2A' });
    staff1 = await createTestUser({ role: 'staff', crecheId: creche1.id, name: 'Staff 1' });
    admin1 = await createTestUser({ role: 'creche_admin', crecheId: creche1.id, name: 'Admin 1' });
    staff2 = await createTestUser({ role: 'staff', crecheId: creche2.id, name: 'Staff 2' });
    masterAdmin = await createTestUser({ role: 'master_admin', crecheId: null, name: 'Master Admin' });

    tokenTutor1A = generateTestToken(tutor1A);
    tokenTutor1B = generateTestToken(tutor1B);
    tokenTutor2A = generateTestToken(tutor2A);
    tokenStaff1 = generateTestToken(staff1);
    tokenAdmin1 = generateTestToken(admin1);
    tokenStaff2 = generateTestToken(staff2);
    tokenMasterAdmin = generateTestToken(masterAdmin);

    // Pets in Creche 1
    const [p1A1] = await db.insert(petsTable).values({
      name: 'Pet Alpha 1A1',
      species: 'dog',
      crecheId: creche1.id,
      tutorId: tutor1A.id,
      photoUrl: 'https://example.com/pet1a1.jpg',
    }).returning();
    pet1A1 = p1A1;

    const [p1A2] = await db.insert(petsTable).values({
      name: 'Pet Alpha 1A2',
      species: 'dog',
      crecheId: creche1.id,
      tutorId: tutor1A.id,
      photoUrl: 'https://example.com/pet1a2.jpg',
    }).returning();
    pet1A2 = p1A2;

    const [p1B] = await db.insert(petsTable).values({
      name: 'Pet Beta 1B',
      species: 'dog',
      crecheId: creche1.id,
      tutorId: tutor1B.id,
      photoUrl: 'https://example.com/pet1b.jpg',
    }).returning();
    pet1B = p1B;

    // Pet in Creche 2
    const [p2A] = await db.insert(petsTable).values({
      name: 'Pet Gamma 2A',
      species: 'dog',
      crecheId: creche2.id,
      tutorId: tutor2A.id,
    }).returning();
    pet2A = p2A;

    // 1. Oldest single-pet event (Tutor 1A)
    const [evOldest] = await db.insert(timelineEventsTable).values({
      crecheId: creche1.id,
      authorId: staff1.id,
      type: 'note',
      content: 'Evento mais antigo',
      createdAt: new Date('2026-08-01T10:00:00Z'),
    }).returning();
    await db.insert(timelineEventPetsTable).values({ eventId: evOldest.id, petId: pet1A1.id });
    eventOldest = evOldest;

    // 2. Single-pet event (Tutor 1A)
    const [evSingle] = await db.insert(timelineEventsTable).values({
      crecheId: creche1.id,
      authorId: staff1.id,
      type: 'feeding',
      content: 'Alimentacao do Pet 1A1',
      createdAt: new Date('2026-08-02T10:00:00Z'),
    }).returning();
    await db.insert(timelineEventPetsTable).values({ eventId: evSingle.id, petId: pet1A1.id });
    eventSinglePet = evSingle;

    // 3. Multi-own-pet event (Tutor 1A owns both Pet 1A1 and Pet 1A2)
    const [evMulti] = await db.insert(timelineEventsTable).values({
      crecheId: creche1.id,
      authorId: staff1.id,
      type: 'play',
      content: 'Brincadeira conjunta dos irmaos 1A1 e 1A2',
      createdAt: new Date('2026-08-03T10:00:00Z'),
    }).returning();
    await db.insert(timelineEventPetsTable).values([
      { eventId: evMulti.id, petId: pet1A1.id },
      { eventId: evMulti.id, petId: pet1A2.id },
    ]);
    await db.insert(timelineLikesTable).values({ eventId: evMulti.id, userId: tutor1A.id });
    eventMultiOwn = evMulti;

    // 4. Multi-own + Foreign pet event (Pet 1A1, Pet 1A2, and Pet 1B)
    const [evShared] = await db.insert(timelineEventsTable).values({
      crecheId: creche1.id,
      authorId: staff1.id,
      type: 'photo',
      content: 'Foto da turma toda brincando',
      mediaUrl: '/objects/creche1/photo-shared.jpg',
      mediaType: 'photo',
      createdAt: new Date('2026-08-04T10:00:00Z'),
    }).returning();
    await db.insert(timelineEventPetsTable).values([
      { eventId: evShared.id, petId: pet1A1.id },
      { eventId: evShared.id, petId: pet1A2.id },
      { eventId: evShared.id, petId: pet1B.id },
    ]);
    eventMultiOwnAndForeign = evShared;

    // 5. Legacy pet_id-only event (zero rows in timeline_event_pets)
    const [evLegacy] = await db.insert(timelineEventsTable).values({
      crecheId: creche1.id,
      petId: pet1A1.id,
      authorId: staff1.id,
      type: 'note',
      content: 'Evento legado com apenas pet_id',
      createdAt: new Date('2026-07-01T10:00:00Z'),
    }).returning();
    eventLegacyOnly = evLegacy;

    // 6. Event in Creche 2
    const [evCreche2] = await db.insert(timelineEventsTable).values({
      crecheId: creche2.id,
      authorId: staff2.id,
      type: 'note',
      content: 'Evento na Creche 2',
      createdAt: new Date('2026-08-05T10:00:00Z'),
    }).returning();
    await db.insert(timelineEventPetsTable).values({ eventId: evCreche2.id, petId: pet2A.id });
    eventCreche2 = evCreche2;
  }, 60000);

  afterAll(async () => {
    if (creche1) await cleanupTestData(creche1.id);
    if (creche2) await cleanupTestData(creche2.id);
  }, 60000);

  // ── 1. Target Tutor Authorization & Security (SEC-R15-01) ─────────────────
  describe('Target Tutor Authorization & Security (SEC-R15-01)', () => {
    it('allows Tutor to GET timeline without query param, returning own events (200 OK)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/tutor-timeline')
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('allows Tutor to explicitly pass own tutorId in query param (200 OK)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/tutor-timeline?tutorId=' + tutor1A.id)
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('blocks Tutor from passing foreign tutorId in same creche (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/tutor-timeline?tutorId=' + tutor1B.id)
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/não autorizado/i);
    });

    it('blocks Tutor from accessing another creche timeline URL (403 Forbidden via membership)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche2.id + '/tutor-timeline')
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(403);
    });

    it('returns 400 Bad Request when tutorId is invalid format', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/tutor-timeline?tutorId=abc')
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/inválido/i);
    });

    it('returns 400 Bad Request when Staff calls without tutorId', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/tutor-timeline')
        .set('Authorization', 'Bearer ' + tokenStaff1);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/tutorId é obrigatório/i);
    });

    it('allows Staff to inspect valid Tutor in same creche (200 OK)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/tutor-timeline?tutorId=' + tutor1A.id)
        .set('Authorization', 'Bearer ' + tokenStaff1);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('returns 404 Not Found when Staff queries Tutor belonging to another creche', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/tutor-timeline?tutorId=' + tutor2A.id)
        .set('Authorization', 'Bearer ' + tokenStaff1);
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/não encontrado/i);
    });

    it('returns 404 Not Found when Staff queries non-tutor user ID', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/tutor-timeline?tutorId=' + staff1.id)
        .set('Authorization', 'Bearer ' + tokenStaff1);
      expect(res.status).toBe(404);
    });

    it('returns 404 Not Found when Staff queries non-existent user ID', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/tutor-timeline?tutorId=999999')
        .set('Authorization', 'Bearer ' + tokenStaff1);
      expect(res.status).toBe(404);
    });

    it('allows Creche Admin to inspect valid Tutor in same creche (200 OK)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/tutor-timeline?tutorId=' + tutor1A.id)
        .set('Authorization', 'Bearer ' + tokenAdmin1);
      expect(res.status).toBe(200);
    });

    it('returns 404 Not Found when Creche Admin queries Tutor of another creche', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/tutor-timeline?tutorId=' + tutor2A.id)
        .set('Authorization', 'Bearer ' + tokenAdmin1);
      expect(res.status).toBe(404);
    });

    it('allows Master Admin to inspect target Tutor with correct target creche URL (200 OK)', async () => {
      const res1 = await request(app)
        .get('/api/creches/' + creche1.id + '/tutor-timeline?tutorId=' + tutor1A.id)
        .set('Authorization', 'Bearer ' + tokenMasterAdmin);
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .get('/api/creches/' + creche2.id + '/tutor-timeline?tutorId=' + tutor2A.id)
        .set('Authorization', 'Bearer ' + tokenMasterAdmin);
      expect(res2.status).toBe(200);
    });

    it('returns 404 Not Found when Master Admin targets Creche 1 URL with Tutor 2A (Creche 2)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/tutor-timeline?tutorId=' + tutor2A.id)
        .set('Authorization', 'Bearer ' + tokenMasterAdmin);
      expect(res.status).toBe(404);
    });
  });

  // ── 2. Unique Event Representation & Multi-Pet Aggregation (FUNC-R15-01) ──
  describe('Unique Event Representation & Multi-Pet Aggregation (FUNC-R15-01)', () => {
    it('returns exactly 1 DTO for single-pet event with unchanged petName', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/tutor-timeline')
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(200);
      const ev = res.body.find((e: any) => e.id === eventSinglePet.id);
      expect(ev).toBeDefined();
      expect(ev.petName).toBe('Pet Alpha 1A1');
      expect(ev.petId).toBe(pet1A1.id);
      expect(ev.petPhotoUrl).toBe('https://example.com/pet1a1.jpg');
    });

    it('returns exactly 1 DTO for multi-own-pet event with aggregated pet names (Pet Alpha 1A1, Pet Alpha 1A2)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/tutor-timeline')
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(200);

      // Ensure only 1 entry exists for eventMultiOwn.id
      const matchingEvents = res.body.filter((e: any) => e.id === eventMultiOwn.id);
      expect(matchingEvents.length).toBe(1);

      const ev = matchingEvents[0];
      expect(ev.petName).toContain('Pet Alpha 1A1');
      expect(ev.petName).toContain('Pet Alpha 1A2');
      expect(ev.petName).toBe('Pet Alpha 1A1, Pet Alpha 1A2');
      expect(ev.petId).toBe(pet1A1.id);
      expect(ev.likeCount).toBe(1);
      expect(ev.isLikedByUser).toBe(true);
    });

    it('in multi-own + foreign event, aggregates only own pets for Tutor 1A (zero leak of Pet Beta 1B)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/tutor-timeline')
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(200);

      const matchingEvents = res.body.filter((e: any) => e.id === eventMultiOwnAndForeign.id);
      expect(matchingEvents.length).toBe(1);

      const ev = matchingEvents[0];
      expect(ev.petName).toBe('Pet Alpha 1A1, Pet Alpha 1A2');
      expect(ev.petName).not.toContain('Pet Beta 1B');
      expect(ev.mediaUrl).toBe('/objects/creche1/photo-shared.jpg');
    });

    it('in multi-own + foreign event, returns only Pet Beta 1B for Tutor 1B (zero leak of Tutor 1A pets)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/tutor-timeline')
        .set('Authorization', 'Bearer ' + tokenTutor1B);
      expect(res.status).toBe(200);

      const matchingEvents = res.body.filter((e: any) => e.id === eventMultiOwnAndForeign.id);
      expect(matchingEvents.length).toBe(1);

      const ev = matchingEvents[0];
      expect(ev.petName).toBe('Pet Beta 1B');
      expect(ev.petName).not.toContain('Pet Alpha');
    });

    it('guarantees all event.id entries in response array are completely unique', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/tutor-timeline')
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(200);

      const ids = res.body.map((e: any) => e.id);
      const uniqueIds = Array.from(new Set(ids));
      expect(ids.length).toBe(uniqueIds.length);
    });
  });

  // ── 3. Limit & Ordering Semantics ──────────────────────────────────────────
  describe('Limit & Ordering Semantics', () => {
    it('applies limit on UNIQUE events so a multi-pet event does not consume multiple limit slots', async () => {
      // Tutor 1A has 3 unique events: eventMultiOwnAndForeign (Aug 4), eventMultiOwn (Aug 3), eventSinglePet (Aug 2), eventOldest (Aug 1)
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/tutor-timeline?limit=2')
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);

      const ids = res.body.map((e: any) => e.id);
      expect(ids).toEqual([eventMultiOwnAndForeign.id, eventMultiOwn.id]);
    });

    it('sorts unique events in strict descending order of createdAt', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/tutor-timeline')
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(200);

      const dates = res.body.map((e: any) => new Date(e.createdAt).getTime());
      for (let i = 0; i < dates.length - 1; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i + 1]);
      }
    });
  });

  // ── 4. Deferred Legacy Fallback Verification ───────────────────────────────
  describe('Deferred Legacy Fallback Verification', () => {
    it('confirms pet_id-only event without N:N rows is omitted from Tutor Timeline list', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/tutor-timeline')
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(200);

      const legacyEvent = res.body.find((e: any) => e.id === eventLegacyOnly.id);
      expect(legacyEvent).toBeUndefined();
    });
  });
});