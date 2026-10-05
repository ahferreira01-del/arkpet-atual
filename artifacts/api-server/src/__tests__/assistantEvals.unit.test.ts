import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AssistantService } from "../assistant/assistant.service.js";
import type { AssistantSecurityContext, AssistantRole } from "../assistant/assistant.types.js";

process.env.AI_SAFE_ACTIONS_ENABLED = "true";
process.env.AI_OPERATIONAL_COPILOT_ENABLED = "true";

// Mock DB interactions for unit testing
vi.mock("@workspace/db", async (importOriginal) => {
  const actual: any = await importOriginal();
  const dummyPets = [
    {
      id: 101,
      name: "Thor",
      tutorId: 50,
      crecheId: 1,
      breed: "Pitbull",
      species: "dog",
      photoUrl: null,
      status: "active",
      allergies: "Frango",
    },
    {
      id: 102,
      name: "Rex",
      tutorId: 99,
      crecheId: 2,
      breed: "Poodle",
      species: "dog",
      photoUrl: null,
      status: "active",
    },
  ];

  const dummyCreches = [
    {
      id: 1,
      name: "Creche Pet Feliz",
      status: "active",
      phone: "1199999999",
      address: "Rua Pet, 123",
    },
  ];

  const dummyBookings = [
    {
      id: 42,
      crecheId: 1,
      tutorId: 50,
      petId: 101,
      type: "daycare",
      startDate: new Date(),
      endDate: new Date(),
      checkInTime: new Date(),
      status: "confirmed",
      totalPrice: 100,
    },
  ];

  const dummyTasks = [
    {
      id: 1,
      crecheId: 1,
      petId: 101,
      type: "operational",
      title: "Limpeza de canil",
      status: "pending",
      scheduledFor: new Date(),
      description: "Limpeza geral",
    },
    {
      id: 2,
      crecheId: 1,
      petId: 101,
      type: "feeding",
      title: "Ração da manhã",
      status: "pending",
      scheduledFor: new Date(),
      description: "Ração premier",
    },
    {
      id: 3,
      crecheId: 1,
      petId: 101,
      type: "medication",
      title: "Antibiótico",
      status: "pending",
      scheduledFor: new Date(),
      description: "Cefalexina 250mg",
    },
    {
      id: 4,
      crecheId: 1,
      petId: 101,
      type: "walk",
      title: "Passeio matinal",
      status: "pending",
      scheduledFor: new Date(),
      description: "Passeio de 30 minutos",
    },
    {
      id: 15,
      crecheId: 1,
      petId: 101,
      type: "operational",
      title: "Higienização de brinquedos",
      status: "pending",
      scheduledFor: new Date(),
      description: "Higienização",
    },
  ];

  const dummyValidatedPayload = { bookingId: 42, reason: "Teste" };
  const dummyPayloadHash = "88a7059879f87c657aa1b1dfdc50c1fd0bcd5a3ba9aa061e5956c2e39661c0b0";

  const dummyPendingActions = [
    {
      id: "pa_test_eval_1",
      userId: 50,
      crecheId: 1,
      role: "tutor",
      actionType: "cancel_my_booking",
      targetType: "booking",
      targetId: 42,
      validatedPayload: dummyValidatedPayload,
      payloadHash: dummyPayloadHash,
      status: "pending_confirmation",
      previewData: { bookingId: 42, petName: "Thor" },
      summary: "Cancelamento da reserva #42 do Thor",
      requestId: "eval-req",
      expiresAt: new Date(Date.now() + 300000),
      createdAt: new Date(),
    },
  ];

  function extractParamValues(obj: any, visited = new Set()): any[] {
    if (!obj || typeof obj !== "object" || visited.has(obj)) return [];
    visited.add(obj);
    if (obj.constructor && obj.constructor.name === "Param" && "value" in obj) {
      return [obj.value];
    }
    const vals: any[] = [];
    if (Array.isArray(obj)) {
      for (const item of obj) vals.push(...extractParamValues(item, visited));
    } else {
      for (const key of Object.keys(obj)) {
        if (key !== "table" && key !== "column" && key !== "schema") {
          vals.push(...extractParamValues(obj[key], visited));
        }
      }
    }
    return vals;
  }

  let lastBookingQueryWasConfirmed = false;

  const createQueryChain = (data: any[] = [], isTask = false, isBooking = false) => {
    let currentData = [...data];
    const chain: any = {
      where: vi.fn((cond: any) => {
        if (cond) {
          const params = extractParamValues(cond);
          if (isTask) {
            if (params.includes("feeding")) {
              currentData = dummyTasks.filter((t) => t.type === "feeding");
            } else if (params.includes("medication")) {
              currentData = dummyTasks.filter((t) => t.type === "medication");
            } else if (params.includes("walk")) {
              currentData = dummyTasks.filter((t) => t.type === "walk");
            } else if (params.includes("operational")) {
              currentData = dummyTasks.filter((t) => t.type === "operational");
            }
          }
          if (isBooking) {
            if (params.includes("confirmed")) {
              lastBookingQueryWasConfirmed = true;
              currentData = dummyBookings.filter((b) => b.status === "confirmed");
            } else if (params.includes("active")) {
              if (lastBookingQueryWasConfirmed) {
                // Secondary active check during check-in: no conflicting active booking
                lastBookingQueryWasConfirmed = false;
                currentData = [];
              } else {
                // Primary active lookup during check-out: pet has active booking
                currentData = dummyBookings.map((b) => ({ ...b, status: "active" }));
              }
            } else {
              lastBookingQueryWasConfirmed = false;
            }
          }
        }
        return chain;
      }),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      set: vi.fn(() => chain),
      values: vi.fn(() => chain),
      returning: vi.fn(() => chain),
      for: vi.fn(() => chain),
      then: (resolve: any, reject?: any) => Promise.resolve(currentData).then(resolve, reject),
    };
    return chain;
  };

  const dbMock: any = {
    select: vi.fn(() => ({
      from: vi.fn((table: any) => {
        const name = table?.[Symbol.for("drizzle:Name")] || "";
        if (name.includes("pending")) {
          return createQueryChain(dummyPendingActions);
        }
        if (name.includes("task")) {
          return createQueryChain(dummyTasks, true);
        }
        if (name.includes("booking")) {
          return createQueryChain(dummyBookings, false, true);
        }
        if (name.includes("creche")) {
          return createQueryChain(dummyCreches);
        }
        if (name.includes("vaccine") || name.includes("invoice")) {
          return createQueryChain([]);
        }
        return createQueryChain(dummyPets);
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => createQueryChain(dummyPendingActions)),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => createQueryChain(dummyPendingActions)),
    })),
    execute: vi.fn(async () => []),
    transaction: vi.fn(async (cb: any) => cb({
      execute: vi.fn(async () => []),
      select: vi.fn(() => ({
        from: vi.fn((table: any) => {
          const name = table?.[Symbol.for("drizzle:Name")] || "";
          if (name.includes("pending")) {
            return createQueryChain(dummyPendingActions);
          }
          if (name.includes("booking")) {
            return createQueryChain(dummyBookings, false, true);
          }
          if (name.includes("task")) {
            return createQueryChain(dummyTasks, true);
          }
          if (name.includes("vaccine") || name.includes("invoice")) {
            return createQueryChain([]);
          }
          if (name.includes("pet")) {
            return createQueryChain(dummyPets);
          }
          return createQueryChain(dummyPets);
        }),
      })),
      insert: vi.fn(() => ({ values: vi.fn(() => createQueryChain([])) })),
      update: vi.fn(() => ({ set: vi.fn(() => createQueryChain(dummyPendingActions)) })),
    })),
  };

  return {
    ...actual,
    db: dbMock,
  };
});

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const evalsPath = path.join(currentDir, "assistant-evals.json");
const evalCases: Array<{
  id: string;
  role: AssistantRole;
  category: string;
  query: string;
  screen?: any;
  expectedContains: string[];
  forbiddenContains: string[];
}> = JSON.parse(fs.readFileSync(evalsPath, "utf-8"));

