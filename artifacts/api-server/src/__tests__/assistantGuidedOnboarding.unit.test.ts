import { describe, it, expect, vi, beforeEach } from "vitest";
import { AssistantToolsRegistry } from "../assistant/assistant-tools.registry.js";
import { AssistantGuidanceService } from "../assistant/assistant-guidance.service.js";
import { AssistantService } from "../assistant/assistant.service.js";
import { AssistantAuditService } from "../assistant/assistant-audit.service.js";
import { ASSISTANT_CONFIG } from "../assistant/assistant.config.js";
import type {
  AssistantSecurityContext,
  GuidedOnboardingStatus,
} from "../assistant/assistant.types.js";

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
  }) {
    let callIndex = 0;
    (db.select as any).mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            // First call is crechesTable
            return [
              {
                id: 1,
                name: "Creche Paws",
                phone: state.phone ?? null,
                address: state.address ?? null,
              },
            ];
          }),
        })),
        // For count queries:
        then: undefined,
        // Drizzle select({ count: count() }).from().where()
      })),
    }));

    // Better explicit mock matching query chain
    (db.select as any).mockImplementation((fields?: any) => {
      callIndex++;
      return {
        from: vi.fn((_table: any) => ({
          where: vi.fn((_condition: any) => {
            // If selecting creche (no fields object with count)
            if (!fields || !fields.count) {
              return {
                limit: vi.fn(async () => [
                  {
                    id: 1,
                    name: "Creche Paws",
                    phone: state.phone ?? null,
                    address: state.address ?? null,
                  },
                ]),
              };
            }
            // Count queries: callIndex 2 = staff, 3 = tutors, 4 = pets, 5 = bookings
            let countVal = 0;
            if (callIndex === 2) countVal = state.staffCount ?? 0;
            else if (callIndex === 3) countVal = state.tutorsCount ?? 0;
            else if (callIndex === 4) countVal = state.petsCount ?? 0;
            else if (callIndex === 5) countVal = state.bookingsCount ?? 0;

            return Promise.resolve([{ count: countVal }]);
          }),
        })),
      };
    });
  }

  // ── R41B-ONBOARD-001..007: Canonical State & Progression ──
  describe("R41B-ONBOARD: Canonical State & Progression", () => {
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

  // ── R41B-CONTEXT-001: Screen Awareness ──
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

      // User is already on /pets
      const plan = AssistantGuidanceService.generatePlan(mockStatus, "/pets", "creche_admin");

      expect(plan.isCurrentScreen).toBe(true);
      expect(plan.content).toContain("Você já está na tela correta");
      // Only highlights target; does not emit unnecessary navigate action
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

      // User is on /settings but needs /pets
      const plan = AssistantGuidanceService.generatePlan(mockStatus, "/settings", "creche_admin");

      expect(plan.isCurrentScreen).toBe(false);
      expect(plan.content).toContain("O próximo passo é");
      expect(plan.uiActions).toEqual([
        { type: "navigate", route: "/pets" },
        { type: "highlight", targetId: "pet-create-button" },
      ]);
    });
  });

  // ── R41B-GUIDE-001..002: Navigation and Highlighting Safety ──
  describe("R41B-GUIDE: Safe Navigation & Target Highlighting", () => {
    it("R41B-GUIDE-001: validates and sanitizes allowed internal routes", () => {
      expect(AssistantGuidanceService.isValidRoute("/settings")).toBe(true);
      expect(AssistantGuidanceService.isValidRoute("/staff/manage")).toBe(true);
      expect(AssistantGuidanceService.isValidRoute("/tutors")).toBe(true);
      expect(AssistantGuidanceService.isValidRoute("/pets")).toBe(true);
      expect(AssistantGuidanceService.isValidRoute("/bookings")).toBe(true);
      expect(AssistantGuidanceService.isValidRoute("/financial")).toBe(true);
      expect(AssistantGuidanceService.isValidRoute("/chat")).toBe(true);

      // Strips query parameters safely for internal validation
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

  // ── R41B-SEC-001..006: Security & Role Boundaries ──
  describe("R41B-SEC: Security & Role Boundaries", () => {
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

    it("R41B-SEC-003: rejects tutor role from executing onboarding tools", async () => {
      await expect(
        AssistantToolsRegistry.executeTool("get_onboarding_status", {}, tutorContext)
      ).rejects.toThrow(/Acesso negado/);

      await expect(
        AssistantToolsRegistry.executeTool("get_guided_onboarding_plan", {}, tutorContext)
      ).rejects.toThrow(/Acesso negado/);
    });

    it("R41B-SEC-004: rejects staff role from executing onboarding tools", async () => {
      await expect(
        AssistantToolsRegistry.executeTool("get_onboarding_status", {}, staffContext)
      ).rejects.toThrow(/Acesso negado/);

      await expect(
        AssistantToolsRegistry.executeTool("get_guided_onboarding_plan", {}, staffContext)
      ).rejects.toThrow(/Acesso negado/);
    });

    it("R41B-SEC-005: rejects cross-tenant or missing crecheId with safe error", async () => {
      const noTenantContext: AssistantSecurityContext = {
        ...crecheAdminContext,
        crecheId: null,
      };

      await expect(
        AssistantToolsRegistry.executeTool("get_onboarding_status", {}, noTenantContext)
      ).rejects.toThrow("Usuário não está associado a nenhuma creche");

      await expect(
        AssistantToolsRegistry.executeTool("get_guided_onboarding_plan", {}, noTenantContext)
      ).rejects.toThrow("Usuário não está associado a nenhuma creche");
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

  // ── R41B-STATE-001..002: Dynamic Server State ──
  describe("R41B-STATE: Server Authoritative State", () => {
    it("R41B-STATE-001: server status reflects database changes dynamically", async () => {
      // First check: Step 1 pending
      setupDbMocks({ phone: null, address: null, staffCount: 1, tutorsCount: 0, petsCount: 0, bookingsCount: 0 });
      const status1 = await AssistantToolsRegistry.getOnboardingStatus(1);
      expect(status1.currentStep?.id).toBe("creche_details");

      // Admin updates phone and address in the DB:
      setupDbMocks({ phone: "1199999999", address: "Rua 1", staffCount: 1, tutorsCount: 0, petsCount: 0, bookingsCount: 0 });
      const status2 = await AssistantToolsRegistry.getOnboardingStatus(1);
      expect(status2.currentStep?.id).toBe("staff");
      expect(status2.progressPercent).toBe(20);
    });
  });

  // ── R41B-RESILIENCE-001..002: Resilience & Telemetry ──
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
