import { describe, it, expect, vi, beforeEach } from "vitest";
import { AssistantToolsRegistry } from "../assistant/assistant-tools.registry.js";
import { AssistantService } from "../assistant/assistant.service.js";
import { AssistantContextService } from "../assistant/assistant-context.service.js";
import { AssistantProductContextRegistry } from "../assistant/assistant-context-registry.service.js";
import { AssistantGuidanceService } from "../assistant/assistant-guidance.service.js";
import { ASSISTANT_CONFIG } from "../assistant/assistant.config.js";
import type { AssistantSecurityContext } from "../assistant/assistant.types.js";

// Mock DB interactions for unit testing
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
    tutorId: 50,
    crecheId: 1,
    breed: "Poodle",
    species: "dog",
    photoUrl: null,
    status: "active",
    allergies: null,
  },
  {
    id: 999,
    name: "ForeignPet",
    tutorId: 99,
    crecheId: 2,
    breed: "Husky",
    species: "dog",
    photoUrl: null,
    status: "active",
    allergies: null,
  },
];

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    db: {
      select: vi.fn(() => ({
        from: vi.fn((table: any) => ({
          where: vi.fn((condition: any) => ({
            limit: vi.fn(async (n: number) => {
              let queriedId: number | undefined;
              if (Array.isArray(condition?.queryChunks)) {
                for (const chunk of condition.queryChunks) {
                  if (typeof chunk === "number") {
                    queriedId = chunk;
                    break;
                  }
                  if (typeof chunk?.value === "number") {
                    queriedId = chunk.value;
                    break;
                  }
                }
              }
              const tableName = (table as any)?.[Symbol.for("drizzle:Name")] || (table as any)?._?.name || (table as any)?.name;
              if (tableName === "creches") {
                return [{ id: 1, name: "Creche Pet Feliz", status: "active", phone: "1199999999", address: "Rua Pet 123" }];
              }
              if (tableName === "pets") {
                if (queriedId !== undefined) {
                  return dummyPets.filter((p) => p.id === queriedId);
                }
                return dummyPets;
              }
              return [];
            }),
            orderBy: vi.fn(() => ({
              limit: vi.fn(async () => []),
            })),
          })),
        })),
      })),
    },
  };
});