describe("ArkPet R41.F — Golden Evaluation Dataset (142 Cases)", () => {
  it("verifies the evaluation dataset contains at least 142 test cases across 4 roles", () => {
    expect(evalCases.length).toBeGreaterThanOrEqual(142);

    const roles = new Set(evalCases.map((c) => c.role));
    expect(roles.has("master_admin")).toBe(true);
    expect(roles.has("creche_admin")).toBe(true);
    expect(roles.has("staff")).toBe(true);
    expect(roles.has("tutor")).toBe(true);
  });

  for (const testCase of evalCases) {
    it(`evaluates ${testCase.id} [${testCase.role}]: "${testCase.query.slice(0, 45)}"`, async () => {
      const context: AssistantSecurityContext = {
        userId: testCase.role === "tutor" ? 50 : 10,
        role: testCase.role,
        crecheId: testCase.role === "master_admin" ? null : 1,
        name: `User ${testCase.role}`,
        email: `${testCase.role}@test.com`,
        requestId: `eval-${testCase.id}`,
      };

      const result = await AssistantService.processMessage(
        testCase.query,
        undefined,
        context,
        testCase.screen
      );

      const content = result.message.content.toLowerCase();

      // Check expected keywords (case-insensitive)
      for (const expected of testCase.expectedContains) {
        expect(content).toContain(expected.toLowerCase());
      }

      // Check forbidden keywords (case-insensitive)
      for (const forbidden of testCase.forbiddenContains) {
        expect(content).not.toContain(forbidden.toLowerCase());
      }
    });
  }
});
