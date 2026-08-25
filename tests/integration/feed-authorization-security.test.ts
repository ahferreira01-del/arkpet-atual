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
  timelineViewsTable,
  timelineCommentsTable,
} from '@workspace/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  createTestCreche,
  createTestUser,
  generateTestToken,
  cleanupTestData,
} from '../helpers';

describe('Feed V2 Authorization, Tenant Isolation & Object Security (R14F)', () => {
  let creche1: any;
  let creche2: any;

  let tutor1A: any;
  let tutor1B: any;
  let tutor1C: any;
  let tutor2A: any;
  let staff1: any;
  let staff1Other: any;
  let admin1: any;
  let staff2: any;
  let masterAdmin: any;

  let tokenTutor1A: string;
  let tokenTutor1B: string;
  let tokenTutor1C: string;
  let tokenTutor2A: string;
  let tokenStaff1: string;
  let tokenStaff1Other: string;
  let tokenAdmin1: string;
  let tokenStaff2: string;
  let tokenMasterAdmin: string;

  let pet1A: any;
  let pet1B: any;
  let pet1C: any;
  let pet2A: any;

  let postPet1A: any;
  let postPet1B: any;
  let postShared: any;
  let postLegacyOwn: any;
  let postInconsistent: any; // N:N has Pet 1B (Tutor 1B), legacy petId has Pet 1A (Tutor 1A)
  let postNoPet: any;
  let postCreche2: any;

  beforeAll(async () => {
    creche1 = await createTestCreche({ name: 'Feed Creche Alpha' });
    creche2 = await createTestCreche({ name: 'Feed Creche Beta' });

    tutor1A = await createTestUser({ role: 'tutor', crecheId: creche1.id, name: 'Tutor 1A' });
    tutor1B = await createTestUser({ role: 'tutor', crecheId: creche1.id, name: 'Tutor 1B' });
    tutor1C = await createTestUser({ role: 'tutor', crecheId: creche1.id, name: 'Tutor 1C' });
    tutor2A = await createTestUser({ role: 'tutor', crecheId: creche2.id, name: 'Tutor 2A' });
    staff1 = await createTestUser({ role: 'staff', crecheId: creche1.id, name: 'Staff 1' });
    staff1Other = await createTestUser({ role: 'staff', crecheId: creche1.id, name: 'Staff 1 Other' });
    admin1 = await createTestUser({ role: 'creche_admin', crecheId: creche1.id, name: 'Admin 1' });
    staff2 = await createTestUser({ role: 'staff', crecheId: creche2.id, name: 'Staff 2' });
    masterAdmin = await createTestUser({ role: 'master_admin', crecheId: null, name: 'Master Admin' });

    tokenTutor1A = generateTestToken(tutor1A);
    tokenTutor1B = generateTestToken(tutor1B);
    tokenTutor1C = generateTestToken(tutor1C);
    tokenTutor2A = generateTestToken(tutor2A);
    tokenStaff1 = generateTestToken(staff1);
    tokenStaff1Other = generateTestToken(staff1Other);
    tokenAdmin1 = generateTestToken(admin1);
    tokenStaff2 = generateTestToken(staff2);
    tokenMasterAdmin = generateTestToken(masterAdmin);

    const [p1A] = await db.insert(petsTable).values({
      name: 'Pet Alpha 1',
      species: 'dog',
      crecheId: creche1.id,
      tutorId: tutor1A.id,
    }).returning();
    pet1A = p1A;

    const [p1B] = await db.insert(petsTable).values({
      name: 'Pet Beta 1',
      species: 'dog',
      crecheId: creche1.id,
      tutorId: tutor1B.id,
    }).returning();
    pet1B = p1B;

    const [p1C] = await db.insert(petsTable).values({
      name: 'Pet Charlie 1',
      species: 'dog',
      crecheId: creche1.id,
      tutorId: tutor1C.id,
    }).returning();
    pet1C = p1C;

    const [p2A] = await db.insert(petsTable).values({
      name: 'Pet Delta 2',
      species: 'dog',
      crecheId: creche2.id,
      tutorId: tutor2A.id,
    }).returning();
    pet2A = p2A;

    // Post with Pet 1A
    const [ev1A] = await db.insert(timelineEventsTable).values({
      crecheId: creche1.id,
      authorId: staff1.id,
      type: 'note',
      content: 'Atualizacao do Pet 1A',
    }).returning();
    await db.insert(timelineEventPetsTable).values({ eventId: ev1A.id, petId: pet1A.id });
    postPet1A = ev1A;

    // Post with Pet 1B
    const [ev1B] = await db.insert(timelineEventsTable).values({
      crecheId: creche1.id,
      authorId: staff1.id,
      type: 'note',
      content: 'Atualizacao privada do Pet 1B',
    }).returning();
    await db.insert(timelineEventPetsTable).values({ eventId: ev1B.id, petId: pet1B.id });
    postPet1B = ev1B;

    // Shared post with Pet 1A + Pet 1B
    const [evShared] = await db.insert(timelineEventsTable).values({
      crecheId: creche1.id,
      authorId: staff1.id,
      type: 'play',
      content: 'Brincadeira conjunta Pet 1A e 1B',
    }).returning();
    await db.insert(timelineEventPetsTable).values([
      { eventId: evShared.id, petId: pet1A.id },
      { eventId: evShared.id, petId: pet1B.id },
    ]);
    postShared = evShared;

    // Legacy post with petId on timeline_events and NO N:N rows
    const [evLegacy] = await db.insert(timelineEventsTable).values({
      crecheId: creche1.id,
      petId: pet1A.id,
      authorId: staff1.id,
      type: 'note',
      content: 'Post legado do Pet 1A',
    }).returning();
    postLegacyOwn = evLegacy;

    // Inconsistent post: N:N has Pet 1B (Tutor 1B), but legacy event.petId is Pet 1A (Tutor 1A)
    const [evInconsistent] = await db.insert(timelineEventsTable).values({
      crecheId: creche1.id,
      petId: pet1A.id,
      authorId: staff1.id,
      type: 'note',
      content: 'Post inconsistente N:N vs legacy',
    }).returning();
    await db.insert(timelineEventPetsTable).values({ eventId: evInconsistent.id, petId: pet1B.id });
    postInconsistent = evInconsistent;

    // Post with no pets in Creche 1
    const [evNoPet] = await db.insert(timelineEventsTable).values({
      crecheId: creche1.id,
      authorId: staff1.id,
      type: 'note',
      content: 'Comunicado sem pets',
    }).returning();
    postNoPet = evNoPet;

    // Post in Creche 2
    const [ev2] = await db.insert(timelineEventsTable).values({
      crecheId: creche2.id,
      authorId: staff2.id,
      type: 'note',
      content: 'Post na Creche Beta',
    }).returning();
    await db.insert(timelineEventPetsTable).values({ eventId: ev2.id, petId: pet2A.id });
    postCreche2 = ev2;
  }, 60000);

  afterAll(async () => {
    if (creche1) await cleanupTestData(creche1.id);
    if (creche2) await cleanupTestData(creche2.id);
  }, 60000);

  // 1. Tenant Isolation via requireCrecheMembership (SEC-R14-01)
  describe('Tenant Isolation via requireCrecheMembership (SEC-R14-01)', () => {
    it('blocks Staff from listing feed of another creche (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche2.id + '/feed')
        .set('Authorization', 'Bearer ' + tokenStaff1);
      expect(res.status).toBe(403);
    });

    it('blocks Staff from creating post in another creche (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/creches/' + creche2.id + '/feed')
        .set('Authorization', 'Bearer ' + tokenStaff1)
        .send({ type: 'note', content: 'Invasao', petIds: [pet2A.id] });
      expect(res.status).toBe(403);
    });

    it('blocks Staff from editing post in another creche (403 Forbidden)', async () => {
      const res = await request(app)
        .patch('/api/creches/' + creche2.id + '/feed/' + postCreche2.id)
        .set('Authorization', 'Bearer ' + tokenStaff1)
        .send({ content: 'Edicao indevida' });
      expect(res.status).toBe(403);
    });

    it('blocks Staff from deleting post in another creche (403 Forbidden)', async () => {
      const res = await request(app)
        .delete('/api/creches/' + creche2.id + '/feed/' + postCreche2.id)
        .set('Authorization', 'Bearer ' + tokenStaff1);
      expect(res.status).toBe(403);

      const [stillExists] = await db
        .select()
        .from(timelineEventsTable)
        .where(eq(timelineEventsTable.id, postCreche2.id));
      expect(stillExists).toBeDefined();
    });

    it('allows Master Admin to access any creche feed (200 OK)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/feed')
        .set('Authorization', 'Bearer ' + tokenMasterAdmin);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.posts)).toBe(true);
    });
  });

  // 2. Pet Validation & Duplicate Pet Normalization (SEC-R14-02)
  describe('Post Creation Pet Tenant Validation & Duplicates (SEC-R14-02)', () => {
    it('allows Staff to create post with valid pets of the same creche (201 Created)', async () => {
      const res = await request(app)
        .post('/api/creches/' + creche1.id + '/feed')
        .set('Authorization', 'Bearer ' + tokenStaff1)
        .send({
          type: 'photo',
          content: 'Foto dos pets 1A e 1B',
          petIds: [pet1A.id, pet1B.id],
        });
      expect(res.status).toBe(201);
      expect(res.body.post).toBeDefined();
      expect(res.body.post.pets.length).toBe(2);
    });

    it('normalizes and deduplicates payload with repeated petIds ([10, 10, 11] -> 2 unique relations, 201 Created)', async () => {
      const res = await request(app)
        .post('/api/creches/' + creche1.id + '/feed')
        .set('Authorization', 'Bearer ' + tokenStaff1)
        .send({
          type: 'note',
          content: 'Teste duplicatas com múltiplos pets',
          petIds: [pet1A.id, pet1A.id, pet1B.id],
        });
      expect(res.status).toBe(201);
      const postId = res.body.post.id;

      const relations = await db
        .select()
        .from(timelineEventPetsTable)
        .where(eq(timelineEventPetsTable.eventId, postId));
      expect(relations.length).toBe(2);
      const petIdsInDb = relations.map((r) => r.petId).sort();
      expect(petIdsInDb).toEqual([pet1A.id, pet1B.id].sort());
    });

    it('rejects post creation if all petIds belong to another creche (400 Bad Request, zero DB records, zero push)', async () => {
      const initialEventsCount = (await db.select().from(timelineEventsTable)).length;
      const res = await request(app)
        .post('/api/creches/' + creche1.id + '/feed')
        .set('Authorization', 'Bearer ' + tokenStaff1)
        .send({
          type: 'note',
          content: 'Tentando marcar pet estrangeiro',
          petIds: [pet2A.id],
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/inválidos/i);
      const finalEventsCount = (await db.select().from(timelineEventsTable)).length;
      expect(finalEventsCount).toBe(initialEventsCount);
    });

    it('rejects post creation if mixed petIds contain even one foreign pet (400 Bad Request, zero DB records, zero push)', async () => {
      const initialEventsCount = (await db.select().from(timelineEventsTable)).length;
      const res = await request(app)
        .post('/api/creches/' + creche1.id + '/feed')
        .set('Authorization', 'Bearer ' + tokenStaff1)
        .send({
          type: 'note',
          content: 'Tentando misturar pet valido e estrangeiro',
          petIds: [pet1A.id, pet2A.id],
        });
      expect(res.status).toBe(400);
      const finalEventsCount = (await db.select().from(timelineEventsTable)).length;
      expect(finalEventsCount).toBe(initialEventsCount);
    });

    it('rejects post creation if petId does not exist (400 Bad Request, zero DB records, zero push)', async () => {
      const initialEventsCount = (await db.select().from(timelineEventsTable)).length;
      const res = await request(app)
        .post('/api/creches/' + creche1.id + '/feed')
        .set('Authorization', 'Bearer ' + tokenStaff1)
        .send({
          type: 'note',
          content: 'Pet inexistente',
          petIds: [999999],
        });
      expect(res.status).toBe(400);
      const finalEventsCount = (await db.select().from(timelineEventsTable)).length;
      expect(finalEventsCount).toBe(initialEventsCount);
    });

    it('blocks Tutor from creating posts (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/creches/' + creche1.id + '/feed')
        .set('Authorization', 'Bearer ' + tokenTutor1A)
        .send({
          type: 'note',
          content: 'Tutor tentando publicar',
          petIds: [pet1A.id],
        });
      expect(res.status).toBe(403);
    });
  });

  // 3. Tutor List Feed Audience
  describe('Tutor List Feed Audience', () => {
    it('returns only posts tagging the tutor own pets in GET /feed', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/feed')
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(200);
      const postIds = res.body.posts.map((p: any) => p.id);

      expect(postIds).toContain(postPet1A.id);
      expect(postIds).toContain(postShared.id);
      expect(postIds).not.toContain(postPet1B.id);
      expect(postIds).not.toContain(postNoPet.id);
    });

    it('in shared multi-pet posts, filters the pets list in feed card to show only tutor own pets', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/feed')
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(200);
      const sharedPost = res.body.posts.find((p: any) => p.id === postShared.id);
      expect(sharedPost).toBeDefined();
      expect(sharedPost.pets.length).toBe(1);
      expect(sharedPost.pets[0].petId).toBe(pet1A.id);
    });
  });

  // 4. Direct GET /:id Object Authorization & N:N Precedence (SEC-R14-04)
  describe('Direct GET /:id Object Authorization & N:N Precedence (SEC-R14-04)', () => {
    it('allows Tutor to GET direct details of post tagging their own pet (200 OK)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/feed/' + postPet1A.id)
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(postPet1A.id);
    });

    it('blocks Tutor from GET direct details of foreign pet post in same creche (404 Not Found)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/feed/' + postPet1B.id)
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/não encontrado/i);
    });

    it('allows Tutor A to GET shared post returning ONLY Pet A details (zero leak of Pet B)', async () => {
      const resA = await request(app)
        .get('/api/creches/' + creche1.id + '/feed/' + postShared.id)
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(resA.status).toBe(200);
      expect(resA.body.pets.length).toBe(1);
      expect(resA.body.pets[0].petId).toBe(pet1A.id);
      expect(resA.body.pets[0].petName).toBe('Pet Alpha 1');
    });

    it('allows Tutor B to GET shared post returning ONLY Pet B details (zero leak of Pet A)', async () => {
      const resB = await request(app)
        .get('/api/creches/' + creche1.id + '/feed/' + postShared.id)
        .set('Authorization', 'Bearer ' + tokenTutor1B);
      expect(resB.status).toBe(200);
      expect(resB.body.pets.length).toBe(1);
      expect(resB.body.pets[0].petId).toBe(pet1B.id);
      expect(resB.body.pets[0].petName).toBe('Pet Beta 1');
    });

    it('allows Staff to GET shared post returning full pet list (both Pet A and Pet B)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/feed/' + postShared.id)
        .set('Authorization', 'Bearer ' + tokenStaff1);
      expect(res.status).toBe(200);
      expect(res.body.pets.length).toBe(2);
      const petIds = res.body.pets.map((p: any) => p.petId).sort();
      expect(petIds).toEqual([pet1A.id, pet1B.id].sort());
    });

    it('allows Creche Admin to GET shared post returning full pet list', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/feed/' + postShared.id)
        .set('Authorization', 'Bearer ' + tokenAdmin1);
      expect(res.status).toBe(200);
      expect(res.body.pets.length).toBe(2);
    });

    it('blocks unrelated Tutor 1C from GET shared post (404 Not Found)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/feed/' + postShared.id)
        .set('Authorization', 'Bearer ' + tokenTutor1C);
      expect(res.status).toBe(404);
    });

    // N:N Precedence over Legacy Rule
    it('proves N:N precedence: when N:N relations exist, legacy event.petId cannot expand audience (Tutor B=200, Tutor A=404)', async () => {
      // Event has N:N = Pet 1B (Tutor 1B), but legacy petId = Pet 1A (Tutor 1A)
      const resTutorB = await request(app)
        .get('/api/creches/' + creche1.id + '/feed/' + postInconsistent.id)
        .set('Authorization', 'Bearer ' + tokenTutor1B);
      expect(resTutorB.status).toBe(200);

      const resTutorA = await request(app)
        .get('/api/creches/' + creche1.id + '/feed/' + postInconsistent.id)
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(resTutorA.status).toBe(404);
    });

    // Legacy Fallback (Zero N:N)
    it('allows own Tutor to GET legacy post with single petId when zero N:N relations exist (200 OK)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/feed/' + postLegacyOwn.id)
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(postLegacyOwn.id);
    });

    it('blocks foreign Tutor from GET legacy post (404 Not Found)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/feed/' + postLegacyOwn.id)
        .set('Authorization', 'Bearer ' + tokenTutor1B);
      expect(res.status).toBe(404);
    });

    // No Pet Post
    it('blocks Tutor from GET post with no pets (404 Not Found)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/feed/' + postNoPet.id)
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(404);
    });

    it('allows Staff and Creche Admin to GET post with no pets in same creche (200 OK)', async () => {
      const resStaff = await request(app)
        .get('/api/creches/' + creche1.id + '/feed/' + postNoPet.id)
        .set('Authorization', 'Bearer ' + tokenStaff1);
      expect(resStaff.status).toBe(200);

      const resAdmin = await request(app)
        .get('/api/creches/' + creche1.id + '/feed/' + postNoPet.id)
        .set('Authorization', 'Bearer ' + tokenAdmin1);
      expect(resAdmin.status).toBe(200);
    });
  });

  // 5. Master Admin Target Creche Validation (SEC-R14-01 & Object Authorization)
  describe('Master Admin Target Creche Validation', () => {
    it('returns 404 when master_admin requests Event B through wrong target URL Creche A', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/feed/' + postCreche2.id)
        .set('Authorization', 'Bearer ' + tokenMasterAdmin);
      expect(res.status).toBe(404);
    });

    it('returns 200 when master_admin requests Event B through correct target URL Creche B', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche2.id + '/feed/' + postCreche2.id)
        .set('Authorization', 'Bearer ' + tokenMasterAdmin);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(postCreche2.id);
    });

    it('returns 404 when master_admin attempts interaction on Event B through wrong target URL Creche A', async () => {
      const resLike = await request(app)
        .post('/api/creches/' + creche1.id + '/feed/' + postCreche2.id + '/like')
        .set('Authorization', 'Bearer ' + tokenMasterAdmin);
      expect(resLike.status).toBe(404);

      const resComment = await request(app)
        .get('/api/creches/' + creche1.id + '/feed/' + postCreche2.id + '/comments')
        .set('Authorization', 'Bearer ' + tokenMasterAdmin);
      expect(resComment.status).toBe(404);
    });

    it('returns 200 when master_admin performs interaction on Event B through correct target URL Creche B', async () => {
      const resLike = await request(app)
        .post('/api/creches/' + creche2.id + '/feed/' + postCreche2.id + '/like')
        .set('Authorization', 'Bearer ' + tokenMasterAdmin);
      expect(resLike.status).toBe(200);
      expect(resLike.body.liked).toBe(true);
    });
  });

  // 6. Object Authorization on Interactions (SEC-R14-03)
  describe('Interactions Object Authorization (SEC-R14-03)', () => {
    // Likes
    it('allows Tutor to like own post (200 OK)', async () => {
      const res = await request(app)
        .post('/api/creches/' + creche1.id + '/feed/' + postPet1A.id + '/like')
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(200);
      expect(res.body.liked).toBe(true);
      expect(res.body.likeCount).toBe(1);

      const resToggle = await request(app)
        .post('/api/creches/' + creche1.id + '/feed/' + postPet1A.id + '/like')
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(resToggle.status).toBe(200);
      expect(resToggle.body.liked).toBe(false);
    });

    it('blocks Tutor from liking foreign pet post (404 Not Found)', async () => {
      const res = await request(app)
        .post('/api/creches/' + creche1.id + '/feed/' + postPet1B.id + '/like')
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(404);

      const likes = await db
        .select()
        .from(timelineLikesTable)
        .where(eq(timelineLikesTable.eventId, postPet1B.id));
      expect(likes.length).toBe(0);
    });

    // Views
    it('allows Tutor to record view on own post (200 OK)', async () => {
      const res = await request(app)
        .post('/api/creches/' + creche1.id + '/feed/' + postPet1A.id + '/view')
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(200);
      expect(res.body.viewed).toBe(true);
    });

    it('blocks Tutor from recording view on foreign pet post (404 Not Found)', async () => {
      const res = await request(app)
        .post('/api/creches/' + creche1.id + '/feed/' + postPet1B.id + '/view')
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(404);

      const views = await db
        .select()
        .from(timelineViewsTable)
        .where(eq(timelineViewsTable.eventId, postPet1B.id));
      expect(views.length).toBe(0);
    });

    // Comments
    it('allows Tutor to post and read comments on own post (201 Created / 200 OK)', async () => {
      const resPost = await request(app)
        .post('/api/creches/' + creche1.id + '/feed/' + postPet1A.id + '/comments')
        .set('Authorization', 'Bearer ' + tokenTutor1A)
        .send({ content: 'Que lindo o meu dog!' });
      expect(resPost.status).toBe(201);
      expect(resPost.body.comment.content).toBe('Que lindo o meu dog!');

      const resGet = await request(app)
        .get('/api/creches/' + creche1.id + '/feed/' + postPet1A.id + '/comments')
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(resGet.status).toBe(200);
      expect(resGet.body.length).toBe(1);
      expect(resGet.body[0].content).toBe('Que lindo o meu dog!');
    });

    it('blocks Tutor from reading comments on foreign pet post (404 Not Found)', async () => {
      await request(app)
        .post('/api/creches/' + creche1.id + '/feed/' + postPet1B.id + '/comments')
        .set('Authorization', 'Bearer ' + tokenStaff1)
        .send({ content: 'Comentario privado do Staff' });

      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/feed/' + postPet1B.id + '/comments')
        .set('Authorization', 'Bearer ' + tokenTutor1A);
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/não encontrada/i);
    });

    it('blocks Tutor from posting comments on foreign pet post (404 Not Found)', async () => {
      const res = await request(app)
        .post('/api/creches/' + creche1.id + '/feed/' + postPet1B.id + '/comments')
        .set('Authorization', 'Bearer ' + tokenTutor1A)
        .send({ content: 'Comentando no pet de outro tutor' });
      expect(res.status).toBe(404);
    });
  });

  // 7. Mutation & Moderation (PATCH / DELETE)
  describe('Patch & Delete Moderation Boundaries', () => {
    let postToEdit: any;
    let postToDelete: any;

    beforeAll(async () => {
      const [pE] = await db.insert(timelineEventsTable).values({
        crecheId: creche1.id,
        authorId: staff1.id,
        type: 'note',
        content: 'Legenda original',
      }).returning();
      await db.insert(timelineEventPetsTable).values({ eventId: pE.id, petId: pet1A.id });
      postToEdit = pE;

      const [pD] = await db.insert(timelineEventsTable).values({
        crecheId: creche1.id,
        authorId: staff1.id,
        type: 'note',
        content: 'Post a ser deletado',
      }).returning();
      await db.insert(timelineEventPetsTable).values({ eventId: pD.id, petId: pet1A.id });
      await db.insert(timelineLikesTable).values({ eventId: pD.id, userId: tutor1A.id });
      await db.insert(timelineViewsTable).values({ eventId: pD.id, userId: tutor1A.id });
      await db.insert(timelineCommentsTable).values({ eventId: pD.id, userId: tutor1A.id, content: 'Bye' });
      postToDelete = pD;
    }, 60000);

    it('allows Author Staff to edit own caption (200 OK)', async () => {
      const res = await request(app)
        .patch('/api/creches/' + creche1.id + '/feed/' + postToEdit.id)
        .set('Authorization', 'Bearer ' + tokenStaff1)
        .send({ content: 'Legenda editada pelo autor' });
      expect(res.status).toBe(200);
      expect(res.body.content).toBe('Legenda editada pelo autor');
    });

    it('blocks another Staff from editing post they did not author (403 Forbidden)', async () => {
      const res = await request(app)
        .patch('/api/creches/' + creche1.id + '/feed/' + postToEdit.id)
        .set('Authorization', 'Bearer ' + tokenStaff1Other)
        .send({ content: 'Staff outro tentando editar' });
      expect(res.status).toBe(403);
    });

    it('allows Creche Admin to edit caption of any post in their creche (200 OK)', async () => {
      const res = await request(app)
        .patch('/api/creches/' + creche1.id + '/feed/' + postToEdit.id)
        .set('Authorization', 'Bearer ' + tokenAdmin1)
        .send({ content: 'Legenda moderada pelo Admin' });
      expect(res.status).toBe(200);
      expect(res.body.content).toBe('Legenda moderada pelo Admin');
    });

    it('blocks Tutor from editing caption (403 Forbidden)', async () => {
      const res = await request(app)
        .patch('/api/creches/' + creche1.id + '/feed/' + postToEdit.id)
        .set('Authorization', 'Bearer ' + tokenTutor1A)
        .send({ content: 'Tutor tentando editar' });
      expect(res.status).toBe(403);
    });

    it('allows Staff to delete post in own creche and cleans up all cascaded relations', async () => {
      const res = await request(app)
        .delete('/api/creches/' + creche1.id + '/feed/' + postToDelete.id)
        .set('Authorization', 'Bearer ' + tokenStaff1);
      expect(res.status).toBe(200);

      const [ev] = await db.select().from(timelineEventsTable).where(eq(timelineEventsTable.id, postToDelete.id));
      expect(ev).toBeUndefined();

      const ep = await db.select().from(timelineEventPetsTable).where(eq(timelineEventPetsTable.eventId, postToDelete.id));
      expect(ep.length).toBe(0);

      const lk = await db.select().from(timelineLikesTable).where(eq(timelineLikesTable.eventId, postToDelete.id));
      expect(lk.length).toBe(0);

      const vw = await db.select().from(timelineViewsTable).where(eq(timelineViewsTable.eventId, postToDelete.id));
      expect(vw.length).toBe(0);

      const cm = await db.select().from(timelineCommentsTable).where(eq(timelineCommentsTable.eventId, postToDelete.id));
      expect(cm.length).toBe(0);
    });
  });
});