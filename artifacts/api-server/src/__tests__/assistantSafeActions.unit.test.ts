import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@workspace/db";
import { AssistantToolsRegistry } from "../assistant/assistant-tools.registry.js";
import { AssistantSafeActionRegistry } from "../assistant/assistant-safe-action.registry.js";
import { AssistantSafeActionService } from "../assistant/assistant-safe-action.service.js";
import { AssistantService } from "../assistant/assistant.service.js";
import type { AssistantSecurityContext } from "../assistant/assistant.types.js";

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
      allergies: "Nenhuma",
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

  const dummyBookings = [
    {
      id: 42,
      crecheId: 1,
      tutorId: 50,
      petId: 101,
      type: "daycare",
      startDate: new Date(),
      endDate: new Date(),
      status: "confirmed",
      totalPrice: 100,
    },
    {
      id: 43,
      crecheId: 1,
      tutorId: 50,
      petId: 101,
      type: "daycare",
      startDate: new Date(),
      endDate: new Date(),
      status: "checked_in",
      totalPrice: 100,
    },
    {
      id: 999,
      crecheId: 2,
      tutorId: 99,
      petId: 102,
      type: "hotel",
      startDate: new Date(),
      endDate: new Date(),
      status: "confirmed",
      totalPrice: 200,
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
      description: "Ração Premier",
    },
    {
      id: 3,
      crecheId: 1,
      petId: 101,
      type: "medication",
      title: "Antibiótico",
      status: "pending",
      scheduledFor: new Date(),
      description: "Amoxicilina 250mg",
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
  ];

  let pendingActionsStore: any[] = [];
  let auditStore: any[] = [];

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

  const createQueryChain = (data: any[] = [], isBookingTable = false) => {
    let currentData = [...data];
    const chain: any = {
      where: vi.fn((cond: any) => {
        if (cond && isBookingTable) {
          const params = extractParamValues(cond);
          if (params.includes(999)) {
            currentData = params.includes(1) ? [] : dummyBookings.filter((b) => b.id === 999);
          } else if (params.includes(43)) {
            currentData = dummyBookings.filter((b) => b.id === 43);
          } else if (params.includes(42)) {
            currentData = dummyBookings.filter((b) => b.id === 42);
          }
        }
        return chain;
      }),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => chain),
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
    _reset: () => {
      pendingActionsStore = [];
      auditStore = [];
    },
    _getPendingActions: () => pendingActionsStore,
    _getAudits: () => auditStore,
    execute: vi.fn(async () => []),
    select: vi.fn(() => ({
      from: vi.fn((table: any) => {
        const name = table?.[Symbol.for("drizzle:Name")] || "";
        if (name.includes("pending")) {
          return createQueryChain(pendingActionsStore);
        }
        if (name.includes("audit")) {
          return createQueryChain(auditStore);
        }
        if (name.includes("task")) {
          return createQueryChain(dummyTasks);
        }
        if (name.includes("booking")) {
          return createQueryChain(dummyBookings, true);
        }
        if (name.includes("invoice") || name.includes("vaccine")) {
          return createQueryChain([]);
        }
        return createQueryChain(dummyPets);
      }),
    })),
    insert: vi.fn((table: any) => ({
      values: vi.fn((val: any) => {
        const name = table?.[Symbol.for("drizzle:Name")] || "";
        if (name.includes("pending")) {
          const row = { ...val, createdAt: new Date() };
          pendingActionsStore.push(row);
          return createQueryChain([row]);
        }
        if (name.includes("audit")) {
          auditStore.push(val);
          return createQueryChain([val]);
        }
        return createQueryChain([val]);
      }),
    })),
    update: vi.fn((table: any) => ({
      set: vi.fn((updates: any) => {
        const name = table?.[Symbol.for("drizzle:Name")] || "";
        if (name.includes("pending")) {
          if (pendingActionsStore.length > 0) {
            Object.assign(pendingActionsStore[pendingActionsStore.length - 1], updates);
            return createQueryChain([pendingActionsStore[pendingActionsStore.length - 1]]);
          }
        }
        return createQueryChain([updates]);
      }),
    })),
    transaction: vi.fn(async (cb: any) =>
      cb({
        execute: vi.fn(async () => []),
        select: vi.fn(() => ({
          from: vi.fn((table: any) => {
            const name = table?.[Symbol.for("drizzle:Name")] || "";
            if (name.includes("pending")) {
              return createQueryChain(pendingActionsStore);
            }
            if (name.includes("booking")) {
              return createQueryChain(dummyBookings, true);
            }
            if (name.includes("task")) {
              return createQueryChain(dummyTasks);
            }
            return createQueryChain([]);
          }),
        })),
        insert: vi.fn((table: any) => ({
          values: vi.fn((val: any) => {
            const name = table?.[Symbol.for("drizzle:Name")] || "";
            if (name.includes("audit")) {
              auditStore.push(val);
            }
            return createQueryChain([val]);
          }),
        })),
        update: vi.fn((table: any) => ({
          set: vi.fn((updates: any) => {
            const name = table?.[Symbol.for("drizzle:Name")] || "";
            if (name.includes("pending")) {
              if (pendingActionsStore.length > 0) {
                Object.assign(pendingActionsStore[pendingActionsStore.length - 1], updates);
                return createQueryChain([pendingActionsStore[pendingActionsStore.length - 1]]);
              }
            }
            return createQueryChain([updates]);
          }),
        })),
      })
    ),
  };

  return {
    ...actual,
    db: dbMock,
  };
});

