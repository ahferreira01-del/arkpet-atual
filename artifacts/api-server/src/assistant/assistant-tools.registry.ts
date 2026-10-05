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
import { OperationalSnapshotService } from "./operational-snapshot.service.js";

export const CANONICAL_OPERATIONAL_READ_TOOL_NAMES = [
  "get_operational_overview",
  "get_operational_priorities",
  "get_today_arrivals",
  "get_pending_operational_tasks",
  "get_recent_operational_changes",
] as const;

export type CanonicalOperationalReadToolName = (typeof CANONICAL_OPERATIONAL_READ_TOOL_NAMES)[number];

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
      mode: "read",
      riskLevel: "low",
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
      mode: "read",
      riskLevel: "low",
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
      mode: "read",
      riskLevel: "low",
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
      mode: "read",
      riskLevel: "low",
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
      mode: "read",
      riskLevel: "low",
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
      mode: "read",
      riskLevel: "low",
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
      mode: "read",
      riskLevel: "low",
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
      mode: "read",
      riskLevel: "low",
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

    // ── Tool 9: get_operational_overview (R41.F) ──────────────────────────────
    this.register({
      name: "get_operational_overview",
      description: "Consulta o estado consolidado da operação da creche hoje (ocupação, chegadas, partidas e pendências operacionais).",
      allowedRoles: ["master_admin", "creche_admin", "staff"],
      mode: "read",
      riskLevel: "low",
      targetType: "general",
      inputSchema: z.object({
        forceRefresh: z.boolean().optional(),
      }),
      confirmationRequired: false,
      auditEvent: "assistant_tool_get_operational_overview",
      execute: async (input, context) => {
        if (!context.crecheId) {
          throw new Error("Acesso a dados operacionais requer contexto de uma creche autorizada");
        }
        return await OperationalSnapshotService.getSnapshot(context.crecheId, { forceRefresh: input.forceRefresh });
      },
    });

    // ── Tool 10: get_operational_priorities (R41.F) ───────────────────────────
    this.register({
      name: "get_operational_priorities",
      description: "Retorna a lista priorizada de alertas e pendências operacionais da creche ordenadas deterministicamente por urgência.",
      allowedRoles: ["master_admin", "creche_admin", "staff"],
      mode: "read",
      riskLevel: "low",
      targetType: "general",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(25).optional(),
        category: z.string().optional(),
      }),
      confirmationRequired: false,
      auditEvent: "assistant_tool_get_operational_priorities",
      execute: async (input, context) => {
        if (!context.crecheId) {
          throw new Error("Acesso a dados operacionais requer contexto de uma creche autorizada");
        }
        const snapshot = await OperationalSnapshotService.getSnapshot(context.crecheId);
        let issues = snapshot.issues;
        if (input.category) {
          issues = issues.filter((i) => i.category === input.category);
        }
        const limit = input.limit ?? 5;
        const bounded = issues.slice(0, limit);
        return {
          asOf: snapshot.asOf,
          businessDate: snapshot.businessDate,
          totalIssues: issues.length,
          priorities: bounded,
          dataCompleteness: snapshot.dataCompleteness,
          unavailableSources: snapshot.unavailableSources,
        };
      },
    });

    // ── Tool 11: get_today_arrivals (R41.F) ───────────────────────────────────
    this.register({
      name: "get_today_arrivals",
      description: "Consulta chegadas e reservas previstas para hoje na creche, identificando pets que já chegaram, estão a caminho ou aguardam check-in.",
      allowedRoles: ["master_admin", "creche_admin", "staff"],
      mode: "read",
      riskLevel: "low",
      targetType: "booking",
      inputSchema: z.object({
        status: z.enum(["confirmed", "active", "completed", "cancelled", "all"]).optional(),
        limit: z.number().int().min(1).max(25).optional(),
      }),
      confirmationRequired: false,
      auditEvent: "assistant_tool_get_today_arrivals",
      execute: async (input, context) => {
        if (!context.crecheId) {
          throw new Error("Acesso a dados operacionais requer contexto de uma creche autorizada");
        }
        const snapshot = await OperationalSnapshotService.getSnapshot(context.crecheId);
        let items = snapshot.arrivals.items;
        if (input.status && input.status !== "all") {
          items = items.filter((a) => a.status === input.status);
        }
        const limit = input.limit ?? 25;
        return {
          asOf: snapshot.asOf,
          businessDate: snapshot.businessDate,
          summary: {
            totalExpected: snapshot.arrivals.totalExpected,
            checkedIn: snapshot.arrivals.checkedIn,
            pending: snapshot.arrivals.pending,
            completed: snapshot.arrivals.completed,
            cancelled: snapshot.arrivals.cancelled,
            onTheWay: snapshot.arrivals.onTheWay,
          },
          arrivals: items.slice(0, limit),
          dataCompleteness: snapshot.dataCompleteness,
          unavailableSources: snapshot.unavailableSources,
        };
      },
    });

    // ── Tool 12: get_pending_operational_tasks (R41.F) ────────────────────────
    this.register({
      name: "get_pending_operational_tasks",
      description: "Consulta tarefas da rotina operacional (alimentação, medicação, passeios) pendentes ou atrasadas na creche.",
      allowedRoles: ["master_admin", "creche_admin", "staff"],
      mode: "read",
      riskLevel: "low",
      targetType: "task",
      inputSchema: z.object({
        type: z.enum(["feeding", "medication", "walk", "grooming", "play", "health_check", "other", "all"]).optional(),
        overdueOnly: z.boolean().optional(),
        petId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(25).optional(),
      }),
      confirmationRequired: false,
      auditEvent: "assistant_tool_get_pending_tasks",
      execute: async (input, context) => {
        if (!context.crecheId) {
          throw new Error("Acesso a dados operacionais requer contexto de uma creche autorizada");
        }
        const snapshot = await OperationalSnapshotService.getSnapshot(context.crecheId);
        let items = snapshot.tasks.items;
        if (input.type && input.type !== "all") {
          items = items.filter((t) => t.type === input.type);
        }
        if (input.overdueOnly) {
          items = items.filter((t) => t.isOverdue);
        }
        if (input.petId) {
          items = items.filter((t) => t.petId === input.petId);
        }
        const limit = input.limit ?? 25;
        return {
          asOf: snapshot.asOf,
          businessDate: snapshot.businessDate,
          counts: snapshot.tasks.byType,
          totalPending: snapshot.tasks.pending,
          totalOverdue: snapshot.tasks.overdue,
          totalUnassigned: snapshot.tasks.unassigned,
          tasks: items.slice(0, limit),
          dataCompleteness: snapshot.dataCompleteness,
          unavailableSources: snapshot.unavailableSources,
        };
      },
    });

    // ── Tool 13: get_recent_operational_changes (R41.F) ───────────────────────
    this.register({
      name: "get_recent_operational_changes",
      description: "Compara o estado operacional atual com um momento anterior da sessão para identificar o que mudou na operação.",
      allowedRoles: ["master_admin", "creche_admin", "staff"],
      mode: "read",
      riskLevel: "low",
      targetType: "general",
      inputSchema: z.object({
        sessionId: z.string().optional(),
      }),
      confirmationRequired: false,
      auditEvent: "assistant_tool_get_recent_operational_changes",
      execute: async (input, context) => {
        if (!context.crecheId) {
          throw new Error("Acesso a dados operacionais requer contexto de uma creche autorizada");
        }
        const baseline = input.sessionId
          ? OperationalSnapshotService.getSessionBaseline(input.sessionId)
          : undefined;
        return await OperationalSnapshotService.compareWithBaseline(context.crecheId, baseline);
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
    const operationalActive = ASSISTANT_CONFIG.isOperationalCopilotEnabled;
    return Array.from(this.tools.values()).filter((t) => {
      if (CANONICAL_OPERATIONAL_READ_TOOL_NAMES.includes(t.name as any) && !operationalActive) return false;
      return true;
    });
  }

  public static getAllRegisteredToolNames(): string[] {
    return this.getAllTools().map((t) => t.name);
  }

  public static getMutationToolNames(): string[] {
    return Array.from(this.tools.values())
      .filter((t) => t.mode === "mutation")
      .map((t) => t.name);
  }

  public static getReadOnlyToolNames(): string[] {
    const operationalActive = ASSISTANT_CONFIG.isOperationalCopilotEnabled;
    return Array.from(this.tools.values())
      .filter((t) => {
        if (t.mode === "mutation") return false;
        if (CANONICAL_OPERATIONAL_READ_TOOL_NAMES.includes(t.name as any) && !operationalActive) return false;
        return true;
      })
      .map((t) => t.name);
  }

  public static getBaselineReadOnlyToolNames(): string[] {
    return Array.from(this.tools.values())
      .filter((t) => t.mode !== "mutation" && !CANONICAL_OPERATIONAL_READ_TOOL_NAMES.includes(t.name as any))
      .map((t) => t.name);
  }

  public static getToolsForRole(role: string): AssistantToolDefinition[] {
    const safeActionsActive = ASSISTANT_CONFIG.areSafeActionsEnabled;
    const operationalActive = ASSISTANT_CONFIG.isOperationalCopilotEnabled;
    return Array.from(this.tools.values()).filter((t) => {
      if (!t.allowedRoles.includes(role as any)) return false;
      if (t.mode === "mutation" && !safeActionsActive) return false;
      if (CANONICAL_OPERATIONAL_READ_TOOL_NAMES.includes(t.name as any) && !operationalActive) return false;
      return true;
    });
  }

  public static getOperationalToolNames(): string[] {
    return [...CANONICAL_OPERATIONAL_READ_TOOL_NAMES];
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

    // 4b. Operational copilot feature flag / kill switch check (R41.F)
    if (
      CANONICAL_OPERATIONAL_READ_TOOL_NAMES.includes(name as any) &&
      !ASSISTANT_CONFIG.isOperationalCopilotEnabled
    ) {
      AssistantAuditService.logSecurityDenial(context, {
        action: name,
        reason: "Operational Copilot currently disabled by configuration or kill switch",
      });
      throw new Error("O Copiloto Operacional está desativado nesta instância");
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
