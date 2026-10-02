import { z } from "zod";
import { db } from "@workspace/db";
import {
  usersTable,
  crechesTable,
  petsTable,
  bookingsTable,
} from "@workspace/db/schema";
import { eq, and, sql, count, desc, like } from "drizzle-orm";
import { AssistantAuditService } from "./assistant-audit.service.js";
import { AssistantKnowledgeService } from "./assistant-knowledge.service.js";
import { AssistantGuidanceService, CANONICAL_ONBOARDING_TARGETS } from "./assistant-guidance.service.js";
import { AssistantContextService } from "./assistant-context.service.js";
import { AssistantProductContextRegistry } from "./assistant-context-registry.service.js";
import { getCanonicalOnboardingStatus } from "../services/onboarding.service.js";
import { ASSISTANT_CONFIG } from "./assistant.config.js";
import type {
  AssistantSecurityContext,
  AssistantToolDefinition,
  GuidedOnboardingStatus,
  GuidedOnboardingStep,
} from "./assistant.types.js";
import { AssistantSafeActionService } from "./assistant-safe-action.service.js";
import {
  SAFE_ACTION_REGISTRY,
  CANONICAL_MUTATION_TOOL_NAMES,
} from "./assistant-safe-action.registry.js";

export class AssistantToolsRegistry {
  private static tools: Map<string, AssistantToolDefinition> = new Map();

  static {
    this.registerTools();
  }

