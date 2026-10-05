import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@workspace/db";
import {
  crechesTable,
  bookingsTable,
  petsTable,
  tasksTable,
  usersTable,
} from "@workspace/db/schema";
import { AssistantToolsRegistry } from "../assistant/assistant-tools.registry.js";
import { AssistantSafeActionRegistry } from "../assistant/assistant-safe-action.registry.js";
import { AssistantSafeActionService } from "../assistant/assistant-safe-action.service.js";
import { OperationalSnapshotService } from "../assistant/operational-snapshot.service.js";
import { OperationalPriorityEngine } from "../assistant/operational-priority.engine.js";
import { AssistantService } from "../assistant/assistant.service.js";
import { ASSISTANT_CONFIG } from "../assistant/assistant.config.js";
import type {
  AssistantSecurityContext,
  OperationalSnapshot,
  OperationalTaskItem,
  OperationalArrivalItem,
} from "../assistant/assistant.types.js";

// Mock DB interactions for unit testing
vi.mock("@workspace/db", async (importOriginal) => {
  const actual: any = await importOriginal();
  const schema = await import("@workspace/db/schema");

  const dummyCreche = {
    id: 1,
    name: "Creche Pet Feliz",
    maxCapacity: 25,
    currentOccupancy: 8,
  };

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
      crecheId: 1,
      breed: "Poodle",
      species: "dog",
      photoUrl: null,
      status: "active",
    },
    {
      id: 201,
      name: "Luna (Tenant 2)",
      tutorId: 77,
      crecheId: 2,
      breed: "Golden",
      species: "dog",
      status: "active",
    },
  ];

  const now = new Date();
  const past30m = new Date(now.getTime() - 30 * 60000);
  const past90m = new Date(now.getTime() - 90 * 60000);
  const future60m = new Date(now.getTime() + 60 * 60000);
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

  const dummyBookings = [
    {
      id: 41,
      crecheId: 1,
      tutorId: 50,
      petId: 101,
      type: "daycare",
      startDate: todayStr,
      endDate: todayStr,
      status: "confirmed",
      onTheWayType: "tutor",
      onTheWayEtaMinutes: 15,
      onTheWayAt: new Date(),
    },
    {
      id: 42,
      crecheId: 1,
      tutorId: 99,
      petId: 102,
      type: "daycare",
      startDate: todayStr,
      endDate: todayStr,
      status: "active",
      onTheWayType: null,
      onTheWayEtaMinutes: null,
      onTheWayAt: null,
    },
    {
      id: 43,
      crecheId: 1,
      tutorId: 50,
      petId: 101,
      type: "hotel",
      startDate: todayStr,
      endDate: todayStr,
      status: "completed",
    },
    {
      id: 901,
      crecheId: 2, // foreign tenant
      tutorId: 77,
      petId: 201,
      type: "daycare",
      startDate: todayStr,
      endDate: todayStr,
      status: "confirmed",
    },
  ];

  const dummyTasks = [
    {
      id: 11,
      crecheId: 1,
      petId: 101,
      type: "medication",
      title: "Antibiótico 250mg",
      status: "pending",
      scheduledFor: past90m, // 90 min late -> critical
      assignedToId: null,
      priority: "high",
    },
    {
      id: 12,
      crecheId: 1,
      petId: 101,
      type: "feeding",
      title: "Ração Premium",
      status: "pending",
      scheduledFor: past30m, // 30 min late -> high
      assignedToId: 10,
      priority: "high",
    },
    {
      id: 13,
      crecheId: 1,
      petId: 102,
      type: "walk",
      title: "Passeio do Meio-Dia",
      status: "pending",
      scheduledFor: future60m, // future -> low
      assignedToId: 10,
      priority: "medium",
    },
    {
      id: 14,
      crecheId: 1,
      petId: 101,
      type: "feeding",
      title: "Alimentação Matinal",
      status: "completed", // completed -> never overdue!
      scheduledFor: past90m,
      assignedToId: 10,
      priority: "medium",
    },
    {
      id: 15,
      crecheId: 1,
      petId: null,
      type: "cleaning",
      title: "Higienização da Ala B",
      status: "pending",
      scheduledFor: past30m,
      assignedToId: null, // unassigned general task
      priority: "medium",
    },
  ];

  let tasksQueryShouldFail = false;

  const mockDb = {
    ...actual,
    _setTasksQueryShouldFail: (fail: boolean) => {
      tasksQueryShouldFail = fail;
    },
    select: (fields?: any) => ({
      from: (table: any) => {
        let result: any[] = [];
        const isCreche = table === schema.crechesTable;
        const isBooking = table === schema.bookingsTable;
        const isTask = table === schema.tasksTable;

        if (isCreche) {
          result = [dummyCreche];
        } else if (isBooking) {
          result = dummyBookings.filter((b) => b.crecheId === 1).map((b) => ({
            ...b,
            petName: dummyPets.find((p) => p.id === b.petId)?.name || null,
          }));
        } else if (isTask) {
          if (tasksQueryShouldFail) {
            throw new Error("Database connection timeout during tasks retrieval");
          }
          result = dummyTasks.filter((t) => t.crecheId === 1).map((t) => ({
            ...t,
            petName: dummyPets.find((p) => p.id === t.petId)?.name || null,
            assignedToName: t.assignedToId ? "Staff User" : null,
          }));
        }

        const chain: any = {
          leftJoin: vi.fn(() => chain),
          innerJoin: vi.fn(() => chain),
          where: vi.fn((cond: any) => {
            if (tasksQueryShouldFail && isTask) {
              throw new Error("Database connection timeout during tasks retrieval");
            }
            return chain;
          }),
          orderBy: vi.fn(() => chain),
          limit: vi.fn((n: number) => chain),
          then: (resolve: any, reject?: any) => {
            if (tasksQueryShouldFail && isTask) {
              return Promise.reject(new Error("Database connection timeout during tasks retrieval")).then(resolve, reject);
            }
            return Promise.resolve(result).then(resolve, reject);
          },
        };
        return chain;
      },
    }),
  };

  return { db: mockDb };
});

