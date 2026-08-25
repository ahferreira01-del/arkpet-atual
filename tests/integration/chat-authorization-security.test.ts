import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../artifacts/api-server/src/app.js';
import { db } from '@workspace/db';
import {
  petsTable,
  usersTable,
  chatMessagesTable,
} from '@workspace/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import {
  createTestCreche,
  createTestUser,
  generateTestToken,
  cleanupTestData,
} from '../helpers';

describe('Chat Authorization, Target Tutor Integrity & Directional Read State (R16F)', () => {
  let creche1: any;
  let creche2: any;

  let tutor1A: any;
  let tutor1B: any;
  let tutor2A: any;
  let staff1A: any;
  let staff1B: any;
  let admin1A: any;
  let staff2A: any;
  let masterAdmin: any;

  let tokenTutor1A: string;
  let tokenTutor1B: string;
  let tokenTutor2A: string;
  let tokenStaff1A: string;
  let tokenStaff1B: string;
  let tokenAdmin1A: string;
  let tokenStaff2A: string;
  let tokenMasterAdmin: string;

  let pet1A: any;
  let pet1B: any;
  let pet2A: any;

  beforeAll(async () => {
    creche1 = await createTestCreche({ name: 'Chat Creche 1' });
    creche2 = await createTestCreche({ name: 'Chat Creche 2' });

    tutor1A = await createTestUser({ role: 'tutor', crecheId: creche1.id, name: 'Tutor 1A' });
    tutor1B = await createTestUser({ role: 'tutor', crecheId: creche1.id, name: 'Tutor 1B' });
    tutor2A = await createTestUser({ role: 'tutor', crecheId: creche2.id, name: 'Tutor 2A' });

    staff1A = await createTestUser({ role: 'staff', crecheId: creche1.id, name: 'Staff 1A' });
    staff1B = await createTestUser({ role: 'staff', crecheId: creche1.id, name: 'Staff 1B' });
    admin1A = await createTestUser({ role: 'creche_admin', crecheId: creche1.id, name: 'Admin 1A' });
    staff2A = await createTestUser({ role: 'staff', crecheId: creche2.id, name: 'Staff 2A' });
    masterAdmin = await createTestUser({ role: 'master_admin', crecheId: null, name: 'Master Admin' });

    tokenTutor1A = generateTestToken(tutor1A);
    tokenTutor1B = generateTestToken(tutor1B);
    tokenTutor2A = generateTestToken(tutor2A);
    tokenStaff1A = generateTestToken(staff1A);
    tokenStaff1B = generateTestToken(staff1B);
    tokenAdmin1A = generateTestToken(admin1A);
    tokenStaff2A = generateTestToken(staff2A);
    tokenMasterAdmin = generateTestToken(masterAdmin);

    const [p1A] = await db.insert(petsTable).values({
      name: 'Rex 1A',
      species: 'dog',
      crecheId: creche1.id,
      tutorId: tutor1A.id,
    }).returning();
    pet1A = p1A;

    const [p1B] = await db.insert(petsTable).values({
      name: 'Bob 1B',
      species: 'dog',
      crecheId: creche1.id,
      tutorId: tutor1B.id,
    }).returning();
    pet1B = p1B;

    const [p2A] = await db.insert(petsTable).values({
      name: 'Luna 2A',
      species: 'cat',
      crecheId: creche2.id,
      tutorId: tutor2A.id,
    }).returning();
    pet2A = p2A;
  }, 60000);

  afterAll(async () => {
    if (creche1) await cleanupTestData(creche1.id);
    if (creche2) await cleanupTestData(creche2.id);
  }, 60000);

  // ── 1. Tutor Authorization & Cross-Tutor Boundaries ───────────────────────
  describe('Tutor Authorization & Cross-Tutor Boundaries (SEC-R16-01, SEC-R16-02)', () => {
    it('allows Tutor to send message to their own thread (201 Created)', async () => {
      const res = await request(app)
        .post('/api/creches/' + creche1.id + '/chat')
        .set('Authorization', 'Bearer ' + tokenTutor1A)
        .send({ tutorId: tutor1A.id, content: 'Olá da tutora 1A' });

      expect(res.status).toBe(201);
      expect(res.body.tutorId).toBe(tutor1A.id);
      expect(res.body.senderId).toBe(tutor1A.id);
      expect(res.body.content).toBe('Olá da tutora 1A');
    });

    it('blocks Tutor from injecting message into foreign Tutor thread (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/creches/' + creche1.id + '/chat')
        .set('Authorization', 'Bearer ' + tokenTutor1A)
        .send({ tutorId: tutor1B.id, content: 'Mensagem forjada no chat 1B' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/não autorizado/i);

      // Verify zero DB insert
      const messages = await db
        .select()
        .from(chatMessagesTable)
        .where(
          and(
            eq(chatMessagesTable.crecheId, creche1.id),
            eq(chatMessagesTable.tutorId, tutor1B.id),
            eq(chatMessagesTable.content, 'Mensagem forjada no chat 1B')
          )
        );
      expect(messages.length).toBe(0);
    });

    it('blocks Tutor from marking read on foreign Tutor thread (403 Forbidden)', async () => {
      // First insert an unread message in Tutor 1B thread
      const [msg1B] = await db.insert(chatMessagesTable).values({
        crecheId: creche1.id,
        tutorId: tutor1B.id,
        senderId: staff1A.id,
        content: 'Mensagem da equipe para 1B',
      }).returning();

      const res = await request(app)
        .post('/api/creches/' + creche1.id + '/chat/mark-read')
        .set('Authorization', 'Bearer ' + tokenTutor1A)
        .send({ tutorId: tutor1B.id });

      expect(res.status).toBe(403);

      // Assert readAt is still null
      const [checkMsg] = await db
        .select()
        .from(chatMessagesTable)
        .where(eq(chatMessagesTable.id, msg1B.id));
      expect(checkMsg.readAt).toBeNull();
    });

    it('blocks Tutor from querying foreign thread messages via query param (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/chat?tutorId=' + tutor1B.id)
        .set('Authorization', 'Bearer ' + tokenTutor1A);

      expect(res.status).toBe(403);
    });

    it('allows Tutor to list their own messages without query param (200 OK)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/chat')
        .set('Authorization', 'Bearer ' + tokenTutor1A);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      for (const m of res.body) {
        expect(m.tutorId).toBe(tutor1A.id);
      }
    });
  });

  // ── 2. Staff / Admin / Master Target Tutor Validation ──────────────────────
  describe('Operational Roles Target Validation (SEC-R16-03, FUNC-R16-01)', () => {
    it('returns 400 Bad Request when Staff calls GET /chat without tutorId', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/chat')
        .set('Authorization', 'Bearer ' + tokenStaff1A);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/tutorId é obrigatório/i);
    });

    it('returns 400 Bad Request when Creche Admin calls GET /chat without tutorId', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/chat')
        .set('Authorization', 'Bearer ' + tokenAdmin1A);

      expect(res.status).toBe(400);
    });

    it('returns 400 Bad Request when Master Admin calls GET /chat without tutorId', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/chat')
        .set('Authorization', 'Bearer ' + tokenMasterAdmin);

      expect(res.status).toBe(400);
    });

    it('allows Staff to query valid Tutor in same creche (200 OK)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/chat?tutorId=' + tutor1A.id)
        .set('Authorization', 'Bearer ' + tokenStaff1A);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('returns 404 Not Found when Staff queries cross-tenant Tutor (Creche 2 Tutor)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/chat?tutorId=' + tutor2A.id)
        .set('Authorization', 'Bearer ' + tokenStaff1A);

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/não encontrado/i);
    });

    it('returns 404 Not Found when Staff targets a non-tutor user ID', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/chat?tutorId=' + staff1B.id)
        .set('Authorization', 'Bearer ' + tokenStaff1A);

      expect(res.status).toBe(404);
    });

    it('returns 404 Not Found when Staff targets non-existent user ID', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/chat?tutorId=999999')
        .set('Authorization', 'Bearer ' + tokenStaff1A);

      expect(res.status).toBe(404);
    });

    it('returns 404 Not Found when Staff sends message to cross-tenant Tutor', async () => {
      const res = await request(app)
        .post('/api/creches/' + creche1.id + '/chat')
        .set('Authorization', 'Bearer ' + tokenStaff1A)
        .send({ tutorId: tutor2A.id, content: 'Olá tutor da creche 2' });

      expect(res.status).toBe(404);
    });

    it('returns 404 Not Found when Staff sends message to non-tutor user', async () => {
      const res = await request(app)
        .post('/api/creches/' + creche1.id + '/chat')
        .set('Authorization', 'Bearer ' + tokenStaff1A)
        .send({ tutorId: staff1B.id, content: 'Mensagem para outro staff' });

      expect(res.status).toBe(404);
    });

    it('returns 404 Not Found when Staff marks read on cross-tenant Tutor', async () => {
      const res = await request(app)
        .post('/api/creches/' + creche1.id + '/chat/mark-read')
        .set('Authorization', 'Bearer ' + tokenStaff1A)
        .send({ tutorId: tutor2A.id });

      expect(res.status).toBe(404);
    });

    it('allows Master Admin to access target Tutor in correct target creche (200 OK)', async () => {
      const res1 = await request(app)
        .get('/api/creches/' + creche1.id + '/chat?tutorId=' + tutor1A.id)
        .set('Authorization', 'Bearer ' + tokenMasterAdmin);
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .get('/api/creches/' + creche2.id + '/chat?tutorId=' + tutor2A.id)
        .set('Authorization', 'Bearer ' + tokenMasterAdmin);
      expect(res2.status).toBe(200);
    });

    it('returns 404 Not Found when Master Admin targets Creche 1 with Tutor 2A (Creche 2)', async () => {
      const res = await request(app)
        .get('/api/creches/' + creche1.id + '/chat?tutorId=' + tutor2A.id)
        .set('Authorization', 'Bearer ' + tokenMasterAdmin);
      expect(res.status).toBe(404);
    });
  });

  // ── 3. Pet Context Scoping Validation (SEC-R16-04) ─────────────────────────
  describe('Pet Context Scoping Validation (SEC-R16-04)', () => {
    it('allows sending a message with a valid pet belonging to the target Tutor in same creche', async () => {
      const res = await request(app)
        .post('/api/creches/' + creche1.id + '/chat')
        .set('Authorization', 'Bearer ' + tokenStaff1A)
        .send({ tutorId: tutor1A.id, petId: pet1A.id, content: 'Rex 1A está bem' });

      expect(res.status).toBe(201);
      expect(res.body.petId).toBe(pet1A.id);
      expect(res.body.petName).toBe('Rex 1A');
    });

    it('rejects sending a message with a pet belonging to another tutor in same creche (400 Bad Request)', async () => {
      const res = await request(app)
        .post('/api/creches/' + creche1.id + '/chat')
        .set('Authorization', 'Bearer ' + tokenStaff1A)
        .send({ tutorId: tutor1A.id, petId: pet1B.id, content: 'Tentando vincular pet de outro tutor' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/pet inválido/i);

      // Verify zero DB insert
      const messages = await db
        .select()
        .from(chatMessagesTable)
        .where(
          and(
            eq(chatMessagesTable.crecheId, creche1.id),
            eq(chatMessagesTable.content, 'Tentando vincular pet de outro tutor')
          )
        );
      expect(messages.length).toBe(0);
    });

    it('rejects sending a message with a cross-tenant pet (400 Bad Request)', async () => {
      const res = await request(app)
        .post('/api/creches/' + creche1.id + '/chat')
        .set('Authorization', 'Bearer ' + tokenStaff1A)
        .send({ tutorId: tutor1A.id, petId: pet2A.id, content: 'Tentando vincular pet de outra creche' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/pet inválido/i);
    });

    it('rejects sending a message with a nonexistent petId (400 Bad Request)', async () => {
      const res = await request(app)
        .post('/api/creches/' + creche1.id + '/chat')
        .set('Authorization', 'Bearer ' + tokenStaff1A)
        .send({ tutorId: tutor1A.id, petId: 999999, content: 'Pet inexistente' });

      expect(res.status).toBe(400);
    });
  });

  // ── 4. Directional Read / Unread State & Team Shared Inbox (FUNC-R16-02) ───
  describe('Directional Read / Unread State & Team Shared Inbox (FUNC-R16-02)', () => {
    let testCreche: any;
    let tTutor: any;
    let tStaffA: any;
    let tStaffB: any;
    let tAdmin: any;

    let tTokenTutor: string;
    let tTokenStaffA: string;
    let tTokenStaffB: string;
    let tTokenAdmin: string;

    beforeAll(async () => {
      testCreche = await createTestCreche({ name: 'Directional Test Creche' });
      tTutor = await createTestUser({ role: 'tutor', crecheId: testCreche.id, name: 'Directional Tutor' });
      tStaffA = await createTestUser({ role: 'staff', crecheId: testCreche.id, name: 'Staff Alpha' });
      tStaffB = await createTestUser({ role: 'staff', crecheId: testCreche.id, name: 'Staff Beta' });
      tAdmin = await createTestUser({ role: 'creche_admin', crecheId: testCreche.id, name: 'Admin Alpha' });

      tTokenTutor = generateTestToken(tTutor);
      tTokenStaffA = generateTestToken(tStaffA);
      tTokenStaffB = generateTestToken(tStaffB);
      tTokenAdmin = generateTestToken(tAdmin);
    });

    afterAll(async () => {
      if (testCreche) await cleanupTestData(testCreche.id);
    });

    it('Directional Step 1: Tutor sends inbound message -> Team unread > 0, Tutor unread == 0', async () => {
      const resSend = await request(app)
        .post('/api/creches/' + testCreche.id + '/chat')
        .set('Authorization', 'Bearer ' + tTokenTutor)
        .send({ tutorId: tTutor.id, content: 'Mensagem inbound do tutor' });
      expect(resSend.status).toBe(201);

      // Staff A unread check
      const resStaffUnread = await request(app)
        .get('/api/creches/' + testCreche.id + '/chat/unread')
        .set('Authorization', 'Bearer ' + tTokenStaffA);
      expect(resStaffUnread.status).toBe(200);
      expect(resStaffUnread.body.total).toBe(1);
      expect(resStaffUnread.body.byTutor[tTutor.id]).toBe(1);

      // Staff A conversation list check
      const resStaffConv = await request(app)
        .get('/api/creches/' + testCreche.id + '/chat/conversations')
        .set('Authorization', 'Bearer ' + tTokenStaffA);
      expect(resStaffConv.status).toBe(200);
      const conv = resStaffConv.body.find((c: any) => c.tutorId === tTutor.id);
      expect(conv).toBeDefined();
      expect(conv.unread).toBe(1);

      // Tutor unread check (must be 0 for own outbound message!)
      const resTutorUnread = await request(app)
        .get('/api/creches/' + testCreche.id + '/chat/unread')
        .set('Authorization', 'Bearer ' + tTokenTutor);
      expect(resTutorUnread.status).toBe(200);
      expect(resTutorUnread.body.total).toBe(0);
    });

    it('Directional Step 2: Staff A acknowledges inbound message -> Team unread becomes 0 for ALL staff', async () => {
      const resMark = await request(app)
        .post('/api/creches/' + testCreche.id + '/chat/mark-read')
        .set('Authorization', 'Bearer ' + tTokenStaffA)
        .send({ tutorId: tTutor.id });
      expect(resMark.status).toBe(200);

      // Staff A unread is now 0
      const resStaffA = await request(app)
        .get('/api/creches/' + testCreche.id + '/chat/unread')
        .set('Authorization', 'Bearer ' + tTokenStaffA);
      expect(resStaffA.body.total).toBe(0);

      // Staff B unread is ALSO 0 (shared team inbox)
      const resStaffB = await request(app)
        .get('/api/creches/' + testCreche.id + '/chat/unread')
        .set('Authorization', 'Bearer ' + tTokenStaffB);
      expect(resStaffB.body.total).toBe(0);
    });

    it('Directional Step 3: Staff A sends outbound message to Tutor -> Tutor unread > 0, Peer Staff unread == 0', async () => {
      const resSend = await request(app)
        .post('/api/creches/' + testCreche.id + '/chat')
        .set('Authorization', 'Bearer ' + tTokenStaffA)
        .send({ tutorId: tTutor.id, content: 'Mensagem outbound da equipe' });
      expect(resSend.status).toBe(201);

      // Tutor unread must be 1
      const resTutorUnread = await request(app)
        .get('/api/creches/' + testCreche.id + '/chat/unread')
        .set('Authorization', 'Bearer ' + tTokenTutor);
      expect(resTutorUnread.body.total).toBe(1);
      expect(resTutorUnread.body.byTutor[tTutor.id]).toBe(1);

      // Peer Staff B unread MUST BE 0 (Staff A outbound message must NOT give Staff B a false unread!)
      const resStaffBUnread = await request(app)
        .get('/api/creches/' + testCreche.id + '/chat/unread')
        .set('Authorization', 'Bearer ' + tTokenStaffB);
      expect(resStaffBUnread.body.total).toBe(0);

      // Peer Staff B conversation list unread MUST BE 0
      const resStaffBConv = await request(app)
        .get('/api/creches/' + testCreche.id + '/chat/conversations')
        .set('Authorization', 'Bearer ' + tTokenStaffB);
      const conv = resStaffBConv.body.find((c: any) => c.tutorId === tTutor.id);
      expect(conv.unread).toBe(0);
    });

    it('Directional Step 4: Peer Staff B opens thread & calls mark-read -> Tutor unread REMAINS > 0 (NOT cleared)', async () => {
      // Staff B opens the thread
      const resMark = await request(app)
        .post('/api/creches/' + testCreche.id + '/chat/mark-read')
        .set('Authorization', 'Bearer ' + tTokenStaffB)
        .send({ tutorId: tTutor.id });
      expect(resMark.status).toBe(200);

      // Tutor unread MUST STILL BE 1!
      const resTutorUnread = await request(app)
        .get('/api/creches/' + testCreche.id + '/chat/unread')
        .set('Authorization', 'Bearer ' + tTokenTutor);
      expect(resTutorUnread.body.total).toBe(1);
      expect(resTutorUnread.body.byTutor[tTutor.id]).toBe(1);

      // Tutor conversation list unread MUST STILL BE 1!
      const resTutorConv = await request(app)
        .get('/api/creches/' + testCreche.id + '/chat/conversations')
        .set('Authorization', 'Bearer ' + tTokenTutor);
      const conv = resTutorConv.body.find((c: any) => c.tutorId === tTutor.id);
      expect(conv.unread).toBe(1);
    });

    it('Directional Step 5: Tutor opens thread & calls mark-read -> Tutor unread becomes 0', async () => {
      const resMark = await request(app)
        .post('/api/creches/' + testCreche.id + '/chat/mark-read')
        .set('Authorization', 'Bearer ' + tTokenTutor)
        .send({ tutorId: tTutor.id });
      expect(resMark.status).toBe(200);

      // Tutor unread is now 0
      const resTutorUnread = await request(app)
        .get('/api/creches/' + testCreche.id + '/chat/unread')
        .set('Authorization', 'Bearer ' + tTokenTutor);
      expect(resTutorUnread.body.total).toBe(0);
    });

    it('Directional Step 6: Multiple Staff outbound messages remain unread for Tutor when Admin opens thread', async () => {
      // Staff A sends msg 1
      await request(app)
        .post('/api/creches/' + testCreche.id + '/chat')
        .set('Authorization', 'Bearer ' + tTokenStaffA)
        .send({ tutorId: tTutor.id, content: 'Aviso 1 da equipe' });

      // Staff B sends msg 2
      await request(app)
        .post('/api/creches/' + testCreche.id + '/chat')
        .set('Authorization', 'Bearer ' + tTokenStaffB)
        .send({ tutorId: tTutor.id, content: 'Aviso 2 da equipe' });

      // Admin opens thread & executes mark-read
      await request(app)
        .post('/api/creches/' + testCreche.id + '/chat/mark-read')
        .set('Authorization', 'Bearer ' + tTokenAdmin)
        .send({ tutorId: tTutor.id });

      // Tutor unread MUST BE 2
      const resTutorUnread = await request(app)
        .get('/api/creches/' + testCreche.id + '/chat/unread')
        .set('Authorization', 'Bearer ' + tTokenTutor);
      expect(resTutorUnread.body.total).toBe(2);

      // Clean up by tutor mark-read
      await request(app)
        .post('/api/creches/' + testCreche.id + '/chat/mark-read')
        .set('Authorization', 'Bearer ' + tTokenTutor)
        .send({ tutorId: tTutor.id });

      const resTutorClean = await request(app)
        .get('/api/creches/' + testCreche.id + '/chat/unread')
        .set('Authorization', 'Bearer ' + tTokenTutor);
      expect(resTutorClean.body.total).toBe(0);
    });

    it('Consistency check: /chat/unread total equals sum of byTutor and matches conversation.unread', async () => {
      // Tutor sends 2 messages
      await request(app)
        .post('/api/creches/' + testCreche.id + '/chat')
        .set('Authorization', 'Bearer ' + tTokenTutor)
        .send({ tutorId: tTutor.id, content: 'Mensagem 1' });
      await request(app)
        .post('/api/creches/' + testCreche.id + '/chat')
        .set('Authorization', 'Bearer ' + tTokenTutor)
        .send({ tutorId: tTutor.id, content: 'Mensagem 2' });

      const resUnread = await request(app)
        .get('/api/creches/' + testCreche.id + '/chat/unread')
        .set('Authorization', 'Bearer ' + tTokenStaffA);
      expect(resUnread.status).toBe(200);

      const byTutorSum = Object.values(resUnread.body.byTutor as Record<string, number>).reduce((a, b) => a + b, 0);
      expect(resUnread.body.total).toBe(byTutorSum);

      const resConv = await request(app)
        .get('/api/creches/' + testCreche.id + '/chat/conversations')
        .set('Authorization', 'Bearer ' + tTokenStaffA);
      const conv = resConv.body.find((c: any) => c.tutorId === tTutor.id);
      expect(conv.unread).toBe(resUnread.body.byTutor[tTutor.id]);
    });
  });
});
