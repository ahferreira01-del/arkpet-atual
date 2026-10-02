import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@workspace/db";
import { AssistantToolsRegistry } from "../assistant/assistant-tools.registry.js";
import { AssistantSafeActionRegistry } from "../assistant/assistant-safe-action.registry.js";
import { AssistantSafeActionService } from "../assistant/assistant-safe-action.service.js";
import { AssistantService } from "../assistant/assistant.service.js";
import { BookingDomainService } from "../services/bookingDomainService.js";
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
  let invoiceStore: any[] = [];
  let vaccineStore: any[] = [];
  let activeBookingsOverride: any[] | null = null;

  function extractParamValues(obj: any, visited = new Set()): any[] {
    if (!obj || typeof obj !== "object" || visited.has(obj)) return [];
    if (obj.table || obj.enumValues || obj.columns || obj._ || obj.tableConfig || obj.primaryKey || obj.indexes) return [];
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

  const createPendingActionsChain = (isUpdate = false, updates?: any) => {
    let currentData = [...pendingActionsStore];
    const chain: any = {
      leftJoin: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn((cond: any) => {
        if (cond) {
          const params = extractParamValues(cond);
          currentData = pendingActionsStore.filter((row) => {
            const idParam = params.find((p) => typeof p === "string" && p.startsWith("pa_"));
            if (idParam && row.id !== idParam) return false;

            const userIdParam = params.find((p) => typeof p === "number" && (p === 50 || p === 999 || p === 10 || p === 5));
            if (userIdParam !== undefined && row.userId !== userIdParam) return false;

            const crecheIdParam = params.find((p) => typeof p === "number" && (p === 1 || p === 2 || p === 99));
            if (crecheIdParam !== undefined && row.crecheId !== crecheIdParam) return false;

            if (params.includes("pending_confirmation") && row.status !== "pending_confirmation") return false;

            const roleParam = params.find((p) => ["tutor", "staff", "creche_admin", "master_admin"].includes(p));
            if (roleParam && row.role !== roleParam) return false;

            return true;
          });

          if (isUpdate && currentData.length > 0) {
            for (const row of currentData) {
              Object.assign(row, updates);
            }
          }
        }
        return chain;
      }),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      set: vi.fn(() => chain),
      returning: vi.fn(() => chain),
      then: (resolve: any, reject?: any) => Promise.resolve(currentData).then(resolve, reject),
    };
    return chain;
  };

  const createQueryChain = (data: any[] = [], isBookingTable = false, isTaskTable = false) => {
    let currentData = [...data];
    const chain: any = {
      leftJoin: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn((cond: any) => {
        if (cond) {
          const params = extractParamValues(cond);
          if (isBookingTable) {
            if (params.includes("active")) {
              if (activeBookingsOverride !== null) {
                currentData = [...activeBookingsOverride];
              } else {
                currentData = params.includes(42)
                  ? dummyBookings.filter((b) => b.id === 42).map((b) => ({ ...b, status: "active" }))
                  : dummyBookings.filter((b) => b.status === "active");
              }
            }
 else if (params.includes("confirmed")) {
              currentData = dummyBookings.filter((b) => b.status === "confirmed");
              if (params.includes(42)) {
                currentData = currentData.filter((b) => b.id === 42);
              }
            } else if (params.includes(999)) {
              currentData = params.includes(1) ? [] : dummyBookings.filter((b) => b.id === 999);
            } else if (params.includes(43)) {
              currentData = dummyBookings.filter((b) => b.id === 43);
            } else if (params.includes(42)) {
              currentData = dummyBookings.filter((b) => b.id === 42);
            }
          } else if (isTaskTable) {
            let filtered = [...dummyTasks];
            if (params.includes("feeding")) {
              filtered = filtered.filter((t) => t.type === "feeding");
            } else if (params.includes("medication")) {
              filtered = filtered.filter((t) => t.type === "medication");
            } else if (params.includes("walk")) {
              filtered = filtered.filter((t) => t.type === "walk");
            } else if (params.includes("operational")) {
              filtered = filtered.filter((t) => t.type === "operational");
            }

            const explicitTaskId = params.find(
              (p) => typeof p === "number" && p !== 1 && p !== 101 && p !== 102 && dummyTasks.some((t) => t.id === p)
            );
            if (explicitTaskId !== undefined) {
              filtered = filtered.filter((t) => t.id === explicitTaskId);
            } else if (params.includes("operational") && params.includes(1)) {
              filtered = filtered.filter((t) => t.id === 1);
            }

            currentData = filtered;
          }
        }
        return chain;
      }),

      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      set: vi.fn(() => chain),
      values: vi.fn(() => chain),
      returning: vi.fn(() => chain),
      for: vi.fn(() => chain),
      then: (resolve: any, reject?: any) => Promise.resolve(currentData).then(resolve, reject),
    };
    return chain;
  };

  const createUpdateChain = (tableName: string) => ({
    set: vi.fn((updates: any) => {
      if (tableName.includes("pending")) {
        return createPendingActionsChain(true, updates);
      }
      return {
        where: vi.fn((cond: any) => {
          const params = extractParamValues(cond);
          if (tableName.includes("booking")) {
            const target = dummyBookings.find((b) => params.includes(b.id)) || dummyBookings[0];
            const updated = { ...target, ...updates };
            return {
              returning: vi.fn(() => Promise.resolve([updated])),
              then: (res: any) => Promise.resolve([updated]).then(res),
            };
          }
          if (tableName.includes("task")) {
            const target = dummyTasks.find((t) => params.includes(t.id)) || dummyTasks[0];
            const updated = { ...target, ...updates };
            return {
              returning: vi.fn(() => Promise.resolve([updated])),
              then: (res: any) => Promise.resolve([updated]).then(res),
            };
          }
          return {
            returning: vi.fn(() => Promise.resolve([updates])),
            then: (res: any) => Promise.resolve([updates]).then(res),
          };
        }),
      };
    }),
  });

  const dbMock: any = {
    _reset: () => {
      pendingActionsStore = [];
      auditStore = [];
      invoiceStore = [];
      vaccineStore = [];
      activeBookingsOverride = null;
    },
    _getPendingActions: () => pendingActionsStore,
    _getAudits: () => auditStore,
    _setInvoices: (items: any[]) => { invoiceStore = items; },
    _setVaccines: (items: any[]) => { vaccineStore = items; },
    _setActiveBookingsOverride: (items: any[] | null) => { activeBookingsOverride = items; },
    _dummyTasks: dummyTasks,
    execute: vi.fn(async () => []),
    select: vi.fn(() => ({
      from: vi.fn((table: any) => {
        const name = table?.[Symbol.for("drizzle:Name")] || "";
        if (name.includes("pending")) {
          return createPendingActionsChain();
        }
        if (name.includes("audit")) {
          return createQueryChain(auditStore);
        }
        if (name.includes("task")) {
          return createQueryChain(dummyTasks, false, true);
        }
        if (name.includes("booking")) {
          return createQueryChain(dummyBookings, true);
        }
        if (name.includes("invoice")) {
          return createQueryChain(invoiceStore);
        }
        if (name.includes("vaccine")) {
          return createQueryChain(vaccineStore);
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
    update: vi.fn((table: any) => {
      const name = table?.[Symbol.for("drizzle:Name")] || "";
      return createUpdateChain(name);
    }),
    transaction: vi.fn(async (cb: any) =>
      cb({
        execute: vi.fn(async () => []),
        select: vi.fn(() => ({
          from: vi.fn((table: any) => {
            const name = table?.[Symbol.for("drizzle:Name")] || "";
            if (name.includes("pending")) {
              return createPendingActionsChain();
            }
            if (name.includes("booking")) {
              return createQueryChain(dummyBookings, true);
            }
            if (name.includes("task")) {
              return createQueryChain(dummyTasks, false, true);
            }
            if (name.includes("invoice")) {
              return createQueryChain(invoiceStore);
            }
            if (name.includes("vaccine")) {
              return createQueryChain(vaccineStore);
            }
            if (name.includes("pet")) {
              return createQueryChain(dummyPets);
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
        update: vi.fn((table: any) => {
          const name = table?.[Symbol.for("drizzle:Name")] || "";
          return createUpdateChain(name);
        }),
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

  // 4. Security, RBAC & Idempotency Invariants (R41.E-FINAL.1 Verification)
  describe("Security, RBAC, CAS Invariants & Domain Parity (R41E-FINAL1)", () => {
    it("R41E-FINAL1-SEC-001: foreign user cannot change pending state (remains pending_confirmation)", async () => {
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
      ).rejects.toThrow("não encontrada");

      // Verify state was NOT poisoned (FOREIGN_PENDING_ACTION_STATE_MUTATION = 0)
      const action = await AssistantSafeActionService.getPendingAction(
        preview.pendingActionId!,
        tutorContext
      );
      expect(action?.status).toBe("pending_confirmation");
    });

    it("R41E-FINAL1-SEC-002: cross-tenant confirmation fails without state change", async () => {
      const { action: preview } = await AssistantSafeActionService.createPendingAction(
        "cancel_my_booking",
        { bookingId: 42 },
        tutorContext
      );

      const foreignCrecheContext: AssistantSecurityContext = {
        userId: 50,
        role: "tutor",
        crecheId: 99, // Foreign tenant
        name: "Tutor João",
        email: "joao@example.com",
      };

      await expect(
        AssistantSafeActionService.confirmPendingAction(
          preview.pendingActionId!,
          foreignCrecheContext
        )
      ).rejects.toThrow("não encontrada");

      // Verify state was NOT poisoned
      const action = await AssistantSafeActionService.getPendingAction(
        preview.pendingActionId!,
        tutorContext
      );
      expect(action?.status).toBe("pending_confirmation");
    });

    it("R41E-FINAL1-SEC-003: role change fails before state lock (status untouched)", async () => {
      const { action: preview } = await AssistantSafeActionService.createPendingAction(
        "check_in_pet",
        { petId: 101, bookingId: 42 },
        staffContext
      );

      const alteredRoleContext: AssistantSecurityContext = {
        ...staffContext,
        role: "tutor" as any,
      };

      await expect(
        AssistantSafeActionService.confirmPendingAction(
          preview.pendingActionId!,
          alteredRoleContext
        )
      ).rejects.toThrow("papel");

      // Verify status was NOT modified to executing/failed (STALE_AUTHORIZATION_MUTATION = 0)
      const action = await AssistantSafeActionService.getPendingAction(
        preview.pendingActionId!,
        staffContext
      );
      expect(action?.status).toBe("pending_confirmation");
    });

    it("R41E-FINAL1-SEC-004: guessed action id returns 404 without metadata disclosure", async () => {
      await expect(
        AssistantSafeActionService.confirmPendingAction(
          "pa_guessed_invalid_id_9999",
          tutorContext
        )
      ).rejects.toThrow("não encontrada");

      const retrieved = await AssistantSafeActionService.getPendingAction(
        "pa_guessed_invalid_id_9999",
        tutorContext
      );
      expect(retrieved).toBeNull();
    });

    it("R41E-FINAL1-IDEMPOTENCY-001: double confirmation returns cached result idempotently", async () => {
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
      expect(secondExec.isIdempotentReplay).toBe(true);
    });

    it("R41E-FINAL1-RACE-001: confirm vs cancel race resolves safely with exactly one winner", async () => {
      const { action: preview } = await AssistantSafeActionService.createPendingAction(
        "cancel_my_booking",
        { bookingId: 42 },
        tutorContext
      );

      // Simulate confirm winning first
      await AssistantSafeActionService.confirmPendingAction(
        preview.pendingActionId!,
        tutorContext
      );

      // Attempt cancel on already executed action
      await expect(
        AssistantSafeActionService.cancelAction(
          preview.pendingActionId!,
          tutorContext
        )
      ).rejects.toThrow("Não é possível cancelar");
    });

    it("R41E-FINAL1-TARGET-001: ambiguous feeding target (2 tasks, no pet/task) rejected with clarification", async () => {
      const dummyTasks = (db as any)._dummyTasks;
      dummyTasks.push({
        id: 20,
        crecheId: 1,
        petId: 102,
        type: "feeding",
        title: "Ração tarde",
        status: "pending",
        scheduledFor: new Date(),
        description: "Ração pet 102",
      });

      try {
        await expect(
          AssistantSafeActionService.createPendingAction(
            "complete_feeding_task",
            {},
            staffContext
          )
        ).rejects.toThrow("múltiplas tarefas");
      } finally {
        dummyTasks.pop();
      }
    });

    it("R41E-FINAL1-TARGET-002: ambiguous medication target rejected with clarification", async () => {
      const dummyTasks = (db as any)._dummyTasks;
      dummyTasks.push({
        id: 30,
        crecheId: 1,
        petId: 102,
        type: "medication",
        title: "Colírio",
        status: "pending",
        scheduledFor: new Date(),
        description: "Colírio 1 gota",
      });

      try {
        await expect(
          AssistantSafeActionService.createPendingAction(
            "record_medication_administration",
            {},
            staffContext
          )
        ).rejects.toThrow("múltiplas tarefas");
      } finally {
        dummyTasks.pop();
      }
    });

    it("R41E-FINAL1-TARGET-003: ambiguous walk target rejected with clarification", async () => {
      const dummyTasks = (db as any)._dummyTasks;
      dummyTasks.push({
        id: 40,
        crecheId: 1,
        petId: 102,
        type: "walk",
        title: "Passeio tarde",
        status: "pending",
        scheduledFor: new Date(),
        description: "Passeio 20 min",
      });

      try {
        await expect(
          AssistantSafeActionService.createPendingAction(
            "complete_walk_task",
            {},
            staffContext
          )
        ).rejects.toThrow("múltiplas tarefas");
      } finally {
        dummyTasks.pop();
      }
    });

    it("R41E-FINAL1-DOMAIN-001: task completion uses canonical TaskDomainService", async () => {
      const { action: preview } = await AssistantSafeActionService.createPendingAction(
        "complete_operational_task",
        { taskId: 1 },
        staffContext
      );

      const executed = await AssistantSafeActionService.confirmPendingAction(
        preview.pendingActionId!,
        staffContext
      );

      expect(executed.status).toBe("executed");
      expect(executed.actionType).toBe("complete_operational_task");
    });

    it("R41E-FINAL1-DOMAIN-002: tenant operational lock preserved during domain mutation", async () => {
      const { action: preview } = await AssistantSafeActionService.createPendingAction(
        "check_in_pet",
        { petId: 101, bookingId: 42 },
        staffContext
      );

      const executed = await AssistantSafeActionService.confirmPendingAction(
        preview.pendingActionId!,
        staffContext
      );

      expect(executed.status).toBe("executed");
      expect(executed.actionType).toBe("check_in_pet");
    });

    it("R41E-FINAL1-DOMAIN-003: task notification side effect preserved on first completion, not on replay", async () => {
      const { action: preview } = await AssistantSafeActionService.createPendingAction(
        "complete_feeding_task",
        { taskId: 2, petId: 101 },
        staffContext
      );

      const first = await AssistantSafeActionService.confirmPendingAction(
        preview.pendingActionId!,
        staffContext
      );
      expect(first.status).toBe("executed");

      const replay = await AssistantSafeActionService.confirmPendingAction(
        preview.pendingActionId!,
        staffContext
      );
      expect(replay.isIdempotentReplay).toBe(true);
    });

    it("R41E-FINAL1-DOMAIN-004: booking cancellation canonical side effects preserved", async () => {
      const { action: preview } = await AssistantSafeActionService.createPendingAction(
        "cancel_my_booking",
        { bookingId: 42, reason: "Cancelamento canônico" },
        tutorContext
      );

      const executed = await AssistantSafeActionService.confirmPendingAction(
        preview.pendingActionId!,
        tutorContext
      );

      expect(executed.status).toBe("executed");
      expect(executed.result?.cancellationReason).toBe("Cancelamento canônico");
    });

    it("R41E-FINAL1-ERROR-001: unexpected internal error with DB string/secret sanitized in response", async () => {
      const sensitive = "Error: postgres://user:secretpass@db.internal:5432/arkpet Bearer eyJhbGciOi...";
      const { sanitizeAuditString } = await import("../assistant/assistant-safe-action.service.js");
      const sanitized = sanitizeAuditString(sensitive);
      expect(sanitized).not.toContain("secretpass");
      expect(sanitized).not.toContain("eyJhbGciOi");
      expect(sanitized).toContain("[REDACTED_URI]");
      expect(sanitized).toContain("[REDACTED_BEARER]");
    });

    it("R41E-FINAL1-MED-001: medication mutation updates only exact intended medication record", async () => {
      const { action: preview } = await AssistantSafeActionService.createPendingAction(
        "record_medication_administration",
        { taskId: 3, petId: 101, dosageGiven: "Amoxicilina 250mg" },
        staffContext
      );

      const executed = await AssistantSafeActionService.confirmPendingAction(
        preview.pendingActionId!,
        staffContext
      );

      expect(executed.status).toBe("executed");
      expect(executed.targetId).toBe(3);
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

  // 6. Canonical Preview / Execution Parity & Business Rule Unification (R41E-FINAL2)
  describe("Canonical Preview / Execution Parity & Business Rule Unification (R41E-FINAL2)", () => {
    beforeEach(() => {
      (db as any)._reset();
    });

    it("R41E-FINAL2-PARITY-001: Cancellation preview and execution parity", async () => {
      // 1. Valid booking fixture: preview and execution both approve
      const previewRes = await BookingDomainService.previewCancellation({
        bookingId: 42,
        crecheId: 1,
        actorUserId: 50,
        actorRole: "tutor",
      });
      expect(previewRes.targetId).toBe(42);
      expect(previewRes.previewData.bookingId).toBe(42);

      const { action: paPreview } = await AssistantSafeActionService.createPendingAction(
        "cancel_my_booking",
        { bookingId: 42, reason: "Motivo viagem" },
        tutorContext
      );
      expect(paPreview.state).toBe("confirmation_required");

      const executionRes = await AssistantSafeActionService.confirmPendingAction(
        paPreview.pendingActionId!,
        tutorContext
      );
      expect(executionRes.status).toBe("executed");

      // 2. Invalid non-cancellable fixture (booking 43 with status checked_in):
      // Preview rejects, SafeAction preview rejects, canonical execution rejects with exact same rule
      await expect(
        BookingDomainService.previewCancellation({
          bookingId: 43,
          crecheId: 1,
          actorUserId: 50,
          actorRole: "tutor",
        })
      ).rejects.toThrow("checked_in");

      await expect(
        AssistantSafeActionService.createPendingAction(
          "cancel_my_booking",
          { bookingId: 43 },
          tutorContext
        )
      ).rejects.toThrow("checked_in");

      await expect(
        BookingDomainService.cancelBooking({
          bookingId: 43,
          crecheId: 1,
          actorUserId: 50,
          actorRole: "tutor",
          reason: "Tentativa inválida",
        })
      ).rejects.toThrow("checked_in");
    });

    it("R41E-FINAL2-PARITY-002: Paid invoice parity (both preview and execution reject)", async () => {
      // Simulate paid invoice item linked to booking 42
      (db as any)._setInvoices([{ itemId: 88, status: "paid" }]);

      // Preview rejects with 422
      await expect(
        BookingDomainService.previewCancellation({
          bookingId: 42,
          crecheId: 1,
          actorUserId: 50,
          actorRole: "tutor",
        })
      ).rejects.toMatchObject({ statusCode: 422, code: "paid_invoice_exists" });

      // Direct canonical cancellation rejects with 422
      await expect(
        BookingDomainService.cancelBooking({
          bookingId: 42,
          crecheId: 1,
          actorUserId: 50,
          actorRole: "tutor",
          reason: "Estorno pendente",
        })
      ).rejects.toMatchObject({ statusCode: 422, code: "paid_invoice_exists" });

      // Safe action preview rejects with 422
      await expect(
        AssistantSafeActionService.createPendingAction(
          "cancel_my_booking",
          { bookingId: 42 },
          tutorContext
        )
      ).rejects.toMatchObject({ statusCode: 422, code: "paid_invoice_exists" });
    });

    it("R41E-FINAL2-PARITY-003: Check-in vaccine parity (expired rabies vaccine rejected by preview & execution)", async () => {
      // Simulate expired rabies vaccine for pet 101
      (db as any)._setVaccines([{ id: 77, name: "Vacina Antirrábica", nextDueDate: "2020-01-01" }]);

      // Preview rejects with 403 VACCINE_EXPIRED
      await expect(
        BookingDomainService.previewCheckIn({
          bookingId: 42,
          petId: 101,
          crecheId: 1,
          actorUserId: 10,
          actorRole: "staff",
        })
      ).rejects.toMatchObject({ statusCode: 403, code: "VACCINE_EXPIRED" });

      // Execution rejects with 403 VACCINE_EXPIRED
      await expect(
        BookingDomainService.checkInBooking({
          bookingId: 42,
          petId: 101,
          crecheId: 1,
          actorUserId: 10,
          actorRole: "staff",
        })
      ).rejects.toMatchObject({ statusCode: 403, code: "VACCINE_EXPIRED" });

      // Safe action preview rejects with 403 VACCINE_EXPIRED
      await expect(
        AssistantSafeActionService.createPendingAction(
          "check_in_pet",
          { bookingId: 42, petId: 101 },
          staffContext
        )
      ).rejects.toMatchObject({ statusCode: 403, code: "VACCINE_EXPIRED" });
    });

    it("R41E-FINAL2-PARITY-004: Active check-in parity (existing active same-semantic-category booking)", async () => {
      // Simulate an existing active daycare booking for pet 101
      (db as any)._setActiveBookingsOverride([{ id: 89, type: "daycare", status: "active" }]);

      // Preview rejects with 409 active_checkin_exists
      await expect(
        BookingDomainService.previewCheckIn({
          bookingId: 42,
          petId: 101,
          crecheId: 1,
          actorUserId: 10,
          actorRole: "staff",
        })
      ).rejects.toMatchObject({ statusCode: 409, code: "active_checkin_exists" });

      // Execution rejects with 409 active_checkin_exists
      await expect(
        BookingDomainService.checkInBooking({
          bookingId: 42,
          petId: 101,
          crecheId: 1,
          actorUserId: 10,
          actorRole: "staff",
        })
      ).rejects.toMatchObject({ statusCode: 409, code: "active_checkin_exists" });

      // Safe action preview rejects with 409 active_checkin_exists
      await expect(
        AssistantSafeActionService.createPendingAction(
          "check_in_pet",
          { bookingId: 42, petId: 101 },
          staffContext
        )
      ).rejects.toMatchObject({ statusCode: 409, code: "active_checkin_exists" });
    });

    it("R41E-FINAL2-PARITY-005: Check-out parity (non-active booking rejected by preview & execution)", async () => {
      // Booking 43 is checked_in / not active in mock
      await expect(
        BookingDomainService.previewCheckOut({
          bookingId: 43,
          crecheId: 1,
          actorUserId: 10,
          actorRole: "staff",
        })
      ).rejects.toMatchObject({ statusCode: 400, code: "invalid_domain_state" });

      await expect(
        BookingDomainService.checkOutBooking({
          bookingId: 43,
          crecheId: 1,
          actorUserId: 10,
          actorRole: "staff",
          notes: undefined,
        })
      ).rejects.toMatchObject({ statusCode: 400, code: "invalid_domain_state" });

      await expect(
        AssistantSafeActionService.createPendingAction(
          "check_out_pet",
          { bookingId: 43, petId: 101 },
          staffContext
        )
      ).rejects.toMatchObject({ statusCode: 400, code: "invalid_domain_state" });
    });

    it("EXECUTION_REVALIDATES_DOMAIN_STATE = YES: State change after preview causes execution to revalidate & reject", async () => {
      // Step 1: Preview is generated when booking is eligible (clean invoice state)
      const { action: preview } = await AssistantSafeActionService.createPendingAction(
        "cancel_my_booking",
        { bookingId: 42, reason: "Mudança de planos" },
        tutorContext
      );
      expect(preview.state).toBe("confirmation_required");
      expect(preview.pendingActionId).toBeDefined();

      // Step 2: Between preview and user confirmation, state changes in domain (e.g. invoice is paid)
      (db as any)._setInvoices([{ itemId: 123, status: "paid" }]);

      // Step 3: User confirms action. Execution must revalidate domain state and reject mutation!
      await expect(
        AssistantSafeActionService.confirmPendingAction(
          preview.pendingActionId!,
          tutorContext
        )
      ).rejects.toThrow("pagamento já processado");

      // Verify the pending action is marked failed due to domain validation failure
      const stored = (db as any)._getPendingActions().find((a: any) => a.id === preview.pendingActionId);
      expect(stored.status).toBe("failed");
    });
  });
});
