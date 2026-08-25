import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../artifacts/api-server/src/app.js';
import { db } from '@workspace/db';
import { usersTable, financialAuditLogsTable } from '@workspace/db/schema';
import { createTestCreche, createTestUser, generateTestToken } from '../helpers.js';
import { eq, and } from 'drizzle-orm';
import { decrypt } from '../../artifacts/api-server/src/lib/crypto.js';

describe('R13F: User Authorization & Security Integrity Suite', () => {
  let crecheA: any;
  let crecheB: any;

  let masterAdmin: any;
  let masterToken: string;

  let adminA: any;
  let adminTokenA: string;

  let adminA2: any;
  let adminTokenA2: string;

  let staffA: any;
  let staffTokenA: string;

  let tutorA1: any;
  let tutorTokenA1: string;

  let tutorA2: any;
  let tutorTokenA2: string;

  let adminB: any;
  let adminTokenB: string;

  let tutorB: any;
  let tutorTokenB: string;

  beforeAll(async () => {
    crecheA = await createTestCreche({ name: 'Creche Alpha R13' });
    crecheB = await createTestCreche({ name: 'Creche Beta R13' });

    masterAdmin = await createTestUser({ role: 'master_admin', crecheId: null as any, name: 'Master Global' });
    masterToken = generateTestToken(masterAdmin);

    adminA = await createTestUser({ role: 'creche_admin', crecheId: crecheA.id, name: 'Admin Creche A', cpf: '123.456.789-00' });
    adminTokenA = generateTestToken(adminA);

    adminA2 = await createTestUser({ role: 'creche_admin', crecheId: crecheA.id, name: 'Admin Creche A2', cpf: '555.666.777-88' });
    adminTokenA2 = generateTestToken(adminA2);

    staffA = await createTestUser({ role: 'staff', crecheId: crecheA.id, name: 'Staff Creche A', cpf: '222.333.444-55' });
    staffTokenA = generateTestToken(staffA);

    tutorA1 = await createTestUser({ role: 'tutor', crecheId: crecheA.id, name: 'Tutor A1', cpf: '333.444.555-66' });
    tutorTokenA1 = generateTestToken(tutorA1);

    tutorA2 = await createTestUser({ role: 'tutor', crecheId: crecheA.id, name: 'Tutor A2', cpf: '444.555.666-77' });
    tutorTokenA2 = generateTestToken(tutorA2);

    adminB = await createTestUser({ role: 'creche_admin', crecheId: crecheB.id, name: 'Admin Creche B', cpf: '888.888.888-88' });
    adminTokenB = generateTestToken(adminB);

    tutorB = await createTestUser({ role: 'tutor', crecheId: crecheB.id, name: 'Tutor B', cpf: '999.999.999-99' });
    tutorTokenB = generateTestToken(tutorB);
  }, 60000);

  describe('R13-05: GET /api/users/:userId Access Control & PII Protection', () => {
    it('allows tutor to view own profile with decrypted CPF', async () => {
      const res = await request(app)
        .get(`/api/users/${tutorA1.id}`)
        .set('Authorization', `Bearer ${tutorTokenA1}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(tutorA1.id);
      expect(res.body.name).toBe(tutorA1.name);
      expect(res.body.cpf).toBe('333.444.555-66');
    });

    it('blocks tutor from viewing another tutor in same creche (404)', async () => {
      const res = await request(app)
        .get(`/api/users/${tutorA2.id}`)
        .set('Authorization', `Bearer ${tutorTokenA1}`);

      expect(res.status).toBe(404);
    });

    it('blocks tutor from viewing user of another creche (404)', async () => {
      const res = await request(app)
        .get(`/api/users/${tutorB.id}`)
        .set('Authorization', `Bearer ${tutorTokenA1}`);

      expect(res.status).toBe(404);
    });

    it('allows staff to view same-creche tutor with masked CPF/phone', async () => {
      const res = await request(app)
        .get(`/api/users/${tutorA1.id}`)
        .set('Authorization', `Bearer ${staffTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(tutorA1.id);
      expect(res.body.name).toBe(tutorA1.name);
      expect(res.body.cpf).toBeNull();
      expect(res.body.phone).toBeNull();
    });

    it('blocks staff from viewing user of another creche (404)', async () => {
      const res = await request(app)
        .get(`/api/users/${tutorB.id}`)
        .set('Authorization', `Bearer ${staffTokenA}`);

      expect(res.status).toBe(404);
    });

    it('allows creche_admin to view same-creche user with decrypted CPF', async () => {
      const res = await request(app)
        .get(`/api/users/${tutorA1.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.cpf).toBe('333.444.555-66');
    });

    it('blocks creche_admin from viewing cross-tenant user (404) with zero PII leak', async () => {
      const res = await request(app)
        .get(`/api/users/${tutorB.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.name).toBeUndefined();
      expect(res.body.email).toBeUndefined();
      expect(res.body.cpf).toBeUndefined();
    });

    it('allows master_admin to view any user across creches', async () => {
      const res = await request(app)
        .get(`/api/users/${tutorB.id}`)
        .set('Authorization', `Bearer ${masterToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(tutorB.id);
      expect(res.body.cpf).toBe('999.999.999-99');
    });
  });

  describe('R13-06: GET /api/creches/:crecheId/tutors Directory Authorization', () => {
    it('blocks tutor from listing tutor directory (403 Forbidden)', async () => {
      const res = await request(app)
        .get(`/api/creches/${crecheA.id}/tutors`)
        .set('Authorization', `Bearer ${tutorTokenA1}`);

      expect(res.status).toBe(403);
    });

    it('allows staff to list tutor directory of own creche', async () => {
      const res = await request(app)
        .get(`/api/creches/${crecheA.id}/tutors`)
        .set('Authorization', `Bearer ${staffTokenA}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('allows creche_admin to list tutor directory of own creche', async () => {
      const res = await request(app)
        .get(`/api/creches/${crecheA.id}/tutors`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('allows master_admin to list tutor directory of target creche', async () => {
      const res = await request(app)
        .get(`/api/creches/${crecheA.id}/tutors`)
        .set('Authorization', `Bearer ${masterToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe('R13-02, R13-03, R13-04: PUT /api/users/:userId Privilege & Tenant Boundaries', () => {
    it('allows tutor to update own personal fields', async () => {
      const res = await request(app)
        .put(`/api/users/${tutorA1.id}`)
        .set('Authorization', `Bearer ${tutorTokenA1}`)
        .send({ name: 'Tutor A1 Updated' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Tutor A1 Updated');
    });

    it('ignores privileged fields (role, isActive, crecheId) when updated by self tutor', async () => {
      const res = await request(app)
        .put(`/api/users/${tutorA1.id}`)
        .set('Authorization', `Bearer ${tutorTokenA1}`)
        .send({ role: 'master_admin', isActive: false, crecheId: crecheB.id });

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('tutor');
      expect(res.body.isActive).toBe(true);
      expect(res.body.crecheId).toBe(crecheA.id);

      const [inDb] = await db.select().from(usersTable).where(eq(usersTable.id, tutorA1.id)).limit(1);
      expect(inDb.role).toBe('tutor');
      expect(inDb.isActive).toBe(true);
      expect(inDb.crecheId).toBe(crecheA.id);
    });

    it('blocks creche_admin from escalating own role to master_admin (403)', async () => {
      const res = await request(app)
        .put(`/api/users/${adminA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ role: 'master_admin' });

      expect(res.status).toBe(403);
      const [inDb] = await db.select().from(usersTable).where(eq(usersTable.id, adminA.id)).limit(1);
      expect(inDb.role).toBe('creche_admin');
    });

    it('blocks creche_admin from promoting a tutor to master_admin (403)', async () => {
      const res = await request(app)
        .put(`/api/users/${tutorA1.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ role: 'master_admin' });

      expect(res.status).toBe(403);
      const [inDb] = await db.select().from(usersTable).where(eq(usersTable.id, tutorA1.id)).limit(1);
      expect(inDb.role).toBe('tutor');
    });

    it('allows creche_admin to promote staff to creche_admin in own creche', async () => {
      const tempStaff = await createTestUser({ role: 'staff', crecheId: crecheA.id, name: 'Promote Staff' });
      const res = await request(app)
        .put(`/api/users/${tempStaff.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ role: 'creche_admin' });

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('creche_admin');
    });

    it('blocks creche_admin from mutating a user of another creche (404)', async () => {
      const res = await request(app)
        .put(`/api/users/${tutorB.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ name: 'Hacked Name', role: 'tutor' });

      expect(res.status).toBe(404);
      const [inDb] = await db.select().from(usersTable).where(eq(usersTable.id, tutorB.id)).limit(1);
      expect(inDb.name).toBe('Tutor B');
    });

    it('blocks creche_admin from resetting password of cross-tenant user (404)', async () => {
      const [before] = await db.select().from(usersTable).where(eq(usersTable.id, tutorB.id)).limit(1);

      const res = await request(app)
        .put(`/api/users/${tutorB.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ newPassword: 'NewPassword123!' });

      expect(res.status).toBe(404);

      const [after] = await db.select().from(usersTable).where(eq(usersTable.id, tutorB.id)).limit(1);
      expect(after.passwordHash).toBe(before.passwordHash);
    });

    it('blocks creche_admin from modifying a master_admin user (403)', async () => {
      const res = await request(app)
        .put(`/api/users/${masterAdmin.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ name: 'Hacked Master' });

      expect(res.status).toBe(403);
    });

    it('blocks creche_admin from resetting password of peer creche_admin in same creche (403)', async () => {
      const [before] = await db.select().from(usersTable).where(eq(usersTable.id, adminA2.id)).limit(1);

      const res = await request(app)
        .put(`/api/users/${adminA2.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ newPassword: 'TakeoverPassword123!' });

      expect(res.status).toBe(403);

      const [after] = await db.select().from(usersTable).where(eq(usersTable.id, adminA2.id)).limit(1);
      expect(after.passwordHash).toBe(before.passwordHash);
    });

    it('blocks creche_admin from demoting peer creche_admin to staff (403)', async () => {
      const res = await request(app)
        .put(`/api/users/${adminA2.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ role: 'staff' });

      expect(res.status).toBe(403);

      const [inDb] = await db.select().from(usersTable).where(eq(usersTable.id, adminA2.id)).limit(1);
      expect(inDb.role).toBe('creche_admin');
    });

    it('blocks creche_admin from demoting peer creche_admin to tutor (403)', async () => {
      const res = await request(app)
        .put(`/api/users/${adminA2.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ role: 'tutor' });

      expect(res.status).toBe(403);

      const [inDb] = await db.select().from(usersTable).where(eq(usersTable.id, adminA2.id)).limit(1);
      expect(inDb.role).toBe('creche_admin');
    });

    it('blocks creche_admin from changing isActive of peer creche_admin via PUT (403)', async () => {
      const res = await request(app)
        .put(`/api/users/${adminA2.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ isActive: false });

      expect(res.status).toBe(403);

      const [inDb] = await db.select().from(usersTable).where(eq(usersTable.id, adminA2.id)).limit(1);
      expect(inDb.isActive).toBe(true);
    });

    it('allows creche_admin to reset password of tutor in own creche (200)', async () => {
      const res = await request(app)
        .put(`/api/users/${tutorA1.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ newPassword: 'TutorNewPassword123!' });

      expect(res.status).toBe(200);
    });

    it('allows creche_admin to reset password of staff in own creche (200)', async () => {
      const res = await request(app)
        .put(`/api/users/${staffA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ newPassword: 'StaffNewPassword123!' });

      expect(res.status).toBe(200);
    });

    it('allows creche_admin to toggle isActive of tutor and staff in own creche (200)', async () => {
      const resTutor = await request(app)
        .put(`/api/users/${tutorA1.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ isActive: false });

      expect(resTutor.status).toBe(200);
      expect(resTutor.body.isActive).toBe(false);

      // Revert tutor
      await request(app)
        .put(`/api/users/${tutorA1.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ isActive: true });

      const resStaff = await request(app)
        .put(`/api/users/${staffA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ isActive: false });

      expect(resStaff.status).toBe(200);
      expect(resStaff.body.isActive).toBe(false);

      // Revert staff
      await request(app)
        .put(`/api/users/${staffA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ isActive: true });
    });
  });

  describe('R13-02: DELETE /api/users/:userId Deactivation Boundary', () => {
    it('blocks creche_admin from deactivating user of another creche (404)', async () => {
      const res = await request(app)
        .delete(`/api/users/${tutorB.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(res.status).toBe(404);

      const [inDb] = await db.select().from(usersTable).where(eq(usersTable.id, tutorB.id)).limit(1);
      expect(inDb.isActive).toBe(true);
    });

    it('blocks creche_admin from deactivating master_admin (403)', async () => {
      const res = await request(app)
        .delete(`/api/users/${masterAdmin.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(res.status).toBe(403);

      const [inDb] = await db.select().from(usersTable).where(eq(usersTable.id, masterAdmin.id)).limit(1);
      expect(inDb.isActive).toBe(true);
    });

    it('allows creche_admin to deactivate tutor in own creche', async () => {
      const res = await request(app)
        .delete(`/api/users/${tutorA2.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(res.status).toBe(200);

      const [inDb] = await db.select().from(usersTable).where(eq(usersTable.id, tutorA2.id)).limit(1);
      expect(inDb.isActive).toBe(false);
    });
  });

  describe('R13-01 & R13-07: POST /api/users/:tutorId/anonymize Self & Admin LGPD', () => {
    it('allows tutor to self-anonymize own account', async () => {
      const targetTutor = await createTestUser({ role: 'tutor', crecheId: crecheA.id, name: 'Self Anonymize Tutor' });
      const targetToken = generateTestToken(targetTutor);

      const res = await request(app)
        .post(`/api/users/${targetTutor.id}/anonymize`)
        .set('Authorization', `Bearer ${targetToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const [inDb] = await db.select().from(usersTable).where(eq(usersTable.id, targetTutor.id)).limit(1);
      expect(inDb.name).toBe(`Tutor Anonimizado #${targetTutor.id}`);
      expect(inDb.email).toBe(`anonimizado_${targetTutor.id}@arkpet.internal`);
      expect(inDb.cpf).toBeNull();
      expect(inDb.phone).toBeNull();
      expect(inDb.isActive).toBe(false);

      // Audit log was created
      const [audit] = await db.select().from(financialAuditLogsTable).where(and(
        eq(financialAuditLogsTable.referenceId, targetTutor.id),
        eq(financialAuditLogsTable.action, 'tutor_anonymize')
      )).limit(1);
      expect(audit).toBeDefined();
    });

    it('blocks tutor from anonymizing another tutor (403)', async () => {
      const res = await request(app)
        .post(`/api/users/${tutorA1.id}/anonymize`)
        .set('Authorization', `Bearer ${tutorTokenB}`);

      expect(res.status).toBe(403);
    });

    it('allows creche_admin to anonymize tutor in own creche', async () => {
      const targetTutor = await createTestUser({ role: 'tutor', crecheId: crecheA.id, name: 'Creche Admin Anonymize Tutor' });

      const res = await request(app)
        .post(`/api/users/${targetTutor.id}/anonymize`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(res.status).toBe(200);

      const [inDb] = await db.select().from(usersTable).where(eq(usersTable.id, targetTutor.id)).limit(1);
      expect(inDb.name).toBe(`Tutor Anonimizado #${targetTutor.id}`);
      expect(inDb.cpf).toBeNull();
    });

    it('blocks creche_admin from anonymizing tutor of another creche (403)', async () => {
      const res = await request(app)
        .post(`/api/users/${tutorB.id}/anonymize`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(res.status).toBe(403);
    });

    it('blocks anonymizing non-tutor users (staff/creche_admin) (400)', async () => {
      const res = await request(app)
        .post(`/api/users/${staffA.id}/anonymize`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Apenas tutores podem ser anonimizados');
    });
  });
});