describe("ArkPet R41.C — Contextual Product Guide Unit & Security Suite", () => {
  const crecheAdminContext: AssistantSecurityContext = {
    userId: 10,
    role: "creche_admin",
    crecheId: 1,
    name: "Admin Carlos",
    email: "carlos@creche1.com",
    requestId: "req-r41c-001",
  };

  const staffContext: AssistantSecurityContext = {
    userId: 20,
    role: "staff",
    crecheId: 1,
    name: "Staff Ana",
    email: "ana@creche1.com",
    requestId: "req-r41c-002",
  };

  const tutorContext: AssistantSecurityContext = {
    userId: 50,
    role: "tutor",
    crecheId: 1,
    name: "Tutor Roberto",
    email: "roberto@gmail.com",
    requestId: "req-r41c-003",
  };

  const masterAdminContext: AssistantSecurityContext = {
    userId: 1,
    role: "master_admin",
    crecheId: null,
    name: "Master SuperAdmin",
    email: "superadmin@arkpet.com",
    requestId: "req-r41c-004",
  };

  // ── 1. Tool Counts & Safety Invariants ─────────────────────────────────────
  // ── 1. Tool Contract & Registry Invariants (R41C-TOOL-CONTRACT-001, R41C-ROUTE-TRUTH-001) ──
  it("R41C-TOOL-CONTRACT-001: verifies R41_C_TOOL_COUNT is exactly 8 registered read-only tools matching source", () => {
    const readOnlyToolNames = AssistantToolsRegistry.getReadOnlyToolNames();
    expect(readOnlyToolNames.length).toBe(8);

    expect(readOnlyToolNames).toEqual([
      "get_onboarding_status",
      "get_current_user_context",
      "get_current_screen_context",
      "search_arkpet_knowledge",
      "list_my_pets",
      "list_my_bookings",
      "get_guided_onboarding_plan",
      "get_contextual_product_guide",
    ]);

    expect(AssistantToolsRegistry.getAllRegisteredToolNames().length).toBe(15);
  });

  it("R41C-ROUTE-TRUTH-001: validates context registry route definitions and absence of fictitious routes", () => {
    const definitions = AssistantProductContextRegistry.listDefinitions();
    expect(definitions.length).toBe(20);

    const routeIds = definitions.map((d) => d.routeId);
    expect(routeIds).not.toContain("bookings.detail");
    expect(routeIds).not.toContain("tutors.detail");
    expect(routeIds).toContain("pets.detail");

    // Verify /bookings/123 does not match a registered screen
    const resolvedBookingDetail = AssistantProductContextRegistry.resolveScreen("/bookings/123");
    expect(resolvedBookingDetail).toBeNull();

    // Verify /tutors/123 does not match a registered screen
    const resolvedTutorDetail = AssistantProductContextRegistry.resolveScreen("/tutors/123");
    expect(resolvedTutorDetail).toBeNull();

    // Verify /pets/101 correctly resolves pets.detail with entityType pet
    const resolvedPetDetail = AssistantProductContextRegistry.resolveScreen("/pets/101");
    expect(resolvedPetDetail).not.toBeNull();
    expect(resolvedPetDetail?.definition.routeId).toBe("pets.detail");
    expect(resolvedPetDetail?.definition.entityType).toBe("pet");
    expect(resolvedPetDetail?.params.id).toBe("101");
  });

  it("R41C-MODEL-CONFIG-001: validates default provider and model configuration", () => {
    const prevModel = process.env.AI_MODEL;
    const prevProvider = process.env.AI_PROVIDER;

    try {
      delete process.env.AI_MODEL;
      delete process.env.AI_PROVIDER;

      expect(ASSISTANT_CONFIG.defaultProvider).toBe("groq");
      expect(ASSISTANT_CONFIG.defaultModel).toBe("openai/gpt-oss-20b");

      process.env.AI_MODEL = "llama-3.3-70b-versatile";
      expect(ASSISTANT_CONFIG.defaultModel).toBe("llama-3.3-70b-versatile");
    } finally {
      if (prevModel !== undefined) process.env.AI_MODEL = prevModel;
      else delete process.env.AI_MODEL;
      if (prevProvider !== undefined) process.env.AI_PROVIDER = prevProvider;
      else delete process.env.AI_PROVIDER;
    }
  });

  it("R41C-RBAC-004: settings screen metadata exposes allowed roles for creche_admin, staff, and tutor", () => {
    const settingsDef = AssistantProductContextRegistry.getDefinition("settings");
    expect(settingsDef).toBeDefined();
    expect(settingsDef?.allowedRoles).toContain("creche_admin");
    expect(settingsDef?.allowedRoles).toContain("staff");
    expect(settingsDef?.allowedRoles).toContain("tutor");
  });

  it("verifies R41_C_DOMAIN_MUTATION_COUNT = 0 and GENERAL_DB_ACCESS_TOOL = 0", async () => {
    const tools = AssistantToolsRegistry.listTools();
    const mutationKeywords = ["create", "update", "delete", "cancel", "checkin", "checkout", "insert", "drop"];
    for (const tool of tools) {
      if (tool.name !== "get_guided_onboarding_plan") {
        for (const kw of mutationKeywords) {
          expect(tool.name.toLowerCase()).not.toContain(`_${kw}`);
        }
      }
    }

    // Verify rejection of generic database query tools
    await expect(
      AssistantToolsRegistry.executeTool("query_database", {}, crecheAdminContext)
    ).rejects.toThrow("viola a política de segurança");

    await expect(
      AssistantToolsRegistry.executeTool("execute_sql", {}, crecheAdminContext)
    ).rejects.toThrow("viola a política de segurança");
  });

  // ── 2. Screen Context Tests (R41C-CONTEXT-001..004) ─────────────────────────
  it("R41C-CONTEXT-001: Authenticated creche_admin on dashboard asks 'O que posso fazer aqui?'", async () => {
    const result = await AssistantService.processMessage(
      "O que posso fazer aqui?",
      undefined,
      crecheAdminContext,
      { route: "/" }
    );

    const content = result.message.content.toLowerCase();
    expect(content).toContain("dashboard");
    expect(content).toContain("taxa de ocupação");
    expect(content).toContain("reservas");
  });

  it("R41C-CONTEXT-002: On pets list asks 'Como cadastro um pet?' and receives highlight target", async () => {
    const result = await AssistantService.processMessage(
      "Como cadastro um pet?",
      undefined,
      crecheAdminContext,
      { route: "/pets" }
    );

    const content = result.message.content.toLowerCase();
    expect(content).toContain("pet-create-button");
    expect(content).toContain("tutor");

    expect(result.message.uiActions).toBeDefined();
    const hasHighlight = result.message.uiActions?.some(
      (a) => a.type === "highlight" && a.targetId === "pet-create-button"
    );
    expect(hasHighlight).toBe(true);
  });

  it("R41C-CONTEXT-003: On authorized pet detail resolves current pet safely", async () => {
    const result = await AssistantService.processMessage(
      "O que posso ver sobre ele?",
      undefined,
      crecheAdminContext,
      { route: "/pets/101", entity: { type: "pet", id: 101 } }
    );

    const content = result.message.content.toLowerCase();
    expect(content).toContain("thor");
    expect(content).toContain("prontuário");
    expect(content).toContain("vacinas");
  });

  it("R41C-CONTEXT-004: On bookings asks 'O que significa pendente?' and receives status semantics", async () => {
    const result = await AssistantService.processMessage(
      "O que significa pendente?",
      undefined,
      crecheAdminContext,
      { route: "/bookings" }
    );

    const content = result.message.content.toLowerCase();
    expect(content).toContain("pendente");
    expect(content).toContain("aguarda");
    expect(content).toContain("reserva");
  });

  // ── 3. Entity & Pronoun Resolution Tests (R41C-ENTITY-001..002) ────────────
  it("R41C-ENTITY-001: Contextual pronoun resolves 'ele' to active pet Thor", async () => {
    const result = await AssistantService.processMessage(
      "Ele tem alguma reserva?",
      undefined,
      crecheAdminContext,
      { route: "/pets/101", entity: { type: "pet", id: 101 } }
    );

    const content = result.message.content;
    expect(content).toContain("Thor");
    expect(content).toContain("reservas");
  });

  it("R41C-ENTITY-002: Ambiguous pronoun without entity does NOT hallucinate pet name", async () => {
    const result = await AssistantService.processMessage(
      "Ele tem alguma reserva?",
      undefined,
      crecheAdminContext,
      { route: "/" }
    );

    const content = result.message.content;
    expect(content).toContain("Você não selecionou um pet específico");
    expect(content).not.toContain("Thor tem reserva");
    expect(content).not.toContain("Rex tem reserva");
  });

  // ── 4. RBAC & Role Guidance Tests (R41C-RBAC-001..003) ─────────────────────
  it("R41C-RBAC-001: Staff user on operational board does NOT receive admin financial info", async () => {
    const result = await AssistantService.processMessage(
      "O que posso fazer nesta tela?",
      undefined,
      staffContext,
      { route: "/staff/board" }
    );

    const content = result.message.content.toLowerCase();
    expect(content).toContain("check-in");
    expect(content).toContain("alimentação");
    expect(content).toContain("medicação");
    expect(content).toContain("passeios");
    expect(content).not.toContain("faturamento");
    expect(content).not.toContain("receita da creche");
    expect(content).not.toContain("relatório financeiro consolidado");
  });

  it("R41C-RBAC-002: Tutor on own pet resolves pet, but foreign pet is denied", async () => {
    // 1. Own pet (id: 101, tutorId: 50)
    const ownResult = await AssistantContextService.resolveContext(tutorContext, {
      route: "/pets/101",
      entity: { type: "pet", id: 101 },
    });
    expect(ownResult.screen.entity).not.toBeNull();
    expect(ownResult.screen.entity?.name).toBe("Thor");

    // 2. Foreign pet (id: 999, tutorId: 99)
    const foreignResult = await AssistantContextService.resolveContext(tutorContext, {
      route: "/pets/999",
      entity: { type: "pet", id: 999 },
    });
    expect(foreignResult.screen.entity).toBeNull();
  });

  it("R41C-RBAC-003: Same route produces role-differentiated explanations", async () => {
    const adminGuide = await AssistantToolsRegistry.executeTool(
      "get_contextual_product_guide",
      { currentRoute: "/" },
      crecheAdminContext
    );
    expect(adminGuide.roleGuidance).toContain("taxa de ocupação");

    const staffGuide = await AssistantToolsRegistry.executeTool(
      "get_contextual_product_guide",
      { currentRoute: "/" },
      staffContext
    );
    expect(staffGuide.roleGuidance).toContain("rotina diária");

    const tutorGuide = await AssistantToolsRegistry.executeTool(
      "get_contextual_product_guide",
      { currentRoute: "/" },
      tutorContext
    );
    expect(tutorGuide.roleGuidance).toContain("status dos seus pets");
  });

  // ── 5. Security & Input Sanitization Tests (R41C-SEC-001..007) ─────────────
  it("R41C-SEC-001: Creche A attempting pet from Creche B is rejected as cross-tenant access", async () => {
    const crecheBContext: AssistantSecurityContext = {
      userId: 77,
      role: "creche_admin",
      crecheId: 2, // Different creche
      name: "Admin Creche B",
      email: "b@creche.com",
    };

    const resolved = await AssistantContextService.resolveContext(crecheBContext, {
      route: "/pets/101", // Pet 101 belongs to crecheId 1
      entity: { type: "pet", id: 101 },
    });

    expect(resolved.screen.entity).toBeNull();
  });

  it("R41C-SEC-002: Model or client fake role context is ignored; server role is authoritative", async () => {
    const fakeClientScreen: any = {
      route: "/settings",
      role: "master_admin", // Fake client injection
    };

    const resolved = await AssistantContextService.resolveContext(tutorContext, fakeClientScreen);
    expect(resolved.user.role).toBe("tutor");
    expect(resolved.screen.allowedActions).not.toContain("settings.save_profile");
  });

  it("R41C-SEC-003: Fake crecheId from client is ignored; server securityContext wins", async () => {
    const fakeClientScreen: any = {
      route: "/settings",
      crecheId: 9999, // Fake client crecheId
    };

    const resolved = await AssistantContextService.resolveContext(crecheAdminContext, fakeClientScreen);
    expect(resolved.user.crecheId).toBe(1); // Server context crecheId 1 preserved
  });

  it("R41C-SEC-004: Foreign entity ID is validated and stripped before retrieval", async () => {
    const resolved = await AssistantContextService.resolveContext(tutorContext, {
      route: "/pets/999",
      entity: { type: "pet", id: 999 },
    });

    expect(resolved.screen.entity).toBeNull();
  });

  it("R41C-SEC-005: Arbitrary route is rejected by guidance service", () => {
    expect(AssistantGuidanceService.isValidRoute("/external-phishing-site")).toBe(false);
    expect(AssistantGuidanceService.isValidRoute("https://malicious.com")).toBe(false);
    expect(AssistantGuidanceService.isValidRoute("javascript:alert(1)")).toBe(false);

    const sanitized = AssistantGuidanceService.sanitizeUIAction({
      type: "navigate",
      route: "https://evil.com/leak",
    });
    expect(sanitized).toBeNull();
  });

  it("R41C-SEC-006: Arbitrary CSS target is rejected by guidance service", () => {
    expect(AssistantGuidanceService.isValidTarget("body > div.evil")).toBe(false);
    expect(AssistantGuidanceService.isValidTarget("#admin-password-input")).toBe(false);
    expect(AssistantGuidanceService.isValidTarget("<script>")).toBe(false);

    const sanitized = AssistantGuidanceService.sanitizeUIAction({
      type: "highlight",
      targetId: "body > div:first-child",
    });
    expect(sanitized).toBeNull();
  });

  it("R41C-SEC-007: Script injection in route or context fields is treated as inert", async () => {
    const maliciousRoute = "/pets<script>alert('xss')</script>";
    const sanitized = AssistantContextService.sanitizeString(maliciousRoute);
    expect(sanitized).not.toContain("<script>");
    expect(sanitized).not.toContain("</script>");

    const resolved = await AssistantContextService.resolveContext(crecheAdminContext, {
      route: "javascript:alert('pwn')",
    });
    expect(resolved.screen.route).not.toContain("javascript:");
  });

  // ── 6. State & Transitions (R41C-STATE-001..002) ───────────────────────────
  it("R41C-STATE-001: Current turn screen context wins over previous turns", async () => {
    const session = AssistantService.getOrCreateSession(undefined, crecheAdminContext);

    // Turn 1 on /pets
    await AssistantService.processMessage(
      "O que posso fazer nesta tela?",
      session.id,
      crecheAdminContext,
      { route: "/pets" }
    );

    // Turn 2 navigates to /bookings
    const turn2 = await AssistantService.processMessage(
      "O que posso fazer nesta tela?",
      session.id,
      crecheAdminContext,
      { route: "/bookings" }
    );

    expect(turn2.message.content.toLowerCase()).toContain("reservas");
    expect(turn2.message.content.toLowerCase()).not.toContain("cadastrar novos pets vinculados aos tutores");
  });

  it("R41C-STATE-002: Entity switch from Thor to Rex reflects the latest entity", async () => {
    const session = AssistantService.getOrCreateSession(undefined, crecheAdminContext);

    // Turn 1 on Thor (id: 101)
    const turn1 = await AssistantService.processMessage(
      "Ele tem alguma reserva?",
      session.id,
      crecheAdminContext,
      { route: "/pets/101", entity: { type: "pet", id: 101 } }
    );
    expect(turn1.message.content).toContain("Thor");

    // Turn 2 on Rex (id: 102)
    const turn2 = await AssistantService.processMessage(
      "Ele tem alguma reserva?",
      session.id,
      crecheAdminContext,
      { route: "/pets/102", entity: { type: "pet", id: 102 } }
    );
    expect(turn2.message.content).toContain("Rex");
  });

  // ── 7. Knowledge & Feature Anti-Hallucination (R41C-KNOW-001..002) ──────────
  it("R41C-KNOW-001: Known feature question grounds with relevant knowledge results", async () => {
    const result = await AssistantService.processMessage(
      "Qual a diferença entre hospedagem e day use?",
      undefined,
      crecheAdminContext,
      { route: "/bookings" }
    );

    expect(result.message.content).toContain("pernoite");
    expect(result.message.citations?.length).toBeGreaterThan(0);
  });

  it("R41C-KNOW-002: Feature hallucination prevented; standalone bath module denied", async () => {
    const result = await AssistantService.processMessage(
      "Existe módulo exclusivo de banho?",
      undefined,
      crecheAdminContext,
      { route: "/" }
    );

    const content = result.message.content.toLowerCase();
    expect(content).toContain("serviço adicional");
    expect(content).toContain("não");
    expect(content).toContain("módulo separado");
  });

  // ── 8. Degradation & Unknown Screens ────────────────────────────────────────
  it("UNKNOWN_SCREEN_BREAKS_ASSISTANT: Unknown screen degrades gracefully to general help", async () => {
    const result = await AssistantService.processMessage(
      "O que posso fazer nesta tela?",
      undefined,
      crecheAdminContext,
      { route: "/unknown-custom-page-xyz" }
    );

    expect(result.message.content).toContain("ArkPet");
    expect(result.message.content).toContain("ajudar");
  });

  it("AI_FAILURE_BREAKS_PRODUCT = NO: System handles temporary failures safely", async () => {
    const originalKillSwitch = ASSISTANT_CONFIG.isKillSwitchActive;
    process.env.AI_ASSISTANT_KILL_SWITCH = "true";

    await expect(
      AssistantService.processMessage("Olá", undefined, crecheAdminContext)
    ).rejects.toThrow("temporariamente desativado");

    process.env.AI_ASSISTANT_KILL_SWITCH = "false";
  });
});