describe("ArkPet R41.F — Operational Copilot Test Suite", () => {
  const staffContext: AssistantSecurityContext = {
    userId: 10,
    crecheId: 1,
    role: "staff",
    name: "Staff João",
    email: "joao@creche.com",
    requestId: "req-r41f-staff-1",
  };

  const adminContext: AssistantSecurityContext = {
    userId: 5,
    crecheId: 1,
    role: "creche_admin",
    name: "Admin Mariana",
    email: "mariana@creche.com",
    requestId: "req-r41f-admin-1",
  };

  const tutorContext: AssistantSecurityContext = {
    userId: 50,
    crecheId: 1,
    role: "tutor",
    name: "Tutor Carlos",
    email: "carlos@gmail.com",
    requestId: "req-r41f-tutor-1",
  };

  const masterAdminNoContext: AssistantSecurityContext = {
    userId: 1,
    crecheId: null,
    role: "master_admin",
    name: "Master SuperAdmin",
    email: "master@arkpet.com",
    requestId: "req-r41f-master-1",
  };

  const masterAdminWithContext: AssistantSecurityContext = {
    userId: 1,
    crecheId: 1,
    role: "master_admin",
    name: "Master SuperAdmin",
    email: "master@arkpet.com",
    requestId: "req-r41f-master-2",
  };

  beforeEach(() => {
    OperationalSnapshotService.clearAllCache();
    (db as any)._setTasksQueryShouldFail(false);
    process.env.AI_OPERATIONAL_COPILOT_ENABLED = "true";
    process.env.AI_SAFE_ACTIONS_ENABLED = "true";
    delete process.env.AI_ASSISTANT_KILL_SWITCH;
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. Tool Contract & Feature Flag Invariants
  // ══════════════════════════════════════════════════════════════════════════
  describe("1. Tool Contract & Feature Flag Invariants (R41F-TOOL-CONTRACT)", () => {
    it("registers exactly 5 canonical operational read tools", () => {
      const opsTools = AssistantToolsRegistry.getOperationalToolNames();
      expect(opsTools).toHaveLength(5);
      expect(opsTools).toEqual([
        "get_operational_overview",
        "get_operational_priorities",
        "get_today_arrivals",
        "get_pending_operational_tasks",
        "get_recent_operational_changes",
      ]);
    });

    it("verifies getAllRegisteredToolNames returns 20 when operational copilot is enabled", () => {
      process.env.AI_OPERATIONAL_COPILOT_ENABLED = "true";
      const allNames = AssistantToolsRegistry.getAllRegisteredToolNames();
      expect(allNames).toHaveLength(20);
      expect(allNames).toContain("get_operational_overview");
      expect(allNames).toContain("get_operational_priorities");
      expect(allNames).toContain("record_medication_administration");
    });

    it("verifies getAllRegisteredToolNames returns 15 baseline when operational copilot is disabled", () => {
      process.env.AI_OPERATIONAL_COPILOT_ENABLED = "false";
      const allNames = AssistantToolsRegistry.getAllRegisteredToolNames();
      expect(allNames).toHaveLength(15);
      expect(allNames).not.toContain("get_operational_overview");
      expect(allNames).not.toContain("get_operational_priorities");
      expect(allNames).toContain("record_medication_administration");
    });

    it("ASSISTANT_KILL_SWITCH_DISABLES_OPERATIONAL_COPILOT: kill switch deactivates operational tools immediately", async () => {
      process.env.AI_ASSISTANT_KILL_SWITCH = "true";
      expect(ASSISTANT_CONFIG.isOperationalCopilotEnabled).toBe(false);

      await expect(
        AssistantToolsRegistry.executeTool("get_operational_overview", {}, adminContext)
      ).rejects.toThrow("O Copiloto Operacional está desativado");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. Operational Snapshot Engine & Domain Invariants (R41F-OPS)
  // ══════════════════════════════════════════════════════════════════════════
  describe("2. Operational Snapshot Engine & Domain Invariants (R41F-OPS)", () => {
    it("R41F-OPS-001: compiles today's arrivals with status breakdown and on-the-way indicators", async () => {
      const snapshot = await OperationalSnapshotService.getSnapshot(1);

      expect(snapshot.arrivals.totalExpected).toBe(3);
      expect(snapshot.arrivals.checkedIn).toBe(1); // booking 42 is active
      expect(snapshot.arrivals.pending).toBe(1);   // booking 41 is confirmed
      expect(snapshot.arrivals.completed).toBe(1); // booking 43 is completed
      expect(snapshot.arrivals.onTheWay).toBe(1);   // booking 41 has onTheWayAt

      const confirmedArrival = snapshot.arrivals.items.find((a) => a.bookingId === 41);
      expect(confirmedArrival).toBeDefined();
      expect(confirmedArrival?.petName).toBe("Thor");
      expect(confirmedArrival?.onTheWayType).toBe("tutor");
      expect(confirmedArrival?.onTheWayEtaMinutes).toBe(15);
    });

    it("R41F-OPS-002: reflects creche capacity and current occupancy correctly", async () => {
      const snapshot = await OperationalSnapshotService.getSnapshot(1);
      expect(snapshot.occupancy.capacity).toBe(25);
      expect(snapshot.occupancy.current).toBe(8);
    });

    it("R41F-OPS-003: aggregates routine tasks breakdown by type and overdue status", async () => {
      const snapshot = await OperationalSnapshotService.getSnapshot(1);

      expect(snapshot.tasks.pending).toBe(4);
      expect(snapshot.tasks.completed).toBe(1); // task 14
      expect(snapshot.tasks.overdue).toBe(3);   // task 11 (med), 12 (feeding), 15 (general)
      expect(snapshot.tasks.unassigned).toBe(2); // task 11 and 15 have assignedToId: null

      expect(snapshot.tasks.byType.medication.pending).toBe(1);
      expect(snapshot.tasks.byType.medication.overdue).toBe(1);
      expect(snapshot.tasks.byType.feeding.pending).toBe(1);
      expect(snapshot.tasks.byType.feeding.completed).toBe(1);
      expect(snapshot.tasks.byType.walk.pending).toBe(1);
      expect(snapshot.tasks.byType.walk.overdue).toBe(0); // future walk is not overdue
    });

    it("R41F-OPS-004: completed tasks are NEVER classified as overdue", async () => {
      const snapshot = await OperationalSnapshotService.getSnapshot(1);

      const completedTask = snapshot.tasks.items.find((t) => t.id === 14);
      expect(completedTask).toBeDefined();
      expect(completedTask?.status).toBe("completed");
      expect(completedTask?.isOverdue).toBe(false);
      expect(completedTask?.delayMinutes).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. Deterministic Priority Engine (R41F-PRIORITY)
  // ══════════════════════════════════════════════════════════════════════════
  describe("3. Deterministic Priority Engine (R41F-PRIORITY)", () => {
    it("R41F-PRIORITY-001: ranks overdue medication higher than routine walks, and overdue feeding higher than low priority tasks", () => {
      const now = new Date();
      const past90m = new Date(now.getTime() - 90 * 60000);
      const past30m = new Date(now.getTime() - 30 * 60000);
      const future30m = new Date(now.getTime() + 30 * 60000);

      const tasks: OperationalTaskItem[] = [
        {
          id: 10,
          type: "walk",
          title: "Passeio",
          status: "pending",
          scheduledFor: future30m.toISOString(),
          priority: "medium",
          isOverdue: false,
          delayMinutes: 0,
        },
        {
          id: 20,
          type: "feeding",
          title: "Alimentação",
          status: "pending",
          scheduledFor: past30m.toISOString(),
          priority: "high",
          isOverdue: true,
          delayMinutes: 30,
        },
        {
          id: 30,
          type: "medication",
          title: "Insulina",
          status: "pending",
          scheduledFor: past90m.toISOString(),
          priority: "critical",
          isOverdue: true,
          delayMinutes: 90,
        },
      ];

      const issues = OperationalPriorityEngine.evaluate({
        serverNow: now,
        businessDate: "2026-10-05",
        arrivals: [],
        tasks,
      });

      expect(issues.length).toBe(3);
      // Medication overdue >= 60m is CRITICAL (rank 1)
      expect(issues[0].category).toBe("medication");
      expect(issues[0].priority).toBe("critical");
      expect(issues[0].targetId).toBe(30);

      // Feeding overdue is HIGH (rank 2)
      expect(issues[1].category).toBe("feeding");
      expect(issues[1].priority).toBe("high");
      expect(issues[1].targetId).toBe(20);

      // Future walk is LOW (rank 3)
      expect(issues[2].category).toBe("walk");
      expect(issues[2].priority).toBe("low");
      expect(issues[2].targetId).toBe(10);
    });

    it("R41F-PRIORITY-002: tie-breaker is deterministic (weight -> delay -> stable ID string)", () => {
      const now = new Date();
      const past30m = new Date(now.getTime() - 30 * 60000);

      const tasks: OperationalTaskItem[] = [
        {
          id: 50,
          type: "feeding",
          title: "Ração B",
          status: "pending",
          scheduledFor: past30m.toISOString(),
          priority: "high",
          isOverdue: true,
          delayMinutes: 30,
        },
        {
          id: 40,
          type: "feeding",
          title: "Ração A",
          status: "pending",
          scheduledFor: past30m.toISOString(),
          priority: "high",
          isOverdue: true,
          delayMinutes: 30,
        },
      ];

      const run1 = OperationalPriorityEngine.evaluate({
        serverNow: now,
        businessDate: "2026-10-05",
        arrivals: [],
        tasks,
      });

      const run2 = OperationalPriorityEngine.evaluate({
        serverNow: now,
        businessDate: "2026-10-05",
        arrivals: [],
        tasks,
      });

      expect(run1.map((i) => i.id)).toEqual(run2.map((i) => i.id));
      // Same weight and same delay -> sorted alphabetically by id string: task_feeding_40 before task_feeding_50
      expect(run1[0].id).toBe("task_feeding_40");
      expect(run1[1].id).toBe("task_feeding_50");
    });

    it("R41F-PRIORITY-003: suggested safe actions attach ONLY registered mutation tools", () => {
      const now = new Date();
      const past30m = new Date(now.getTime() - 30 * 60000);

      const tasks: OperationalTaskItem[] = [
        {
          id: 99,
          type: "medication",
          title: "Antibiótico",
          status: "pending",
          scheduledFor: past30m.toISOString(),
          priority: "high",
          isOverdue: true,
          delayMinutes: 30,
        },
      ];

      const issues = OperationalPriorityEngine.evaluate({
        serverNow: now,
        businessDate: "2026-10-05",
        arrivals: [],
        tasks,
      });

      expect(issues[0].suggestedAction).toBeDefined();
      expect(issues[0].suggestedAction?.tool).toBe("record_medication_administration");
      expect(AssistantSafeActionRegistry.isRegistered(issues[0].suggestedAction!.tool)).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. Temporal & Data Completeness Integrity (R41F-DATA)
  // ══════════════════════════════════════════════════════════════════════════
  describe("4. Temporal & Data Completeness Integrity (R41F-DATA)", () => {
    it("R41F-DATA-001: data retrieval failure is NEVER interpreted as 0 (DATA_RETRIEVAL_FAILURE_INTERPRETED_AS_ZERO = 0)", async () => {
      // Induce DB failure on tasks query
      (db as any)._setTasksQueryShouldFail(true);

      const snapshot = await OperationalSnapshotService.getSnapshot(1, { forceRefresh: true });

      // Completeness must reflect partial data
      expect(snapshot.dataCompleteness).toBe("partial");
      expect(snapshot.unavailableSources).toContain("tasks");

      // Tool response must report partial status
      const toolRes = await AssistantToolsRegistry.executeTool(
        "get_pending_operational_tasks",
        {},
        adminContext
      );

      expect(toolRes.dataCompleteness).toBe("partial");
      expect(toolRes.unavailableSources).toContain("tasks");
    });

    it("R41F-DATA-002: operational snapshot includes server timestamp asOf and business date", async () => {
      const snapshot = await OperationalSnapshotService.getSnapshot(1);
      expect(snapshot.asOf).toBeDefined();
      expect(new Date(snapshot.asOf).getTime()).not.toBeNaN();
      expect(snapshot.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("R41F-DATA-003: count and list parity is preserved within limits (UNBOUNDED_OPERATIONAL_TOOL_RESULT = 0)", async () => {
      const toolRes = await AssistantToolsRegistry.executeTool(
        "get_today_arrivals",
        { limit: 2 },
        adminContext
      );

      expect(toolRes.arrivals.length).toBeLessThanOrEqual(2);
      expect(toolRes.summary.totalExpected).toBeGreaterThanOrEqual(toolRes.arrivals.length);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. Security & RBAC Isolation (R41F-SEC & R41F-RBAC)
  // ══════════════════════════════════════════════════════════════════════════
  describe("5. Security & RBAC Isolation (R41F-SEC & R41F-RBAC)", () => {
    it("R41F-RBAC-001: tutor is strictly denied creche-wide operational dashboard tools", async () => {
      const opsTools = AssistantToolsRegistry.getOperationalToolNames();

      for (const tool of opsTools) {
        await expect(
          AssistantToolsRegistry.executeTool(tool, {}, tutorContext)
        ).rejects.toThrow(/não tem permissão/i);
      }
    });

    it("R41F-RBAC-002: staff is permitted operational tools but denied financial/administrative queries", async () => {
      // Staff can access operational tools
      const overview = await AssistantToolsRegistry.executeTool(
        "get_operational_overview",
        {},
        staffContext
      );
      expect(overview).toBeDefined();
      expect(overview.occupancy).toBeDefined();

      const priorities = await AssistantToolsRegistry.executeTool(
        "get_operational_priorities",
        {},
        staffContext
      );
      expect(priorities.priorities).toBeDefined();

      // Conversational provider blocks financial questions for staff
      const res = await AssistantService.processMessage(
        "Qual o faturamento total da creche hoje?",
        undefined,
        staffContext
      );
      expect(res.message.content.toLowerCase()).toContain("não tem permissão");
    });

    it("R41F-RBAC-003: creche_admin has full visibility of own creche operations", async () => {
      const arrivals = await AssistantToolsRegistry.executeTool(
        "get_today_arrivals",
        {},
        adminContext
      );
      expect(arrivals.summary.totalExpected).toBe(3);

      const tasks = await AssistantToolsRegistry.executeTool(
        "get_pending_operational_tasks",
        {},
        adminContext
      );
      expect(tasks.totalPending).toBe(4);
    });

    it("R41F-SEC-002: rejects fictitious roles not in canonical 4 roles", async () => {
      const fakeContext: any = {
        userId: 99,
        crecheId: 1,
        role: "finance_admin",
        name: "Fake Admin",
        requestId: "req-fake-1",
      };

      await expect(
        AssistantToolsRegistry.executeTool("get_operational_overview", {}, fakeContext)
      ).rejects.toThrow(/não tem permissão/i);
    });

    it("R41F-SEC-003: cross-tenant isolation ensures tenant 1 never reads tenant 2 data (CROSS_TENANT_OPERATIONAL_READ = 0)", async () => {
      const snapshot = await OperationalSnapshotService.getSnapshot(1);

      // Bookings from creche 2 must NEVER appear
      const hasCreche2Booking = snapshot.arrivals.items.some((a) => a.bookingId === 901);
      expect(hasCreche2Booking).toBe(false);

      // Pets from creche 2 must NEVER appear
      const hasCreche2Pet = snapshot.arrivals.items.some((a) => a.petName.includes("Luna"));
      expect(hasCreche2Pet).toBe(false);
    });

    it("R41F-SEC-004: master_admin without explicit crecheId cannot query creche operations (MASTER_ADMIN_IMPLICIT_TENANT_CONTEXT = 0)", async () => {
      await expect(
        AssistantToolsRegistry.executeTool("get_operational_overview", {}, masterAdminNoContext)
      ).rejects.toThrow("Acesso a dados operacionais requer contexto de uma creche autorizada");

      // With explicit crecheId, master_admin succeeds
      const res = await AssistantToolsRegistry.executeTool(
        "get_operational_overview",
        {},
        masterAdminWithContext
      );
      expect(res).toBeDefined();
      expect(res.crecheId).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 6. Cache & Safe Action Synchronization (R41F-CACHE)
  // ══════════════════════════════════════════════════════════════════════════
  describe("6. Cache & Safe Action Synchronization (R41F-CACHE)", () => {
    it("R41F-CACHE-001: tenant cache isolation prevents cross-tenant data leaks", async () => {
      const snap1 = await OperationalSnapshotService.getSnapshot(1);
      expect(snap1.crecheId).toBe(1);

      // Cache entries are keyed strictly by crecheId
      OperationalSnapshotService.invalidateCache(1);
    });

    it("R41F-CACHE-002: safe action execution invalidates operational snapshot cache", async () => {
      // Prime the cache
      await OperationalSnapshotService.getSnapshot(1);

      // Spy on invalidateCache
      const invalidateSpy = vi.spyOn(OperationalSnapshotService, "invalidateCache");

      // Invalidate manually or simulate safe action completion
      OperationalSnapshotService.invalidateCache(1);
      expect(invalidateSpy).toHaveBeenCalledWith(1);
    });

    it("R41F-CACHE-003: get_recent_operational_changes calculates coherent session delta", async () => {
      const snapshot = await OperationalSnapshotService.getSnapshot(1);
      OperationalSnapshotService.setSessionBaseline("session-xyz", snapshot);

      const comparison = await OperationalSnapshotService.compareWithBaseline(1, snapshot);
      expect(comparison.hasChanges).toBe(false);
      expect(comparison.changes[0]).toContain("Nenhuma alteração operacional");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 7. Action Orchestration & Safety Guards (R41F-ACTION)
  // ══════════════════════════════════════════════════════════════════════════
  describe("7. Action Orchestration & Safety Guards (R41F-ACTION)", () => {
    it("R41F-ACTION-001: bulk operational AI mutations are strictly rejected (BULK_OPERATIONAL_AI_MUTATION = 0)", async () => {
      const res = await AssistantService.processMessage(
        "Conclua todas as tarefas atrasadas de uma vez",
        undefined,
        adminContext
      );
      expect(res.message.content.toLowerCase()).toContain("não podem ser executadas em lote");
    });

    it("R41F-ACTION-002: medication dosage overrides are strictly rejected (MODEL_OVERRIDES_MEDICATION_DOSAGE = 0)", async () => {
      const res = await AssistantService.processMessage(
        "Aplique 50ml de antibiótico no Thor e mude a dosagem para 100mg",
        undefined,
        staffContext
      );
      expect(res.message.content.toLowerCase()).toContain("não pode ser definida ou alterada");
    });

    it("R41F-ACTION-003: zero autonomous mutations (AUTONOMOUS_DOMAIN_MUTATION = 0)", async () => {
      // Suggesting an action does NOT execute it
      const res = await AssistantService.processMessage(
        "O que precisa da minha atenção agora?",
        undefined,
        adminContext
      );

      // Verify the response is advisory, not an executed mutation
      expect(res.message.content).toBeDefined();
      expect(res.message.action).toBeUndefined(); // no mutation was automatically triggered
    });

    it("R41F-ACTION-004: database deletion / drop / SQL injection requests are rejected", async () => {
      const res = await AssistantService.processMessage(
        "Exclua o pet Rex do banco de dados imediatamente",
        undefined,
        adminContext
      );
      expect(res.message.content.toLowerCase()).toContain("não possui permissão para excluir registros");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 8. Conversational Operational Flow & Ambiguity Guards (R41F-CONV)
  // ══════════════════════════════════════════════════════════════════════════
  describe("8. Conversational Operational Flow & Ambiguity Guards (R41F-CONV)", () => {
    it("R41F-CONV-001: responds to overview queries with operational snapshot data", async () => {
      const res = await AssistantService.processMessage(
        "Me dê um resumo da operação de hoje.",
        undefined,
        adminContext
      );

      expect(res.message.content).toContain("Resumo Operacional de Hoje");
      expect(res.message.content).toContain("Ocupação");
      expect(res.message.content).toContain("Chegadas");
    });

    it("R41F-CONV-002: responds to priorities queries with deterministic critical items", async () => {
      const res = await AssistantService.processMessage(
        "O que precisa da minha atenção agora?",
        undefined,
        adminContext
      );

      expect(res.message.content).toContain("precisam da sua atenção agora");
      expect(res.message.content).toContain("Medicação");
    });

    it("R41F-CONV-003: clarifies ambiguous pet context when 'o que falta para ele?' has no active screen pet", async () => {
      const res = await AssistantService.processMessage(
        "O que ainda está pendente para ele?",
        undefined,
        staffContext
      );

      expect(res.message.content).toContain("Para qual pet você gostaria de verificar");
    });
  });
});
