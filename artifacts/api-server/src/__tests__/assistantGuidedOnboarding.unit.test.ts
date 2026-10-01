import { describe, it, expect, vi, beforeEach } from "vitest";
import { AssistantToolsRegistry } from "../assistant/assistant-tools.registry.js";
import { AssistantGuidanceService } from "../assistant/assistant-guidance.service.js";
import { AssistantService } from "../assistant/assistant.service.js";
import { AssistantAuditService } from "../assistant/assistant-audit.service.js";
import { ASSISTANT_CONFIG } from "../assistant/assistant.config.js";
import { getCrecheOnboardingHandler } from "../routes/creches.js";
import * as onboardingService from "../services/onboarding.service.js";
import {
  getCanonicalOnboardingStatus,
  CANONICAL_ONBOARDING_STEP_IDS,
} from "../services/onboarding.service.js";
import type {
  AssistantSecurityContext,
  GuidedOnboardingStatus,
} from "../assistant/assistant.types.js";

import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

// Mock DB module
vi.mock("@workspace/db", () => {
  return {
    db: {
      select: vi.fn(),
    },
  };
});

import { db } from "@workspace/db";

describe("ArkPet R41.B — AI Guided Onboarding Unit Tests", () => {
  const dialect = new PgDialect();

  const crecheAdminContext: AssistantSecurityContext = {
    userId: 10,
    role: "creche_admin",
    crecheId: 1,
    name: "Admin Maria",
    email: "maria@creche.com",
    requestId: "req-r41b-001",
  };

  const tutorContext: AssistantSecurityContext = {
    userId: 50,
    role: "tutor",
    crecheId: 1,
    name: "Tutor João",
    email: "joao@tutor.com",
    requestId: "req-r41b-002",
  };

  const staffContext: AssistantSecurityContext = {
    userId: 20,
    role: "staff",
    crecheId: 1,
    name: "Staff Pedro",
    email: "pedro@staff.com",
    requestId: "req-r41b-003",
  };

  const masterAdminContext: AssistantSecurityContext = {
    userId: 999,
    role: "master_admin",
    crecheId: null,
    name: "Master Operator",
    email: "master@arkpet.test",
    requestId: "req-r41b-004",
  };

  function createMockRes() {
    const res: any = {
      statusCode: 200,
      body: null,
      status: vi.fn((code: number) => {
        res.statusCode = code;
        return res;
      }),
      json: vi.fn((data: any) => {
        res.body = data;
        return res;
      }),
    };
    return res;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Helper to mock DB onboarding query responses ──
  function setupDbMocks(state: {
    phone?: string | null;
    address?: string | null;
    staffCount?: number;
    tutorsCount?: number;
    petsCount?: number;
    bookingsCount?: number;
    crecheExists?: boolean;
  }) {
    (db.select as any).mockImplementation((fields?: any) => {
      let targetTable = "";
      let whereCondition: any = null;

      const chain: any = {
        from: (tableObj: any) => {
          try {
            targetTable = getTableName(tableObj);
          } catch {
            targetTable = tableObj?._?.name || tableObj?.name || "";
          }
          return chain;
        },
        where: (condition: any) => {
          whereCondition = condition;
          return chain;
        },
        limit: vi.fn(async () => {
          if (state.crecheExists === false) return [];
          return [
            {
              id: 1,
              name: "Creche Paws",
              phone: state.phone ?? null,
              address: state.address ?? null,
            },
          ];
        }),
        execute: async () => chain.resolve(),
        then: (resolve: any, reject: any) => chain.resolve().then(resolve, reject),
        resolve: async () => {
          let sqlStr = "";
          let paramValues: string[] = [];
          if (whereCondition && typeof whereCondition.getSQL === "function") {
            try {
              const query = dialect.sqlToQuery(whereCondition.getSQL());
              sqlStr = query.sql.toLowerCase();
              paramValues = (query.params || []).map((p: any) => String(p).toLowerCase());
            } catch {
              sqlStr = "";
              paramValues = [];
            }
          }

          if (targetTable === "creches" || (!fields || !fields.count)) {
            if (state.crecheExists === false) return [];
            return [
              {
                id: 1,
                name: "Creche Paws",
                phone: state.phone ?? null,
                address: state.address ?? null,
              },
            ];
          }

          if (targetTable === "users") {
            const hasTutor = sqlStr.includes("tutor") || paramValues.includes("tutor");
            if (hasTutor) {
              return [{ count: state.tutorsCount ?? 0 }];
            }
            return [{ count: state.staffCount ?? 0 }];
          }

          if (targetTable === "pets") {
            return [{ count: state.petsCount ?? 0 }];
          }

          if (targetTable === "bookings") {
            return [{ count: state.bookingsCount ?? 0 }];
          }

          return [{ count: 0 }];
        },
      };

      return chain;
    });
  }

  // ────────────────────────────────────────────────────────────
  // 1. CANONICAL PARITY & SINGLE SOURCE OF TRUTH (R41B-CANONICAL-001..007)
  // ────────────────────────────────────────────────────────────
  describe("R41B-CANONICAL: Canonical Parity & Single Source of Truth", () => {
    it("R41B-CANONICAL-001: canonical endpoint and assistant tool agree on step IDs, completion state, completed count, total steps, isComplete", async () => {
      setupDbMocks({
        phone: "(11) 99999-9999",
        address: "Rua das Flores, 123",
        staffCount: 2,
        tutorsCount: 1,
        petsCount: 1,
        bookingsCount: 1,
      });

      // 1. Canonical Endpoint
      const req: any = { params: { crecheId: "1" }, user: crecheAdminContext };
      const res = createMockRes();
      await getCrecheOnboardingHandler(req, res, db);

      // 2. Assistant Tool
      const assistantResult = await AssistantToolsRegistry.executeTool(
        "get_onboarding_status",
        {},
        crecheAdminContext
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.crecheId).toBe(assistantResult.crecheId);
      expect(res.body.totalSteps).toBe(assistantResult.totalSteps);
      expect(res.body.completedCount).toBe(assistantResult.completedCount);
      expect(res.body.isComplete).toBe(assistantResult.isComplete);

      // Agree on step IDs and completion states
      for (let i = 0; i < 5; i++) {
        expect(res.body.steps[i].id).toBe(assistantResult.steps[i].id);
        expect(res.body.steps[i].completed).toBe(assistantResult.steps[i].completed);
      }
    });

    it("ASSISTANT_DUPLICATE_ONBOARDING_STATE = 0: proves assistant onboarding consumes shared canonical service", async () => {
      setupDbMocks({
        phone: "(11) 99999-9999",
        address: "Rua das Flores, 123",
        staffCount: 2,
        tutorsCount: 1,
        petsCount: 1,
        bookingsCount: 1,
      });

      const spy = vi.spyOn(onboardingService, "getCanonicalOnboardingStatus");
      const status = await AssistantToolsRegistry.getOnboardingStatus(1);

      expect(spy).toHaveBeenCalledWith(1);
      expect(status.steps).toHaveLength(5);
      expect(status.progressPercent).toBe(100);
    });

    it("R41B-CANONICAL-002: creche_details parity — missing phone OR address is incomplete, both present is complete", async () => {
      // Incomplete: phone only
      setupDbMocks({ phone: "1199999999", address: null, staffCount: 1, tutorsCount: 0, petsCount: 0, bookingsCount: 0 });
      const req1: any = { params: { crecheId: "1" }, user: crecheAdminContext };
      const res1 = createMockRes();
      await getCrecheOnboardingHandler(req1, res1, db);
      const assistant1 = await AssistantToolsRegistry.getOnboardingStatus(1);

      expect(res1.body.steps.find((s: any) => s.id === "creche_details").completed).toBe(false);
      expect(assistant1.steps.find((s) => s.id === "creche_details")?.completed).toBe(false);

      // Complete: phone + address
      setupDbMocks({ phone: "1199999999", address: "Rua 1", staffCount: 1, tutorsCount: 0, petsCount: 0, bookingsCount: 0 });
      const req2: any = { params: { crecheId: "1" }, user: crecheAdminContext };
      const res2 = createMockRes();
      await getCrecheOnboardingHandler(req2, res2, db);
      const assistant2 = await AssistantToolsRegistry.getOnboardingStatus(1);

      expect(res2.body.steps.find((s: any) => s.id === "creche_details").completed).toBe(true);
      expect(assistant2.steps.find((s) => s.id === "creche_details")?.completed).toBe(true);
    });

    it("R41B-CANONICAL-003: staff parity — staffMembersCount > 1 rule enforced identically", async () => {
      // staffCount = 1 (admin only) -> incomplete
      setupDbMocks({ phone: "1199999999", address: "Rua 1", staffCount: 1, tutorsCount: 0, petsCount: 0, bookingsCount: 0 });
      const req1: any = { params: { crecheId: "1" }, user: crecheAdminContext };
      const res1 = createMockRes();
      await getCrecheOnboardingHandler(req1, res1, db);
      const assistant1 = await AssistantToolsRegistry.getOnboardingStatus(1);

      expect(res1.body.steps.find((s: any) => s.id === "staff").completed).toBe(false);
      expect(assistant1.steps.find((s) => s.id === "staff")?.completed).toBe(false);

      // staffCount = 2 (admin + 1 staff) -> complete
      setupDbMocks({ phone: "1199999999", address: "Rua 1", staffCount: 2, tutorsCount: 0, petsCount: 0, bookingsCount: 0 });
      const req2: any = { params: { crecheId: "1" }, user: crecheAdminContext };
      const res2 = createMockRes();
      await getCrecheOnboardingHandler(req2, res2, db);
      const assistant2 = await AssistantToolsRegistry.getOnboardingStatus(1);

      expect(res2.body.steps.find((s: any) => s.id === "staff").completed).toBe(true);
      expect(assistant2.steps.find((s) => s.id === "staff")?.completed).toBe(true);
    });

    it("R41B-CANONICAL-004: tutor parity — tutorsCount > 0 rule enforced identically", async () => {
      // tutorsCount = 0 -> incomplete
      setupDbMocks({ phone: "1199999999", address: "Rua 1", staffCount: 2, tutorsCount: 0, petsCount: 0, bookingsCount: 0 });
      const req1: any = { params: { crecheId: "1" }, user: crecheAdminContext };
      const res1 = createMockRes();
      await getCrecheOnboardingHandler(req1, res1, db);
      const assistant1 = await AssistantToolsRegistry.getOnboardingStatus(1);

      expect(res1.body.steps.find((s: any) => s.id === "tutors").completed).toBe(false);
      expect(assistant1.steps.find((s) => s.id === "tutors")?.completed).toBe(false);

      // tutorsCount = 1 -> complete
      setupDbMocks({ phone: "1199999999", address: "Rua 1", staffCount: 2, tutorsCount: 1, petsCount: 0, bookingsCount: 0 });
      const req2: any = { params: { crecheId: "1" }, user: crecheAdminContext };
      const res2 = createMockRes();
      await getCrecheOnboardingHandler(req2, res2, db);
      const assistant2 = await AssistantToolsRegistry.getOnboardingStatus(1);

      expect(res2.body.steps.find((s: any) => s.id === "tutors").completed).toBe(true);
      expect(assistant2.steps.find((s) => s.id === "tutors")?.completed).toBe(true);
    });

    it("R41B-CANONICAL-005: pet parity — petsCount > 0 rule enforced identically", async () => {
      // petsCount = 0 -> incomplete
      setupDbMocks({ phone: "1199999999", address: "Rua 1", staffCount: 2, tutorsCount: 1, petsCount: 0, bookingsCount: 0 });
      const req1: any = { params: { crecheId: "1" }, user: crecheAdminContext };
      const res1 = createMockRes();
      await getCrecheOnboardingHandler(req1, res1, db);
      const assistant1 = await AssistantToolsRegistry.getOnboardingStatus(1);

      expect(res1.body.steps.find((s: any) => s.id === "pets").completed).toBe(false);
      expect(assistant1.steps.find((s) => s.id === "pets")?.completed).toBe(false);

      // petsCount = 1 -> complete
      setupDbMocks({ phone: "1199999999", address: "Rua 1", staffCount: 2, tutorsCount: 1, petsCount: 1, bookingsCount: 0 });
      const req2: any = { params: { crecheId: "1" }, user: crecheAdminContext };
      const res2 = createMockRes();
      await getCrecheOnboardingHandler(req2, res2, db);
      const assistant2 = await AssistantToolsRegistry.getOnboardingStatus(1);

      expect(res2.body.steps.find((s: any) => s.id === "pets").completed).toBe(true);
      expect(assistant2.steps.find((s) => s.id === "pets")?.completed).toBe(true);
    });

    it("R41B-CANONICAL-006: booking parity — bookingsCount > 0 rule enforced identically", async () => {
      // bookingsCount = 0 -> incomplete
      setupDbMocks({ phone: "1199999999", address: "Rua 1", staffCount: 2, tutorsCount: 1, petsCount: 1, bookingsCount: 0 });
      const req1: any = { params: { crecheId: "1" }, user: crecheAdminContext };
      const res1 = createMockRes();
      await getCrecheOnboardingHandler(req1, res1, db);
      const assistant1 = await AssistantToolsRegistry.getOnboardingStatus(1);

      expect(res1.body.steps.find((s: any) => s.id === "bookings").completed).toBe(false);
      expect(assistant1.steps.find((s) => s.id === "bookings")?.completed).toBe(false);

      // bookingsCount = 1 -> complete
      setupDbMocks({ phone: "1199999999", address: "Rua 1", staffCount: 2, tutorsCount: 1, petsCount: 1, bookingsCount: 1 });
      const req2: any = { params: { crecheId: "1" }, user: crecheAdminContext };
      const res2 = createMockRes();
      await getCrecheOnboardingHandler(req2, res2, db);
      const assistant2 = await AssistantToolsRegistry.getOnboardingStatus(1);

      expect(res2.body.steps.find((s: any) => s.id === "bookings").completed).toBe(true);
      expect(assistant2.steps.find((s) => s.id === "bookings")?.completed).toBe(true);
    });

    it("R41B-CANONICAL-007: complete parity — all five complete reports 100% and isComplete=true in both", async () => {
      setupDbMocks({
        phone: "(11) 99999-9999",
        address: "Rua das Flores, 123",
        staffCount: 3,
        tutorsCount: 2,
        petsCount: 4,
        bookingsCount: 2,
      });

      const req: any = { params: { crecheId: "1" }, user: crecheAdminContext };
      const res = createMockRes();
      await getCrecheOnboardingHandler(req, res, db);
      const assistant = await AssistantToolsRegistry.getOnboardingStatus(1);

      expect(res.body.isComplete).toBe(true);
      expect(res.body.completedCount).toBe(5);
      expect(assistant.isComplete).toBe(true);
      expect(assistant.completedCount).toBe(5);
      expect(assistant.progressPercent).toBe(100);
      expect(assistant.pendingSteps).toHaveLength(0);
      expect(assistant.currentStep).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────
  // 2. STRICT RBAC ALIGNMENT (R41B-RBAC-001..005)
  // ────────────────────────────────────────────────────────────
  describe("R41B-RBAC: Strict Role-Based Access Control Alignment", () => {
    it("R41B-RBAC-001: Master Admin attempts get_onboarding_status and get_guided_onboarding_plan are both denied", async () => {
      await expect(
        AssistantToolsRegistry.executeTool("get_onboarding_status", {}, masterAdminContext)
      ).rejects.toThrow(/Acesso negado/);

      await expect(
        AssistantToolsRegistry.executeTool("get_guided_onboarding_plan", {}, masterAdminContext)
      ).rejects.toThrow(/Acesso negado/);
    });

    it("R41B-RBAC-002: Own tenant creche_admin is allowed", async () => {
      setupDbMocks({ phone: "1199999999", address: "Rua 1", staffCount: 2, tutorsCount: 1, petsCount: 1, bookingsCount: 1 });

      const status = await AssistantToolsRegistry.executeTool(
        "get_onboarding_status",
        {},
        crecheAdminContext
      );
      expect(status).toBeDefined();
      expect(status.crecheId).toBe(1);

      const plan = await AssistantToolsRegistry.executeTool(
        "get_guided_onboarding_plan",
        { currentRoute: "/" },
        crecheAdminContext
      );
      expect(plan).toBeDefined();
      expect(plan.content).toBeDefined();
    });

    it("R41B-RBAC-003: Staff role is denied", async () => {
      await expect(
        AssistantToolsRegistry.executeTool("get_onboarding_status", {}, staffContext)
      ).rejects.toThrow(/Acesso negado/);

      await expect(
        AssistantToolsRegistry.executeTool("get_guided_onboarding_plan", {}, staffContext)
      ).rejects.toThrow(/Acesso negado/);
    });

    it("R41B-RBAC-004: Tutor role is denied", async () => {
      await expect(
        AssistantToolsRegistry.executeTool("get_onboarding_status", {}, tutorContext)
      ).rejects.toThrow(/Acesso negado/);

      await expect(
        AssistantToolsRegistry.executeTool("get_guided_onboarding_plan", {}, tutorContext)
      ).rejects.toThrow(/Acesso negado/);
    });

    it("R41B-RBAC-005: Cross-tenant access is denied", async () => {
      const crossTenantContext: AssistantSecurityContext = {
        ...crecheAdminContext,
        crecheId: null,
      };

      await expect(
        AssistantToolsRegistry.executeTool("get_onboarding_status", {}, crossTenantContext)
      ).rejects.toThrow("Usuário não está associado a nenhuma creche");

      await expect(
        AssistantToolsRegistry.executeTool("get_guided_onboarding_plan", {}, crossTenantContext)
      ).rejects.toThrow("Usuário não está associado a nenhuma creche");
    });
  });

  // ────────────────────────────────────────────────────────────
  // 3. STEP PROGRESSION & ENRICHMENT
  // ────────────────────────────────────────────────────────────
  describe("R41B-ONBOARD: Progression & Enrichment", () => {
    it("R41B-ONBOARD-001: returns all 5 canonical steps with target identifiers", async () => {
      setupDbMocks({
        phone: "(11) 99999-9999",
        address: "Rua das Flores, 123",
        staffCount: 2,
        tutorsCount: 1,
        petsCount: 1,
        bookingsCount: 1,
      });

      const status = await AssistantToolsRegistry.getOnboardingStatus(1);

      expect(status.steps).toHaveLength(5);
      expect(status.steps.map((s) => s.id)).toEqual([
        "creche_details",
        "staff",
        "tutors",
        "pets",
        "bookings",
      ]);
      expect(status.steps.map((s) => s.target)).toEqual([
        "creche-profile-form",
        "staff-create-button",
        "tutor-create-button",
        "pet-create-button",
        "booking-create-button",
      ]);
      expect(status.isComplete).toBe(true);
      expect(status.progressPercent).toBe(100);
      expect(status.completedSteps).toHaveLength(5);
      expect(status.pendingSteps).toHaveLength(0);
      expect(status.currentStep).toBeNull();
    });

    it("R41B-ONBOARD-002: identifies Step 1 (creche_details) as pending when phone/address missing", async () => {
      setupDbMocks({
        phone: null,
        address: null,
        staffCount: 1,
        tutorsCount: 0,
        petsCount: 0,
        bookingsCount: 0,
      });

      const status = await AssistantToolsRegistry.getOnboardingStatus(1);

      expect(status.isComplete).toBe(false);
      expect(status.currentStep?.id).toBe("creche_details");
      expect(status.currentStep?.route).toBe("/settings");
      expect(status.currentStep?.target).toBe("creche-profile-form");
      expect(status.progressPercent).toBe(0);
    });

    it("R41B-ONBOARD-003: identifies Step 2 (staff) as pending when staff count <= 1", async () => {
      setupDbMocks({
        phone: "(11) 99999-9999",
        address: "Rua das Flores, 123",
        staffCount: 1, // Only admin
        tutorsCount: 0,
        petsCount: 0,
        bookingsCount: 0,
      });

      const status = await AssistantToolsRegistry.getOnboardingStatus(1);

      expect(status.isComplete).toBe(false);
      expect(status.currentStep?.id).toBe("staff");
      expect(status.currentStep?.route).toBe("/staff/manage");
      expect(status.currentStep?.target).toBe("staff-create-button");
      expect(status.progressPercent).toBe(20);
    });

    it("R41B-ONBOARD-004: identifies Step 3 (tutors) as pending when tutors count == 0", async () => {
      setupDbMocks({
        phone: "(11) 99999-9999",
        address: "Rua das Flores, 123",
        staffCount: 2,
        tutorsCount: 0,
        petsCount: 0,
        bookingsCount: 0,
      });

      const status = await AssistantToolsRegistry.getOnboardingStatus(1);

      expect(status.isComplete).toBe(false);
      expect(status.currentStep?.id).toBe("tutors");
      expect(status.currentStep?.route).toBe("/tutors");
      expect(status.currentStep?.target).toBe("tutor-create-button");
      expect(status.progressPercent).toBe(40);
    });

    it("R41B-ONBOARD-005: identifies Step 4 (pets) as pending when pets count == 0", async () => {
      setupDbMocks({
        phone: "(11) 99999-9999",
        address: "Rua das Flores, 123",
        staffCount: 2,
        tutorsCount: 1,
        petsCount: 0,
        bookingsCount: 0,
      });

      const status = await AssistantToolsRegistry.getOnboardingStatus(1);

      expect(status.isComplete).toBe(false);
      expect(status.currentStep?.id).toBe("pets");
      expect(status.currentStep?.route).toBe("/pets");
      expect(status.currentStep?.target).toBe("pet-create-button");
      expect(status.progressPercent).toBe(60);
    });

    it("R41B-ONBOARD-006: identifies Step 5 (bookings) as pending when bookings count == 0", async () => {
      setupDbMocks({
        phone: "(11) 99999-9999",
        address: "Rua das Flores, 123",
        staffCount: 2,
        tutorsCount: 1,
        petsCount: 1,
        bookingsCount: 0,
      });

      const status = await AssistantToolsRegistry.getOnboardingStatus(1);

      expect(status.isComplete).toBe(false);
      expect(status.currentStep?.id).toBe("bookings");
      expect(status.currentStep?.route).toBe("/bookings");
      expect(status.currentStep?.target).toBe("booking-create-button");
      expect(status.progressPercent).toBe(80);
    });

    it("R41B-ONBOARD-007: tool get_guided_onboarding_plan produces correct plan structure", async () => {
      setupDbMocks({
        phone: null,
        address: null,
        staffCount: 1,
        tutorsCount: 0,
        petsCount: 0,
        bookingsCount: 0,
      });

      const plan = await AssistantToolsRegistry.executeTool(
        "get_guided_onboarding_plan",
        { currentRoute: "/dashboard" },
        crecheAdminContext
      );

      expect(plan).toHaveProperty("content");
      expect(plan).toHaveProperty("uiActions");
      expect(plan.isCurrentScreen).toBe(false);
      expect(plan.uiActions).toEqual([
        { type: "navigate", route: "/settings" },
        { type: "highlight", targetId: "creche-profile-form" },
      ]);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 4. SCREEN AWARENESS (R41B-CONTEXT)
  // ────────────────────────────────────────────────────────────
  describe("R41B-CONTEXT-001: Screen Awareness", () => {
    it("recognizes when user is already on the pending step screen", () => {
      const mockStatus: GuidedOnboardingStatus = {
        crecheId: 1,
        isComplete: false,
        completedCount: 3,
        totalSteps: 5,
        progressPercent: 60,
        completedSteps: ["creche_details", "staff", "tutors"],
        pendingSteps: ["pets", "bookings"],
        currentStep: {
          id: "pets",
          title: "Cadastrar primeiro pet",
          description: "Cadastre um pet vinculado a um tutor",
          route: "/pets",
          target: "pet-create-button",
          completed: false,
        },
        steps: [],
      };

      const plan = AssistantGuidanceService.generatePlan(mockStatus, "/pets", "creche_admin");

      expect(plan.isCurrentScreen).toBe(true);
      expect(plan.content).toContain("Você já está na tela correta");
      expect(plan.uiActions).toEqual([{ type: "highlight", targetId: "pet-create-button" }]);
    });

    it("recommends navigation when user is on a different screen", () => {
      const mockStatus: GuidedOnboardingStatus = {
        crecheId: 1,
        isComplete: false,
        completedCount: 3,
        totalSteps: 5,
        progressPercent: 60,
        completedSteps: ["creche_details", "staff", "tutors"],
        pendingSteps: ["pets", "bookings"],
        currentStep: {
          id: "pets",
          title: "Cadastrar primeiro pet",
          description: "Cadastre um pet vinculado a um tutor",
          route: "/pets",
          target: "pet-create-button",
          completed: false,
        },
        steps: [],
      };

      const plan = AssistantGuidanceService.generatePlan(mockStatus, "/settings", "creche_admin");

      expect(plan.isCurrentScreen).toBe(false);
      expect(plan.content).toContain("O próximo passo é");
      expect(plan.uiActions).toEqual([
        { type: "navigate", route: "/pets" },
        { type: "highlight", targetId: "pet-create-button" },
      ]);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 5. NAVIGATION AND HIGHLIGHTING SAFETY
  // ────────────────────────────────────────────────────────────
  describe("R41B-GUIDE: Safe Navigation & Target Highlighting", () => {
    it("R41B-GUIDE-001: validates and sanitizes allowed internal routes", () => {
      expect(AssistantGuidanceService.isValidRoute("/settings")).toBe(true);
      expect(AssistantGuidanceService.isValidRoute("/staff/manage")).toBe(true);
      expect(AssistantGuidanceService.isValidRoute("/tutors")).toBe(true);
      expect(AssistantGuidanceService.isValidRoute("/pets")).toBe(true);
      expect(AssistantGuidanceService.isValidRoute("/bookings")).toBe(true);
      expect(AssistantGuidanceService.isValidRoute("/financial")).toBe(true);
      expect(AssistantGuidanceService.isValidRoute("/chat")).toBe(true);
      expect(AssistantGuidanceService.isValidRoute("/pets?filter=dogs")).toBe(true);
    });

    it("R41B-GUIDE-002: validates allowed target elements from allowlist", () => {
      expect(AssistantGuidanceService.isValidTarget("creche-profile-form")).toBe(true);
      expect(AssistantGuidanceService.isValidTarget("staff-create-button")).toBe(true);
      expect(AssistantGuidanceService.isValidTarget("tutor-create-button")).toBe(true);
      expect(AssistantGuidanceService.isValidTarget("pet-create-button")).toBe(true);
      expect(AssistantGuidanceService.isValidTarget("booking-create-button")).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 6. SECURITY & SANITIZATION
  // ────────────────────────────────────────────────────────────
  describe("R41B-SEC: Security & Sanitization", () => {
    it("R41B-SEC-001: strictly rejects external URLs and dangerous schemes", () => {
      expect(AssistantGuidanceService.isValidRoute("https://malicious-site.com")).toBe(false);
      expect(AssistantGuidanceService.isValidRoute("http://attacker.com")).toBe(false);
      expect(AssistantGuidanceService.isValidRoute("javascript:alert(1)")).toBe(false);
      expect(AssistantGuidanceService.isValidRoute("data:text/html,hack")).toBe(false);
      expect(AssistantGuidanceService.isValidRoute("//phishing.com")).toBe(false);
      expect(AssistantGuidanceService.isValidRoute("/admin/unknown-arbitrary")).toBe(false);
    });

    it("R41B-SEC-002: strictly rejects arbitrary CSS selectors from model or input", () => {
      expect(AssistantGuidanceService.isValidTarget("button.delete-all")).toBe(false);
      expect(AssistantGuidanceService.isValidTarget("#main > div:nth-child(2)")).toBe(false);
      expect(AssistantGuidanceService.isValidTarget("body")).toBe(false);
      expect(AssistantGuidanceService.isValidTarget("input[type='password']")).toBe(false);
      expect(AssistantGuidanceService.isValidTarget("unregistered-target")).toBe(false);
    });

    it("R41B-SEC-006: sanitizes invalid candidate actions into empty array", () => {
      const maliciousActions = [
        { type: "navigate", route: "https://evil.com" },
        { type: "highlight", targetId: "div > script" },
        { type: "arbitrary_js", code: "alert(1)" },
        null,
        undefined,
      ];

      const clean = AssistantGuidanceService.sanitizeUIActions(maliciousActions);
      expect(clean).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 7. SERVER AUTHORITATIVE STATE
  // ────────────────────────────────────────────────────────────
  describe("R41B-STATE: Server Authoritative State", () => {
    it("R41B-STATE-001: server status reflects database changes dynamically", async () => {
      setupDbMocks({ phone: null, address: null, staffCount: 1, tutorsCount: 0, petsCount: 0, bookingsCount: 0 });
      const status1 = await AssistantToolsRegistry.getOnboardingStatus(1);
      expect(status1.currentStep?.id).toBe("creche_details");

      setupDbMocks({ phone: "1199999999", address: "Rua 1", staffCount: 1, tutorsCount: 0, petsCount: 0, bookingsCount: 0 });
      const status2 = await AssistantToolsRegistry.getOnboardingStatus(1);
      expect(status2.currentStep?.id).toBe("staff");
      expect(status2.progressPercent).toBe(20);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 8. RESILIENCE & TELEMETRY
  // ────────────────────────────────────────────────────────────
  describe("R41B-RESILIENCE & Telemetry", () => {
    it("R41B-RESILIENCE-001: audit service logs onboarding operational telemetry", () => {
      const spy = vi.spyOn(AssistantAuditService, "logOnboardingEvent");

      AssistantAuditService.logOnboardingEvent(crecheAdminContext, "assistant_onboarding_started", {
        stepId: "creche_details",
        progressPercent: 0,
      });

      expect(spy).toHaveBeenCalledWith(crecheAdminContext, "assistant_onboarding_started", {
        stepId: "creche_details",
        progressPercent: 0,
      });
    });

    it("R41B-RESILIENCE-002: sanitizeUIAction returns null for malformed or unknown actions without throwing", () => {
      expect(AssistantGuidanceService.sanitizeUIAction(null)).toBeNull();
      expect(AssistantGuidanceService.sanitizeUIAction({})).toBeNull();
      expect(AssistantGuidanceService.sanitizeUIAction("invalid" as any)).toBeNull();
      expect(AssistantGuidanceService.sanitizeUIAction({ type: "unknown" })).toBeNull();
    });
  });
});
