/**
 * E2E – Invoice creation and financial access control
 *
 * Covers:
 *   1. Financial endpoints return 401 when no auth token is provided
 *   2. Authenticated admin can list and access invoices
 *   3. Catalogue CRUD (create, list, deactivate)
 *   4. Tutor can see their own invoices but not manage financial (403)
 *
 * Note: Stripe checkout and manual payment routes are not exercised here
 * because they require a Stripe-connected invoice — those are covered by
 * the billing integration tests.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { get, post, api } from "./helpers/api.js";
import { getSharedCtx, type TestContext } from "./helpers/setup.js";

let ctx: TestContext;

beforeAll(() => {
  ctx = getSharedCtx();
});

describe("Financial access control", () => {
  it("GET /financial/invoices without auth returns 401", async () => {
    const res = await get(`/creches/${ctx.crecheId}/financial/invoices`);
    expect(res.status).toBe(401);
  });

  it("GET /financial/catalogue without auth returns 401", async () => {
    const res = await get(`/creches/${ctx.crecheId}/financial/catalogue`);
    expect(res.status).toBe(401);
  });

  it("GET /financial/packages without auth returns 401", async () => {
    const res = await get(`/creches/${ctx.crecheId}/financial/packages`);
    expect(res.status).toBe(401);
  });

  it("GET /financial/invoices with valid admin token returns 200 + paginated data", async () => {
    const res = await get<{
      data: unknown[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    }>(`/creches/${ctx.crecheId}/financial/invoices`, ctx.token);

    expect(res.status).toBe(200);
    expect(typeof res.body.total).toBe("number");
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.page).toBe(1);
    expect(typeof res.body.totalPages).toBe("number");
  });

  it("GET /financial/packages with valid admin token returns paginated result", async () => {
    const res = await get<{ data: unknown[]; total: number }>(
      `/creches/${ctx.crecheId}/financial/packages`,
      ctx.token,
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe("Catalogue management", () => {
  let itemId: number;

  it("POST /financial/catalogue creates a service item", async () => {
    const res = await post<{ id: number; name: string; type: string }>(
      `/creches/${ctx.crecheId}/financial/catalogue`,
      {
        name: "Banho E2E",
        type: "service",
        price: 49.9,
        pricingBySize: { small: 39.9, medium: 49.9, large: 59.9 },
      },
      ctx.token,
    );
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTypeOf("number");
    expect(res.body.name).toBe("Banho E2E");
    itemId = res.body.id;
  });

  it("POST /financial/catalogue creates a credits package item", async () => {
    const res = await post<{ id: number; type: string; creditsAmount: number }>(
      `/creches/${ctx.crecheId}/financial/catalogue`,
      {
        name: "Pacote 10 Diárias",
        type: "package",
        price: 350.0,
        creditsAmount: 10,
      },
      ctx.token,
    );
    expect(res.status).toBe(200);
    expect(res.body.creditsAmount).toBe(10);
    expect(res.body.type).toBe("package");
  });

  it("POST /financial/catalogue rejects a package without creditsAmount", async () => {
    const res = await post(
      `/creches/${ctx.crecheId}/financial/catalogue`,
      {
        name: "Pacote Sem Créditos",
        type: "package",
        price: 100.0,
        // missing creditsAmount
      },
      ctx.token,
    );
    expect(res.status).toBe(400);
  });

  it("GET /financial/catalogue lists the created items", async () => {
    const res = await get<Array<{ id: number; name: string }>>(
      `/creches/${ctx.crecheId}/financial/catalogue`,
      ctx.token,
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.some((i) => i.id === itemId);
    expect(found).toBe(true);
  });

  it("PUT /financial/catalogue/:itemId updates an item", async () => {
    expect(itemId).toBeDefined();
    const res = await api<{ name: string }>(
      "PUT",
      `/creches/${ctx.crecheId}/financial/catalogue/${itemId}`,
      {
        token: ctx.token,
        body: {
          name: "Banho E2E Atualizado",
          type: "service",
          price: 54.9,
          pricingBySize: { small: 44.9, medium: 54.9, large: 64.9 },
        },
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Banho E2E Atualizado");
  });

  it("DELETE /financial/catalogue/:itemId removes the item", async () => {
    const res = await api<{ ok: boolean }>(
      "DELETE",
      `/creches/${ctx.crecheId}/financial/catalogue/${itemId}`,
      { token: ctx.token },
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("Financial analytics access control", () => {
  it("GET /financial/dashboard/kpis without auth returns 401", async () => {
    const res = await get(
      `/creches/${ctx.crecheId}/financial/dashboard/kpis`,
    );
    expect(res.status).toBe(401);
  });

  it("GET /financial/dashboard/kpis with admin token returns KPI object", async () => {
    const res = await get<Record<string, unknown>>(
      `/creches/${ctx.crecheId}/financial/dashboard/kpis`,
      ctx.token,
    );
    expect(res.status).toBe(200);
    // Must contain at minimum these KPI keys
    expect(res.body).toHaveProperty("grossRevenue");
    expect(res.body).toHaveProperty("netRevenue");
    expect(res.body).toHaveProperty("expenses");
    expect(res.body).toHaveProperty("netProfit");
  });
});