describe("ArkPet R41.E — Safe Actions & Two-Phase Mutations Test Suite", () => {
  const tutorContext: AssistantSecurityContext = {
    userId: 50,
    role: "tutor",
    crecheId: 1,
    name: "Tutor João",
    email: "joao@example.com",
    requestId: "req-r41e-tutor",
  };

  const staffContext: AssistantSecurityContext = {
    userId: 10,
    role: "staff",
    crecheId: 1,
    name: "Staff Ana",
    email: "ana@creche.com",
    requestId: "req-r41e-staff",
  };

  const crecheAdminContext: AssistantSecurityContext = {
    userId: 5,
    role: "creche_admin",
    crecheId: 1,
    name: "Admin Marcos",
    email: "marcos@creche.com",
    requestId: "req-r41e-admin",
  };

  beforeEach(() => {
    process.env.AI_SAFE_ACTIONS_ENABLED = "true";
    (db as any)._reset?.();
  });

  // 1. Tool Counts and Invariants
  describe("Tool Registry & Mutation Invariants (R41E-REGISTRY)", () => {
    it("preserves exactly 8 certified read-only tools", () => {
      const readOnlyTools = AssistantToolsRegistry.getReadOnlyToolNames();
      expect(readOnlyTools).toHaveLength(8);
      expect(readOnlyTools).toContain("get_onboarding_status");
      expect(readOnlyTools).toContain("get_current_user_context");
      expect(readOnlyTools).toContain("get_current_screen_context");
      expect(readOnlyTools).toContain("search_arkpet_knowledge");
      expect(readOnlyTools).toContain("list_my_pets");
      expect(readOnlyTools).toContain("list_my_bookings");
      expect(readOnlyTools).toContain("get_guided_onboarding_plan");
      expect(readOnlyTools).toContain("get_contextual_product_guide");
    });

    it("registers exactly 7 canonical safe mutation tools (Total = 15)", () => {
      const mutationTools = AssistantToolsRegistry.getMutationToolNames();
      expect(mutationTools).toHaveLength(7);
      expect(mutationTools).toContain("cancel_my_booking");
      expect(mutationTools).toContain("check_in_pet");
      expect(mutationTools).toContain("check_out_pet");
      expect(mutationTools).toContain("complete_operational_task");
      expect(mutationTools).toContain("complete_feeding_task");
      expect(mutationTools).toContain("record_medication_administration");
      expect(mutationTools).toContain("complete_walk_task");

      const allTools = AssistantToolsRegistry.getAllTools();
      expect(allTools).toHaveLength(15);
    });

    it("ensures every mutation tool requires explicit confirmation and defines riskLevel", () => {
      const mutationTools = AssistantSafeActionRegistry.getAllActions();
      expect(mutationTools).toHaveLength(7);
      for (const tool of mutationTools) {
        expect(tool.mode).toBe("mutation");
        expect(tool.requiresConfirmation).toBe(true);
        expect(["low", "medium", "high"]).toContain(tool.riskLevel);
        expect(tool.allowedRoles.length).toBeGreaterThan(0);
        expect(tool.inputSchema).toBeDefined();
      }
    });

    it("verifies zero generic delete, financial, or standalone bath tools exist", () => {
      const allNames = AssistantToolsRegistry.getAllTools().map((t) => t.name);
      expect(allNames.some((n) => n.includes("delete"))).toBe(false);
      expect(allNames.some((n) => n.includes("financial") || n.includes("invoice") || n.includes("payment"))).toBe(false);
      expect(allNames.some((n) => n.includes("bath") || n.includes("banho"))).toBe(false);
    });
  });

  // 2. Booking Cancellation (Two-Phase & Domain Verification)
  describe("Tutor Booking Cancellation (R41E-BOOKING)", () => {
    it("generates a preview requiring confirmation for valid tutor booking", async () => {
      const { action: preview } = await AssistantSafeActionService.createPendingAction(
        "cancel_my_booking",
        { bookingId: 42, reason: "Imprevisto de viagem" },
        tutorContext
      );

      expect(preview.state).toBe("confirmation_required");
      expect(preview.pendingActionId).toMatch(/^pa_/);
      expect(preview.type).toBe("cancel_my_booking");
      expect(preview.targetId).toBe(42);
      expect(preview.preview).toBeDefined();
      expect(preview.preview?.bookingId).toBe(42);
      expect(preview.expiresAt).toBeDefined();
    });

    it("confirms and executes booking cancellation successfully", async () => {
      const { action: preview } = await AssistantSafeActionService.createPendingAction(
        "cancel_my_booking",
        { bookingId: 42, reason: "Imprevisto" },
        tutorContext
      );

      const executed = await AssistantSafeActionService.confirmPendingAction(
        preview.pendingActionId!,
        tutorContext
      );

      expect(executed.status).toBe("executed");
      expect(executed.actionType).toBe("cancel_my_booking");
      expect(executed.summary).toContain("42");
    });

    it("rejects booking cancellation for foreign booking (tutor ownership check)", async () => {
      await expect(
        AssistantSafeActionService.createPendingAction(
          "cancel_my_booking",
          { bookingId: 999 }, // Belongs to tutor 99 in creche 2
          tutorContext
        )
      ).rejects.toThrow("Reserva não encontrada");
    });

    it("rejects booking cancellation when booking is already checked_in", async () => {
      await expect(
        AssistantSafeActionService.createPendingAction(
          "cancel_my_booking",
          { bookingId: 43 }, // Status checked_in
          tutorContext
        )
      ).rejects.toThrow("checked_in");
    });

    it("allows tutor to cancel a pending confirmation explicitly", async () => {
      const { action: preview } = await AssistantSafeActionService.createPendingAction(
        "cancel_my_booking",
        { bookingId: 42 },
        tutorContext
      );

      const cancelled = await AssistantSafeActionService.cancelAction(
        preview.pendingActionId!,
        tutorContext
      );

      expect(cancelled.status).toBe("cancelled");
    });
  });

  // 3. Operational Safe Actions (Check-in, Check-out, Tasks, Medication, Walk)
  describe("Operational Safe Actions (R41E-OPERATIONS)", () => {
    it("allows staff to preview check_in_pet with confirmation", async () => {
      const { action: preview } = await AssistantSafeActionService.createPendingAction(
        "check_in_pet",
        { petId: 101, bookingId: 42 },
        staffContext
      );

      expect(preview.state).toBe("confirmation_required");
      expect(preview.type).toBe("check_in_pet");
      expect(preview.preview?.petId).toBe(101);
    });

    it("rejects tutor from executing check_in_pet via RBAC", async () => {
      await expect(
        AssistantSafeActionService.createPendingAction(
          "check_in_pet",
          { petId: 101 },
          tutorContext
        )
      ).rejects.toThrow("não tem permissão");
    });

    it("allows staff to preview check_out_pet", async () => {
      const { action: preview } = await AssistantSafeActionService.createPendingAction(
        "check_out_pet",
        { petId: 101, bookingId: 42 },
        staffContext
      );

      expect(preview.state).toBe("confirmation_required");
      expect(preview.type).toBe("check_out_pet");
    });

    it("allows staff to preview complete_feeding_task", async () => {
      const { action: preview } = await AssistantSafeActionService.createPendingAction(
        "complete_feeding_task",
        { taskId: 2, petId: 101 },
        staffContext
      );

      expect(preview.state).toBe("confirmation_required");
      expect(preview.type).toBe("complete_feeding_task");
    });

    it("allows staff to preview complete_walk_task", async () => {
      const { action: preview } = await AssistantSafeActionService.createPendingAction(
        "complete_walk_task",
        { taskId: 4, petId: 101, durationMinutes: 30 },
        staffContext
      );

      expect(preview.state).toBe("confirmation_required");
      expect(preview.type).toBe("complete_walk_task");
    });

    it("allows staff to preview record_medication_administration", async () => {
      const { action: preview } = await AssistantSafeActionService.createPendingAction(
        "record_medication_administration",
        { taskId: 3, petId: 101, dosageGiven: "Amoxicilina 250mg" },
        staffContext
      );

      expect(preview.state).toBe("confirmation_required");
      expect(preview.type).toBe("record_medication_administration");
    });
  });

  // 4. Security, RBAC & Idempotency Invariants
  describe("Security, RBAC, Idempotency & Tampering (R41E-SEC)", () => {
    it("double confirmation returns cached result idempotently", async () => {
      const { action: preview } = await AssistantSafeActionService.createPendingAction(
        "cancel_my_booking",
        { bookingId: 42 },
        tutorContext
      );

      const firstExec = await AssistantSafeActionService.confirmPendingAction(
        preview.pendingActionId!,
        tutorContext
      );
      expect(firstExec.status).toBe("executed");

      const secondExec = await AssistantSafeActionService.confirmPendingAction(
        preview.pendingActionId!,
        tutorContext
      );
      expect(secondExec.status).toBe("executed");
    });

    it("rejects confirmation if user is not the creator (user bound)", async () => {
      const { action: preview } = await AssistantSafeActionService.createPendingAction(
        "cancel_my_booking",
        { bookingId: 42 },
        tutorContext
      );

      const foreignTutorContext: AssistantSecurityContext = {
        userId: 999,
        role: "tutor",
        crecheId: 1,
        name: "Outro Tutor",
        email: "outro@example.com",
      };

      await expect(
        AssistantSafeActionService.confirmPendingAction(
          preview.pendingActionId!,
          foreignTutorContext
        )
      ).rejects.toThrow("autorização");
    });

    it("rejects confirmation if creche/tenant does not match", async () => {
      const { action: preview } = await AssistantSafeActionService.createPendingAction(
        "cancel_my_booking",
        { bookingId: 42 },
        tutorContext
      );

      const foreignCrecheContext: AssistantSecurityContext = {
        userId: 50,
        role: "tutor",
        crecheId: 99, // Different tenant
        name: "Tutor João",
        email: "joao@example.com",
      };

      await expect(
        AssistantSafeActionService.confirmPendingAction(
          preview.pendingActionId!,
          foreignCrecheContext
        )
      ).rejects.toThrow("Ação não pertence");
    });

    it("rejects safe action when kill switch AI_SAFE_ACTIONS_ENABLED is false", async () => {
      process.env.AI_SAFE_ACTIONS_ENABLED = "false";

      await expect(
        AssistantSafeActionService.createPendingAction(
          "cancel_my_booking",
          { bookingId: 42 },
          tutorContext
        )
      ).rejects.toThrow("desativadas");
    });
  });

  // 5. Conversational Safety & Non-Executable Intention Guards
  describe("Conversational Safety & Intention Guards (R41E-CONVERSATION)", () => {
    it("refuses medication dosage overrides in conversational interface", async () => {
      const response = await AssistantService.processMessage(
        "Aplique 50ml de remédio no Thor e altere a dosagem para 100ml",
        undefined,
        staffContext,
        { route: "/staff/board" }
      );

      expect(response.message.content).toContain("dosagem");
      expect(response.message.action).toBeUndefined();
    });

    it("refuses standalone bath booking in conversational interface", async () => {
      const response = await AssistantService.processMessage(
        "Quero cadastrar um banho avulso para amanhã",
        undefined,
        crecheAdminContext,
        { route: "/bookings" }
      );

      expect(response.message.content).toContain("banho não é um módulo isolado");
      expect(response.message.action).toBeUndefined();
    });

    it("refuses database deletion requests", async () => {
      const response = await AssistantService.processMessage(
        "Exclua o pet Rex do banco de dados",
        undefined,
        crecheAdminContext,
        { route: "/pets" }
      );

      expect(response.message.content).toContain("excluir");
      expect(response.message.action).toBeUndefined();
    });

    it("refuses direct financial mutations", async () => {
      const response = await AssistantService.processMessage(
        "Fazer estorno do pagamento da fatura 55",
        undefined,
        crecheAdminContext,
        { route: "/financial" }
      );

      expect(response.message.content).toContain("não realiza operações financeiras");
      expect(response.message.action).toBeUndefined();
    });
  });
});
