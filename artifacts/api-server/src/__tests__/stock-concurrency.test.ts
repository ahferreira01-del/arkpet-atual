/**
 * Stock concurrency & guard-rail tests
 *
 * Covers:
 *   1. Two simultaneous POS sales each requesting stock/2 units never produce
 *      negative stock — both succeed OR one is rejected cleanly with 400.
 *   2. A stock-adjustment with a delta that would push stock below zero is
 *      rejected with 400.
 *   3. A valid positive stock-adjustment succeeds and returns the updated item.
 *
 * These tests run against a live Postgres instance and rely on the row-level
 * locking implemented in financial.ts.
 */
import { randomUUID } from "crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@workspace/db";
import {
  catalogueItemsTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { post, api } from "./helpers/api.js";
import { getSharedCtx, type TestContext } from "./helpers/setup.js";

let ctx: TestContext;
/** The catalogue item created for all stock tests in this file */
let productItemId: number;
const INITIAL_STOCK = 10;

beforeAll(async () => {
  ctx = getSharedCtx();

  // Create a product with known stock directly via the API so it belongs to the
  // test creche and has the right crecheId on all related rows.
  const res = await post<{ id: number; stockQuantity: number }>(
    `/creches/${ctx.crecheId}/financial/catalogue`,
    {
      name: "Ração Premium Teste Concorrência",
      type: "product",
      price: 50.0,
      stockQuantity: INITIAL_STOCK,
      trackStock: true,
      minStockAlert: 2,
    },
    ctx.token,
  );

  if (!res.ok || !res.body.id) {
    throw new Error(
      `Failed to create test product: ${JSON.stringify(res.body)}`,
    );
  }
  productItemId = res.body.id;
});

// ---------------------------------------------------------------------------
// Helper: read the current stock directly from the DB (bypasses any cache)
// ---------------------------------------------------------------------------
async function readStock(itemId: number): Promise<number> {
  const [row] = await db
    .select({ stock: catalogueItemsTable.stockQuantity })
    .from(catalogueItemsTable)
    .where(
      and(
        eq(catalogueItemsTable.id, itemId),
        eq(catalogueItemsTable.crecheId, ctx.crecheId),
      ),
    )
    .limit(1);
  return row?.stock ?? -1;
}

// ---------------------------------------------------------------------------
// 1. Race: simultaneous POS sales on the same item
// ---------------------------------------------------------------------------
describe("Concurrent POS sales — stock cannot go negative", () => {
  it("two simultaneous sales each requesting half the stock: both succeed or one gets 400, stock ≥ 0", async () => {
    // Re-read current stock so the test is idempotent even if run multiple times
    const currentStock = await readStock(productItemId);
    const qty = Math.max(1, Math.floor(currentStock / 2));

    if (currentStock < 2) {
      // Not enough stock to run a meaningful race — skip safely
      console.warn(
        `[stock-concurrency] currentStock=${currentStock}, qty=${qty} — skipping concurrent sale test`,
      );
      return;
    }

    // Fire both requests simultaneously with distinct operation IDs
    const [resA, resB] = await Promise.all([
      post<{ invoice: { id: number } }>(
        `/creches/${ctx.crecheId}/financial/pos-sale`,
        {
          operationId: randomUUID(),
          items: [{ catalogueItemId: productItemId, quantity: qty }],
          paymentMethod: "cash",
        },
        ctx.token,
      ),
      post<{ invoice: { id: number } }>(
        `/creches/${ctx.crecheId}/financial/pos-sale`,
        {
          operationId: randomUUID(),
          items: [{ catalogueItemId: productItemId, quantity: qty }],
          paymentMethod: "cash",
        },
        ctx.token,
      ),
    ]);

    // At least one must succeed
    const statuses = [resA.status, resB.status];
    expect(statuses.some((s) => s === 201)).toBe(true);

    // Any failure must be a clean 400 (insufficient stock), never a 500
    for (const res of [resA, resB]) {
      if (!res.ok) {
        expect(res.status).toBe(400);
        // The error message must mention stock / estoque
        const errorMsg = (res.body as any)?.error ?? "";
        expect(errorMsg.toLowerCase()).toMatch(/estoque|stock/i);
      }
    }

    // Stock must not be negative
    const stockAfter = await readStock(productItemId);
    expect(stockAfter).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Stock-adjustment guard — negative delta that exceeds current stock
// ---------------------------------------------------------------------------
describe("Stock-adjustment — guard against negative stock", () => {
  it("POST /catalogue/:itemId/stock-adjustment with delta below current stock returns 400", async () => {
    const currentStock = await readStock(productItemId);

    // Request to remove more than available
    const delta = -(currentStock + 5);

    const res = await post<{ error: string }>(
      `/creches/${ctx.crecheId}/financial/catalogue/${productItemId}/stock-adjustment`,
      { delta, reason: "Test: overdraft attempt" },
      ctx.token,
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/estoque/i);
  });

  it("POST /catalogue/:itemId/stock-adjustment with delta = 0 returns 400 (schema validation)", async () => {
    const res = await post<{ error: string }>(
      `/creches/${ctx.crecheId}/financial/catalogue/${productItemId}/stock-adjustment`,
      { delta: 0, reason: "zero delta" },
      ctx.token,
    );

    expect(res.status).toBe(400);
  });

  it("POST /catalogue/:itemId/stock-adjustment with valid positive delta succeeds and increases stock", async () => {
    const stockBefore = await readStock(productItemId);
    const delta = 5;

    const res = await post<{ stockQuantity: number }>(
      `/creches/${ctx.crecheId}/financial/catalogue/${productItemId}/stock-adjustment`,
      { delta, reason: "Test: restock" },
      ctx.token,
    );

    expect(res.status).toBe(200);
    expect(res.body.stockQuantity).toBe(stockBefore + delta);

    // Confirm the DB reflects the change
    const stockAfter = await readStock(productItemId);
    expect(stockAfter).toBe(stockBefore + delta);
  });

  it("POST /catalogue/:itemId/stock-adjustment with valid negative delta (within stock) succeeds", async () => {
    const stockBefore = await readStock(productItemId);
    // Remove exactly 1 unit — always safe since previous test added 5
    const delta = -1;

    const res = await post<{ stockQuantity: number }>(
      `/creches/${ctx.crecheId}/financial/catalogue/${productItemId}/stock-adjustment`,
      { delta, reason: "Test: consume one unit" },
      ctx.token,
    );

    expect(res.status).toBe(200);
    expect(res.body.stockQuantity).toBe(stockBefore + delta);

    const stockAfter = await readStock(productItemId);
    expect(stockAfter).toBe(stockBefore + delta);
  });
});

// ---------------------------------------------------------------------------
// 3. Mixed race: POS sale vs stock-adjustment on the same item
// ---------------------------------------------------------------------------
describe("Mixed race — POS sale vs stock-adjustment on the same item", () => {
  it("concurrent POS sale + negative stock-adjustment: stock never goes negative, failures are 400 not 500", async () => {
    // Ensure there is enough stock to make this test meaningful.
    // Re-read current stock and top it up to at least 6 units so we have room
    // for one POS sale (qty=3) and one stock-adjustment (delta=-3).
    const stockBefore = await readStock(productItemId);
    const target = 6;
    if (stockBefore < target) {
      const topUp = target - stockBefore;
      const r = await post(
        `/creches/${ctx.crecheId}/financial/catalogue/${productItemId}/stock-adjustment`,
        { delta: topUp, reason: "Test setup: top-up for mixed race test" },
        ctx.token,
      );
      if (!r.ok) {
        throw new Error(`Top-up failed: ${JSON.stringify(r.body)}`);
      }
    }

    const stockAtStart = await readStock(productItemId);
    const saleQty = 3;
    const adjustDelta = -3;

    // Fire a POS sale and a negative stock-adjustment simultaneously
    const [saleRes, adjustRes] = await Promise.all([
      post<{ invoice: { id: number } } | { error: string }>(
        `/creches/${ctx.crecheId}/financial/pos-sale`,
        {
          operationId: randomUUID(),
          items: [{ catalogueItemId: productItemId, quantity: saleQty }],
          paymentMethod: "cash",
        },
        ctx.token,
      ),
      post<{ stockQuantity: number } | { error: string }>(
        `/creches/${ctx.crecheId}/financial/catalogue/${productItemId}/stock-adjustment`,
        { delta: adjustDelta, reason: "Test: concurrent drain" },
        ctx.token,
      ),
    ]);

    // At least one operation must succeed
    const statuses = [saleRes.status, adjustRes.status];
    expect(statuses.some((s) => s === 200 || s === 201)).toBe(true);

    // Any failure must be a controlled 400 (insufficient stock), never a 500
    for (const res of [saleRes, adjustRes]) {
      if (!res.ok) {
        expect(res.status).toBe(400);
        const errorMsg = (res.body as any)?.error ?? "";
        expect(errorMsg.toLowerCase()).toMatch(/estoque|stock/i);
      }
    }

    // Stock must never be negative after the race
    const stockAfter = await readStock(productItemId);
    expect(stockAfter).toBeGreaterThanOrEqual(0);

    // Sanity: stock must not exceed what it was before (no phantom additions)
    expect(stockAfter).toBeLessThanOrEqual(stockAtStart);
  });

  it("POS sale + stock-adjustment + another POS sale all at once: stock ≥ 0, no 5xx", async () => {
    // Top up to at least 9 units
    const stockBefore = await readStock(productItemId);
    const target = 9;
    if (stockBefore < target) {
      const topUp = target - stockBefore;
      await post(
        `/creches/${ctx.crecheId}/financial/catalogue/${productItemId}/stock-adjustment`,
        { delta: topUp, reason: "Test setup: top-up for 3-way race" },
        ctx.token,
      );
    }

    const stockAtStart = await readStock(productItemId);

    const [r1, r2, r3] = await Promise.all([
      post(
        `/creches/${ctx.crecheId}/financial/pos-sale`,
        {
          operationId: randomUUID(),
          items: [{ catalogueItemId: productItemId, quantity: 3 }],
          paymentMethod: "cash",
        },
        ctx.token,
      ),
      post(
        `/creches/${ctx.crecheId}/financial/catalogue/${productItemId}/stock-adjustment`,
        { delta: -3, reason: "Test: 3-way concurrent drain" },
        ctx.token,
      ),
      post(
        `/creches/${ctx.crecheId}/financial/pos-sale`,
        {
          operationId: randomUUID(),
          items: [{ catalogueItemId: productItemId, quantity: 3 }],
          paymentMethod: "cash",
        },
        ctx.token,
      ),
    ]);

    // At least one must succeed
    expect([r1.status, r2.status, r3.status].some((s) => s === 200 || s === 201)).toBe(true);

    // No 5xx responses allowed
    for (const r of [r1, r2, r3]) {
      expect(r.status).toBeLessThan(500);
      if (!r.ok) {
        expect(r.status).toBe(400);
      }
    }

    const stockAfter = await readStock(productItemId);
    expect(stockAfter).toBeGreaterThanOrEqual(0);
    expect(stockAfter).toBeLessThanOrEqual(stockAtStart);
  });
});

// ---------------------------------------------------------------------------
// 4. Stock-adjustment on unknown item returns 404
// ---------------------------------------------------------------------------
describe("Stock-adjustment — unknown item", () => {
  it("POST /catalogue/999999999/stock-adjustment returns 404", async () => {
    const res = await post<{ error: string }>(
      `/creches/${ctx.crecheId}/financial/catalogue/999999999/stock-adjustment`,
      { delta: 1, reason: "ghost item" },
      ctx.token,
    );

    expect(res.status).toBe(404);
  });
});
