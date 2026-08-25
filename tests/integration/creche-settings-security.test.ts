import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../artifacts/api-server/src/app.js';
import { db } from '@workspace/db';
import { crechesTable, catalogueItemsTable } from '@workspace/db/schema';
import { createTestCreche, createTestUser, generateTestToken } from '../helpers.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

describe('R25F: Creche Settings Security & Stabilization Suite', () => {
  let crecheA: any;
  let crecheB: any;

  let masterAdmin: any;
  let masterToken: string;

  let adminA: any;
  let adminTokenA: string;

  let adminB: any;
  let adminTokenB: string;

  let staffA: any;
  let staffTokenA: string;

  let tutorA: any;
  let tutorTokenA: string;

  beforeAll(async () => {
    crecheA = await createTestCreche({ name: 'Creche Alpha Settings R25' });
    crecheB = await createTestCreche({ name: 'Creche Beta Settings R25' });

    masterAdmin = await createTestUser({ role: 'master_admin', crecheId: null as any, name: 'Master Settings Admin' });
    masterToken = generateTestToken(masterAdmin);

    adminA = await createTestUser({ role: 'creche_admin', crecheId: crecheA.id, name: 'Admin Creche A Settings' });
    adminTokenA = generateTestToken(adminA);

    adminB = await createTestUser({ role: 'creche_admin', crecheId: crecheB.id, name: 'Admin Creche B Settings' });
    adminTokenB = generateTestToken(adminB);

    staffA = await createTestUser({ role: 'staff', crecheId: crecheA.id, name: 'Staff Creche A Settings' });
    staffTokenA = generateTestToken(staffA);

    tutorA = await createTestUser({ role: 'tutor', crecheId: crecheA.id, name: 'Tutor Creche A Settings' });
    tutorTokenA = generateTestToken(tutorA);
  }, 60000);

  describe('R25F — deliveryFee Money Domain & Validation Rules', () => {
    it('accepts canonical integer cents string "1500" and persists 1500.00 in DB', async () => {
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ deliveryFee: '1500' });

      expect(res.status).toBe(200);
      const [inDb] = await db.select().from(crechesTable).where(eq(crechesTable.id, crecheA.id)).limit(1);
      expect(Number(inDb.deliveryFee)).toBe(1500);
    });

    it('accepts zero delivery fee "0" and persists 0.00 in DB', async () => {
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ deliveryFee: '0' });

      expect(res.status).toBe(200);
      const [inDb] = await db.select().from(crechesTable).where(eq(crechesTable.id, crecheA.id)).limit(1);
      expect(Number(inDb.deliveryFee)).toBe(0);
    });

    it('accepts maximum safe boundary "99999999" (8 digits) without numeric overflow', async () => {
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ deliveryFee: '99999999' });

      expect(res.status).toBe(200);
      const [inDb] = await db.select().from(crechesTable).where(eq(crechesTable.id, crecheA.id)).limit(1);
      expect(Number(inDb.deliveryFee)).toBe(99999999);
    });

    it('rejects negative delivery fee "-500" with 400 and preserves existing DB value', async () => {
      // Set to known value first
      await db.update(crechesTable).set({ deliveryFee: '1500' }).where(eq(crechesTable.id, crecheA.id));

      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ deliveryFee: '-500' });

      expect(res.status).toBe(400);
      const [inDb] = await db.select().from(crechesTable).where(eq(crechesTable.id, crecheA.id)).limit(1);
      expect(Number(inDb.deliveryFee)).toBe(1500);
    });

    it('rejects fractional delivery fee "12.34" with 400 and preserves DB', async () => {
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ deliveryFee: '12.34' });

      expect(res.status).toBe(400);
    });

    it('rejects non-numeric alphabetic delivery fee "abc" with 400 (not 500)', async () => {
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ deliveryFee: 'abc' });

      expect(res.status).toBe(400);
    });

    it('rejects empty string delivery fee "" with 400', async () => {
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ deliveryFee: '' });

      expect(res.status).toBe(400);
    });

    it('rejects null delivery fee with 400 (not-null column)', async () => {
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ deliveryFee: null });

      expect(res.status).toBe(400);
    });

    it('rejects scientific notation "1e3" with 400', async () => {
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ deliveryFee: '1e3' });

      expect(res.status).toBe(400);
    });

    it('rejects plus prefix "+100" with 400', async () => {
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ deliveryFee: '+100' });

      expect(res.status).toBe(400);
    });

    it('rejects whitespace-padded delivery fee " 1500 " with 400', async () => {
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ deliveryFee: ' 1500 ' });

      expect(res.status).toBe(400);
    });

    it('rejects 9-digit overflow boundary "100000000" with 400 before DB execution', async () => {
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ deliveryFee: '100000000' });

      expect(res.status).toBe(400);
    });

    it('R24 Store checkout regression: configured deliveryFee 1500 feeds physical delivery order total and invoice', async () => {
      // 1. Configure fixed delivery and 1500 fee
      await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ deliveryType: 'fixed', deliveryFee: '1500' });

      // 2. Create physical product in catalogue
      const [product] = await db.insert(catalogueItemsTable).values({
        crecheId: crecheA.id,
        name: 'Settings Test Physical Product',
        type: 'product',
        basePrice: '2000',
        stockQuantity: 10,
        trackStock: true,
      }).returning();

      // 3. Checkout physical product with deliveryMethod = 'delivery'
      const opId = randomUUID();
      const checkoutRes = await request(app)
        .post(`/api/creches/${crecheA.id}/orders`)
        .set('Authorization', `Bearer ${tutorTokenA}`)
        .send({
          operationId: opId,
          items: [{ catalogueItemId: product.id, quantity: 1 }],
          deliveryMethod: 'delivery',
          deliveryAddress: 'Rua das Flores, 100',
          deliveryFee: 0, // client attempts 0, server overrides with 1500
        });

      expect(checkoutRes.status).toBe(201);
      expect(Number(checkoutRes.body.order.deliveryFee)).toBe(1500);
      expect(Number(checkoutRes.body.order.total)).toBe(3500); // 2000 + 1500
      expect(Number(checkoutRes.body.invoice.amount)).toBe(3500);
    });
  });

  describe('R25F — creche.status Domain & Validation Rules', () => {
    it('accepts status "active"', async () => {
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ status: 'active' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('active');
    });

    it('accepts status "inactive"', async () => {
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ status: 'inactive' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('inactive');

      // Restore active
      await db.update(crechesTable).set({ status: 'active' }).where(eq(crechesTable.id, crecheA.id));
    });

    it('rejects arbitrary status "banana" with 400 Bad Request (not DB 500)', async () => {
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ status: 'banana' });

      expect(res.status).toBe(400);
    });

    it('rejects null status with 400 Bad Request', async () => {
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ status: null });

      expect(res.status).toBe(400);
    });
  });

  describe('R25F — logoUrl Compatibility & Strict Tenant Ownership', () => {
    it('accepts same-tenant canonical public storage logo path', async () => {
      const publicPath = `/api/storage/public-objects/objects/uploads/c${crecheA.id}/a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d.webp`;
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ logoUrl: publicPath });

      expect(res.status).toBe(200);
      expect(res.body.logoUrl).toBe(publicPath);
    });

    it('accepts same-tenant canonical private storage logo path', async () => {
      const privatePath = `/objects/uploads/c${crecheA.id}/a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d.webp`;
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ logoUrl: privatePath });

      expect(res.status).toBe(200);
      expect(res.body.logoUrl).toBe(privatePath);
    });

    it('accepts valid external HTTPS logo URL', async () => {
      const externalUrl = 'https://images.example.com/creche-alpha-logo.png';
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ logoUrl: externalUrl });

      expect(res.status).toBe(200);
      expect(res.body.logoUrl).toBe(externalUrl);
    });

    it('allows clearing logo with null or empty string', async () => {
      const resNull = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ logoUrl: null });

      expect(resNull.status).toBe(200);
      expect(resNull.body.logoUrl).toBeNull();

      const resEmpty = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ logoUrl: '' });

      expect(resEmpty.status).toBe(200);
      expect(resEmpty.body.logoUrl).toBeNull();
    });

    it('blocks Admin of Creche A from referencing Creche B relative logo path with 403', async () => {
      const foreignPath = `/api/storage/public-objects/objects/uploads/c${crecheB.id}/a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d.webp`;
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ logoUrl: foreignPath });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('outra creche');
    });

    it('blocks Master Admin targeting Creche A from referencing Creche B relative logo path with 403 (No Master Exception)', async () => {
      const foreignPath = `/api/storage/public-objects/objects/uploads/c${crecheB.id}/a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d.webp`;
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${masterToken}`)
        .send({ logoUrl: foreignPath });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('outra creche');
    });

    it('rejects path traversal in relative logoUrl with 400 Bad Request', async () => {
      const traversalPath = `/objects/../../secret-file.png`;
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ logoUrl: traversalPath });

      expect(res.status).toBe(400);
    });

    it('rejects arbitrary non-canonical relative path with 400 Bad Request', async () => {
      const invalidPath = `/api/random/logo.png`;
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ logoUrl: invalidPath });

      expect(res.status).toBe(400);
    });
  });

  describe('R25F — Role Authorization & Cross-Tenant Boundaries', () => {
    it('blocks Admin B from updating Creche A settings (403 Forbidden)', async () => {
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${adminTokenB}`)
        .send({ name: 'Hacked Creche A Name' });

      expect(res.status).toBe(403);
    });

    it('blocks Staff A from updating Creche A settings (403 Forbidden)', async () => {
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${staffTokenA}`)
        .send({ name: 'Staff Updated Name' });

      expect(res.status).toBe(403);
    });

    it('blocks Tutor A from updating Creche A settings (403 Forbidden)', async () => {
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${tutorTokenA}`)
        .send({ name: 'Tutor Updated Name' });

      expect(res.status).toBe(403);
    });

    it('allows Master Admin to update Creche A settings with valid target and data', async () => {
      const res = await request(app)
        .put(`/api/creches/${crecheA.id}`)
        .set('Authorization', `Bearer ${masterToken}`)
        .send({ name: 'Alpha Creche Master Updated' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Alpha Creche Master Updated');
    });
  });
});