  private static registerTools() {
    // ── Tool 1: get_onboarding_status ──────────────────────────────────────────
    this.register({
      name: "get_onboarding_status",
      description: "Consulta o status e progresso real dos 5 passos de onboarding da creche.",
      allowedRoles: ["creche_admin"],
      mode: "query",
      riskLevel: "read_only",
      targetType: "general",
      inputSchema: z.object({}),
      confirmationRequired: false,
      auditEvent: "assistant_tool_get_onboarding_status",
      execute: async (_input, context) => {
        if (!context.crecheId) {
          throw new Error("Usuário não está associado a nenhuma creche");
        }
        return await AssistantToolsRegistry.getOnboardingStatus(context.crecheId);
      },
    });

    // ── Tool 2: get_current_user_context ───────────────────────────────────────
    this.register({
      name: "get_current_user_context",
      description: "Obtém dados seguros sobre o usuário autenticado na sessão atual.",
      allowedRoles: ["master_admin", "creche_admin", "staff", "tutor"],
      mode: "query",
      riskLevel: "read_only",
      targetType: "general",
      inputSchema: z.object({}),
      confirmationRequired: false,
      auditEvent: "assistant_tool_get_user_context",
      execute: async (_input, context) => {
        return {
          userId: context.userId,
          name: context.name,
          email: context.email,
          role: context.role,
          crecheId: context.crecheId,
        };
      },
    });

    // ── Tool 3: get_current_screen_context ─────────────────────────────────────
    this.register({
      name: "get_current_screen_context",
      description: "Obtém a rota da tela, metadados cadastrados e as ações disponíveis no contexto atual.",
      allowedRoles: ["master_admin", "creche_admin", "staff", "tutor"],
      mode: "query",
      riskLevel: "read_only",
      targetType: "general",
      inputSchema: z.object({
        route: z.string().optional(),
      }),
      confirmationRequired: false,
      auditEvent: "assistant_tool_get_screen_context",
      execute: async (input, context) => {
        const resolved = await AssistantContextService.resolveContext(context, { route: input.route });
        return {
          route: resolved.screen.route,
          routeId: resolved.screen.routeId,
          feature: resolved.screen.feature,
          title: resolved.screen.title,
          description: resolved.screen.description,
          allowedActions: resolved.screen.allowedActions,
          guidanceTargets: resolved.screen.guidanceTargets,
          entity: resolved.screen.entity,
          systemStatus: "active",
        };
      },
    });

    // ── Tool 4: search_arkpet_knowledge ────────────────────────────────────────
    this.register({
      name: "search_arkpet_knowledge",
      description: "Pesquisa a documentação oficial e regras de negócio do ArkPet.",
      allowedRoles: ["master_admin", "creche_admin", "staff", "tutor"],
      mode: "query",
      riskLevel: "read_only",
      targetType: "general",
      inputSchema: z.object({
        query: z.string().min(1, "Termo de busca obrigatório").max(200),
        category: z.string().optional(),
      }),
      confirmationRequired: false,
      auditEvent: "assistant_tool_search_knowledge",
      execute: async (input) => {
        const results = await AssistantKnowledgeService.search(input.query, {
          category: input.category,
          maxResults: 3,
        });

        return {
          knowledgeVersion: ASSISTANT_CONFIG.knowledgeVersion,
          results,
        };
      },
    });

    // ── Tool 5: list_my_pets ───────────────────────────────────────────────────
    this.register({
      name: "list_my_pets",
      description: "Lista pets autorizados. Para tutores, retorna apenas seus próprios pets; para staff/admin, retorna pets da creche.",
      allowedRoles: ["tutor", "creche_admin", "staff"],
      mode: "query",
      riskLevel: "read_only",
      targetType: "pet",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).default(10).optional(),
        search: z.string().max(100).optional(),
      }),
      confirmationRequired: false,
      auditEvent: "assistant_tool_list_pets",
      execute: async (input, context) => {
        const limit = input.limit ?? 10;

        if (context.role === "tutor") {
          // Strictly isolate tutor to own pets (AI-SEC-002)
          const conditions = [eq(petsTable.tutorId, context.userId)];
          if (input.search) {
            conditions.push(like(petsTable.name, `%${input.search}%`));
          }

          const pets = await db
            .select({
              id: petsTable.id,
              name: petsTable.name,
              breed: petsTable.breed,
              species: petsTable.species,
              avatarUrl: petsTable.photoUrl,
              status: petsTable.status,
            })
            .from(petsTable)
            .where(and(...conditions))
            .limit(limit);

          return pets;
        }

        // For creche_admin or staff: scoped to tenant crecheId
        if (!context.crecheId) {
          throw new Error("Usuário não associado a nenhuma creche");
        }

        const conditions = [eq(petsTable.crecheId, context.crecheId)];
        if (input.search) {
          conditions.push(like(petsTable.name, `%${input.search}%`));
        }

        const pets = await db
          .select({
            id: petsTable.id,
            name: petsTable.name,
            breed: petsTable.breed,
            species: petsTable.species,
            avatarUrl: petsTable.photoUrl,
            status: petsTable.status,
          })
          .from(petsTable)
          .where(and(...conditions))
          .limit(limit);

        return pets;
      },
    });

    // ── Tool 6: list_my_bookings ───────────────────────────────────────────────
    this.register({
      name: "list_my_bookings",
      description: "Lista reservas autorizadas. Para tutores, apenas reservas dos seus pets; para creche, reservas da unidade.",
      allowedRoles: ["tutor", "creche_admin", "staff"],
      mode: "query",
      riskLevel: "read_only",
      targetType: "booking",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).default(10).optional(),
        status: z.enum(["pending", "confirmed", "checked_in", "checked_out", "cancelled"]).optional(),
      }),
      confirmationRequired: false,
      auditEvent: "assistant_tool_list_bookings",
      execute: async (input, context) => {
        const limit = input.limit ?? 10;

        if (context.role === "tutor") {
          // Tutor view: strictly isolate to tutorId = context.userId (AI-SEC-002)
          const conditions: any[] = [eq(bookingsTable.tutorId, context.userId)];
          if (input.status) {
            conditions.push(eq(bookingsTable.status, input.status));
          }

          const bookings = await db
            .select({
              id: bookingsTable.id,
              petId: bookingsTable.petId,
              petName: petsTable.name,
              serviceType: bookingsTable.type,
              startDate: bookingsTable.startDate,
              endDate: bookingsTable.endDate,
              status: bookingsTable.status,
            })
            .from(bookingsTable)
            .innerJoin(petsTable, eq(bookingsTable.petId, petsTable.id))
            .where(and(...conditions))
            .orderBy(desc(bookingsTable.startDate))
            .limit(limit);

          return bookings;
        }

        // Creche view: scoped to tenant crecheId
        if (!context.crecheId) {
          throw new Error("Usuário não associado a nenhuma creche");
        }

        const conditions: any[] = [eq(bookingsTable.crecheId, context.crecheId)];
        if (input.status) {
          conditions.push(eq(bookingsTable.status, input.status));
        }

        const bookings = await db
          .select({
            id: bookingsTable.id,
            petId: bookingsTable.petId,
            petName: petsTable.name,
            serviceType: bookingsTable.type,
            startDate: bookingsTable.startDate,
            endDate: bookingsTable.endDate,
            status: bookingsTable.status,
          })
          .from(bookingsTable)
          .innerJoin(petsTable, eq(bookingsTable.petId, petsTable.id))
          .where(and(...conditions))
          .orderBy(desc(bookingsTable.startDate))
          .limit(limit);

        return bookings;
      },
    });

    // ── Tool 7: get_guided_onboarding_plan ─────────────────────────────────────
    this.register({
      name: "get_guided_onboarding_plan",
      description: "Gera o plano contextual de onboarding guiado para a creche atual, recomendando ações e navegação segura para o próximo passo pendente.",
      allowedRoles: ["creche_admin"],
      mode: "query",
      riskLevel: "read_only",
      targetType: "general",
      inputSchema: z.object({
        currentRoute: z.string().optional(),
      }),
      confirmationRequired: false,
      auditEvent: "assistant_tool_get_guided_onboarding_plan",
      execute: async (input, context) => {
        if (!context.crecheId) {
          throw new Error("Usuário não está associado a nenhuma creche");
        }
        const status = await AssistantToolsRegistry.getOnboardingStatus(context.crecheId);
        return AssistantGuidanceService.generatePlan(status, input.currentRoute, context.role);
      },
    });

    // ── Tool 8: get_contextual_product_guide ───────────────────────────────────
    this.register({
      name: "get_contextual_product_guide",
      description: "Obtém o guia contextual completo da tela atual, incluindo explicações de negócio para o papel autenticado e ações disponíveis.",
      allowedRoles: ["master_admin", "creche_admin", "staff", "tutor"],
      mode: "query",
      riskLevel: "read_only",
      targetType: "general",
      inputSchema: z.object({
        currentRoute: z.string().optional(),
      }),
      confirmationRequired: false,
      auditEvent: "assistant_tool_get_contextual_product_guide",
      execute: async (input, context) => {
        const resolved = await AssistantContextService.resolveContext(context, { route: input.currentRoute });
        const screen = resolved.screen;
        const definition =
          AssistantProductContextRegistry.getDefinition(screen.routeId || "") ||
          AssistantProductContextRegistry.getFallbackScreen(screen.route);
        const guidanceSummary = AssistantProductContextRegistry.getGuidanceSummaryForRole(
          definition,
          context.role
        );

        return {
          route: screen.route,
          routeId: screen.routeId,
          title: screen.title,
          feature: screen.feature,
          roleGuidance: guidanceSummary,
          availableActions: screen.allowedActions,
          guidanceTargets: screen.guidanceTargets,
          activeEntity: screen.entity,
        };
      },
    });

    // ── Safe Mutation Tools (R41.E: Exactly 7 Canonical Actions) ──────────────
    for (const actionType of CANONICAL_MUTATION_TOOL_NAMES) {
      const def = SAFE_ACTION_REGISTRY[actionType];
      this.register({
        name: def.actionType,
        description: def.description,
        allowedRoles: def.allowedRoles,
        mode: "mutation",
        riskLevel: def.riskLevel,
        targetType: def.targetType,
        inputSchema: def.inputSchema,
        confirmationRequired: true,
        auditEvent: `assistant_tool_${def.actionType}`,
        execute: async (input, context) => {
          return await AssistantSafeActionService.createPendingAction(
            def.actionType,
            input,
            context
          );
        },
      });
    }
  }

  public static async getOnboardingStatus(crecheId: number): Promise<GuidedOnboardingStatus> {
    const canonical = await getCanonicalOnboardingStatus(crecheId);

    if (!canonical) {
      throw new Error("Creche não encontrada");
    }

    const steps: GuidedOnboardingStep[] = canonical.steps.map((s) => ({
      ...s,
      target: CANONICAL_ONBOARDING_TARGETS[s.id] || "",
    }));

    const completedSteps = steps.filter((s) => s.completed).map((s) => s.id);
    const pendingSteps = steps.filter((s) => !s.completed).map((s) => s.id);
    const completedCount = completedSteps.length;
    const isComplete = completedCount === steps.length;
    const progressPercent = Math.round((completedCount / steps.length) * 100);
    const currentStep = steps.find((s) => !s.completed) || null;

    return {
      crecheId,
      isComplete,
      completedCount,
      totalSteps: steps.length,
      progressPercent,
      completedSteps,
      pendingSteps,
      currentStep,
      steps,
    };
  }

  public static register(tool: AssistantToolDefinition) {
    this.tools.set(tool.name, tool);
  }

  public static getTool(name: string): AssistantToolDefinition | undefined {
    return this.tools.get(name);
  }

  public static listTools(): AssistantToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public static getAllTools(): AssistantToolDefinition[] {
    return this.listTools();
  }

  public static getAllRegisteredToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  public static getMutationToolNames(): string[] {
    return Array.from(this.tools.values())
      .filter((t) => t.mode === "mutation")
      .map((t) => t.name);
  }

  public static getReadOnlyToolNames(): string[] {
    return Array.from(this.tools.values())
      .filter((t) => t.mode !== "mutation")
      .map((t) => t.name);
  }

  public static getToolsForRole(role: string): AssistantToolDefinition[] {
    const safeActionsActive = ASSISTANT_CONFIG.areSafeActionsEnabled;
    return Array.from(this.tools.values()).filter((t) => {
      if (!t.allowedRoles.includes(role as any)) return false;
      if (t.mode === "mutation" && !safeActionsActive) return false;
      return true;
    });
  }

  /**
   * Executes a tool with complete validation, role guards, and structured auditing.
   */
  public static async executeTool(
    name: string,
    rawInput: unknown,
    context: AssistantSecurityContext
  ): Promise<any> {
    const startTime = Date.now();

    // 1. Invariant: GENERAL_DB_ACCESS_TOOL = 0
    const forbiddenPatterns = ["sql", "querydatabase", "executesql", "rundatabase", "genericmutation"];
    const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (forbiddenPatterns.some((pattern) => normalizedName.includes(pattern))) {
      AssistantAuditService.logSecurityDenial(context, {
        action: name,
        reason: "Generic database tools strictly forbidden by R41 security policy",
      });
      throw new Error(`Acesso negado: ferramenta '${name}' viola a política de segurança`);
    }

    // 2. Invariant: UNREGISTERED_TOOL_EXECUTION = 0
    const tool = this.tools.get(name);
    if (!tool) {
      AssistantAuditService.logSecurityDenial(context, {
        action: name,
        reason: "Attempted execution of unregistered tool",
      });
      throw new Error(`Ferramenta não cadastrada: '${name}'`);
    }

    // 3. Server-side RBAC Guard (AI_AUTHORIZATION_DECISION_SOURCE = SERVER)
    if (!tool.allowedRoles.includes(context.role)) {
      AssistantAuditService.logSecurityDenial(context, {
        action: name,
        reason: `Role '${context.role}' does not have permission for tool '${name}'`,
      });
      throw new Error(`Acesso negado: o papel '${context.role}' não tem permissão para a ferramenta '${name}'`);
    }

    // 4. Safe actions feature flag / kill switch check
    if (tool.mode === "mutation" && !ASSISTANT_CONFIG.areSafeActionsEnabled) {
      AssistantAuditService.logSecurityDenial(context, {
        action: name,
        reason: "Safe actions currently disabled by configuration or kill switch",
      });
      throw new Error("Ações seguras do assistente estão desativadas no momento");
    }

    // 5. Input Schema Validation via Zod (AI-SEC-008)
    const parseResult = tool.inputSchema.safeParse(rawInput ?? {});
    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
      AssistantAuditService.logToolExecution(context, {
        toolName: name,
        status: "FAILURE",
        durationMs: Date.now() - startTime,
        error: errorMsg,
      });
      throw new Error(`Parâmetros inválidos para a ferramenta '${name}': ${errorMsg}`);
    }

    // 5. Execute handler with timing & audit
    try {
      const result = await tool.execute(parseResult.data, context);
      const durationMs = Date.now() - startTime;
      AssistantAuditService.logToolExecution(context, {
        toolName: name,
        status: "SUCCESS",
        durationMs,
      });
      return result;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      AssistantAuditService.logToolExecution(context, {
        toolName: name,
        status: "FAILURE",
        durationMs,
        error: err.message,
      });
      throw err;
    }
  }
}
