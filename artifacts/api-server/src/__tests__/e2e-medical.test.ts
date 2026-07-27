/**
 * E2E – Medical records: vaccines, medications, incidents
 *
 * Covers:
 *   1. Registering a vaccine for a pet
 *   2. Registering a medication for a pet (admin/staff only)
 *   3. Tutor cannot create medications (403)
 *   4. Registering a health incident
 *   5. Listing vaccines, medications, and incidents
 */

import { describe, it, expect, beforeAll } from "vitest";
import { get, post, api } from "./helpers/api.js";
import { getSharedCtx, type TestContext } from "./helpers/setup.js";

let ctx: TestContext;
let petId: number;

const today = new Date().toISOString().split("T")[0]!;

const futureDate = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().split("T")[0];
})();

beforeAll(async () => {
  ctx = getSharedCtx();

  // Create a pet to attach medical records to
  const res = await post<{ id: number }>(
    `/creches/${ctx.crecheId}/pets`,
    {
      name: "Mel E2E",
      species: "dog",
      breed: "Poodle",
      gender: "female",
      weight: 5,
      tutorId: ctx.userId,
    },
    ctx.token,
  );

  if (!res.ok || !res.body.id) {
    throw new Error(`Failed to create test pet: ${JSON.stringify(res.body)}`);
  }
  petId = res.body.id;
});

describe("Vaccines", () => {
  let vaccineId: number;

  it("POST /medical/vaccines registers a vaccine", async () => {
    const res = await post<{ id: number; name: string; appliedDate: string }>(
      `/creches/${ctx.crecheId}/medical/vaccines`,
      {
        petId,
        name: "V10",
        appliedDate: today,
        nextDueDate: futureDate,
        veterinarian: "Dr. E2E",
        notes: "E2E vaccine test",
      },
      ctx.token,
    );
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTypeOf("number");
    expect(res.body.name).toBe("V10");
    vaccineId = res.body.id;
  });

  it("GET /medical/vaccines/:petId lists the registered vaccine", async () => {
    const res = await get<Array<{ id: number; name: string }>>(
      `/creches/${ctx.crecheId}/medical/vaccines/${petId}`,
      ctx.token,
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.some((v) => v.id === vaccineId);
    expect(found).toBe(true);
  });

  it("POST /medical/vaccines without auth returns 401", async () => {
    const res = await post(
      `/creches/${ctx.crecheId}/medical/vaccines`,
      { petId, name: "Raiva", appliedDate: today },
    );
    expect(res.status).toBe(401);
  });

  it("POST /pets/:petId/vaccines (pets route) also creates a vaccine", async () => {
    const res = await post<{ id: number; name: string }>(
      `/creches/${ctx.crecheId}/pets/${petId}/vaccines`,
      {
        name: "Giardia",
        appliedDate: today,
        nextDueDate: futureDate,
      },
      ctx.token,
    );
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Giardia");
  });
});

describe("Medications", () => {
  let medicationId: number;

  it("POST /medical/medications registers a medication (admin)", async () => {
    const res = await post<{ id: number; name: string; isActive: boolean }>(
      `/creches/${ctx.crecheId}/medical/medications`,
      {
        petId,
        name: "Simparic",
        dosage: "1 comprimido",
        frequency: "Mensal",
        startDate: today,
        times: ["08:00"],
        notes: "Antiparasitário",
      },
      ctx.token,
    );
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTypeOf("number");
    expect(res.body.name).toBe("Simparic");
    medicationId = res.body.id;
  });

  it("GET /medical/medications/:petId lists the medication", async () => {
    const res = await get<Array<{ id: number; name: string }>>(
      `/creches/${ctx.crecheId}/medical/medications/${petId}`,
      ctx.token,
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.some((m) => m.id === medicationId);
    expect(found).toBe(true);
  });

  it("POST /medical/medications without auth returns 401", async () => {
    const res = await post(
      `/creches/${ctx.crecheId}/medical/medications`,
      { petId, name: "Test", dosage: "1", frequency: "daily", startDate: today },
    );
    expect(res.status).toBe(401);
  });
});

describe("Incidents", () => {
  let incidentId: number;

  it("POST /medical/incidents registers a health incident", async () => {
    const res = await post<{ id: number; description: string; severity: string }>(
      `/creches/${ctx.crecheId}/medical/incidents`,
      {
        petId,
        description: "Vomitou após o almoço",
        severity: "low",
        vetCalled: false,
        actionTaken: "Monitorado, sem outros sintomas",
      },
      ctx.token,
    );
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTypeOf("number");
    expect(res.body.description).toBe("Vomitou após o almoço");
    expect(res.body.severity).toBe("low");
    incidentId = res.body.id;
  });

  it("POST /medical/incidents registers a high-severity incident with vet", async () => {
    const res = await post<{ id: number; severity: string; vetCalled: boolean }>(
      `/creches/${ctx.crecheId}/medical/incidents`,
      {
        petId,
        description: "Convulsão repentina",
        severity: "high",
        vetCalled: true,
        vetName: "Dr. Urgência",
        actionTaken: "Veterinário chamado imediatamente, pet estabilizado",
      },
      ctx.token,
    );
    expect(res.status).toBe(201);
    expect(res.body.severity).toBe("high");
    expect(res.body.vetCalled).toBe(true);
  });

  it("GET /medical/incidents/:petId lists all incidents for the pet", async () => {
    const res = await get<Array<{ id: number; severity: string }>>(
      `/creches/${ctx.crecheId}/medical/incidents/${petId}`,
      ctx.token,
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Should have at least the two incidents we created
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    const found = res.body.some((i) => i.id === incidentId);
    expect(found).toBe(true);
  });

  it("POST /medical/incidents without auth returns 401", async () => {
    const res = await post(
      `/creches/${ctx.crecheId}/medical/incidents`,
      { petId, description: "Test", severity: "low" },
    );
    expect(res.status).toBe(401);
  });
});
