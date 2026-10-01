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
import { AssistantGuidanceService } from "./assistant-guidance.service.js";
import { ASSISTANT_CONFIG } from "./assistant.config.js";
import type {
  AssistantSecurityContext,
  AssistantToolDefinition,
  GuidedOnboardingStatus,
  GuidedOnboardingStep,
} from "./assistant.types.js";

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
      allowedRoles: ["creche_admin", "master_admin"],
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
      description: "Obtém a rota da tela e as ações disponíveis no contexto atual.",
      allowedRoles: ["master_admin", "creche_admin", "staff", "tutor"],
      inputSchema: z.object({
        route: z.string().optional(),
      }),
      confirmationRequired: false,
      auditEvent: "assistant_tool_get_screen_context",
      execute: async (input) => {
        return {
          route: input.route || "/",
          systemStatus: "active",
        };
      },
    });

    // ── Tool 4: search_arkpet_knowledge ────────────────────────────────────────
    this.register({
      name: "search_arkpet_knowledge",
      description: "Pesquisa a documentação oficial e regras de negócio do ArkPet.",
      allowedRoles: ["master_admin", "creche_admin", "staff", "tutor"],
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
      allowedRoles: ["creche_admin", "master_admin"],
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
  }

  public static async getOnboardingStatus(crecheId: number): Promise<GuidedOnboardingStatus> {
    const [creche] = await db
      .select()
      .from(crechesTable)
      .where(eq(crechesTable.id, crecheId))
      .limit(1);

    if (!creche) {
      throw new Error("Creche não encontrada");
    }

    const [staffCountRes] = await db
      .select({ count: count() })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.crecheId, crecheId),
          sql`role IN ('creche_admin', 'staff')`
        )
      );

    const [tutorsCountRes] = await db
      .select({ count: count() })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.crecheId, crecheId),
          eq(usersTable.role, "tutor")
        )
      );

    const [petsCountRes] = await db
      .select({ count: count() })
      .from(petsTable)
      .where(eq(petsTable.crecheId, crecheId));

    const [bookingsCountRes] = await db
      .select({ count: count() })
      .from(bookingsTable)
      .where(eq(bookingsTable.crecheId, crecheId));

    const steps: GuidedOnboardingStep[] = [
      {
        id: "creche_details",
        title: "Completar dados da creche",
        description: "Informe telefone e endereço da creche",
        completed: Boolean(creche.phone && creche.address),
        route: "/settings",
        target: "creche-profile-form",
        actionLabel: "Configurar",
      },
      {
        id: "staff",
        title: "Cadastrar equipe",
        description: "Convide ou adicione membros da equipe",
        completed: (staffCountRes?.count || 0) > 1,
        route: "/staff/manage",
        target: "staff-create-button",
        actionLabel: "Equipe",
      },
      {
        id: "tutors",
        title: "Cadastrar tutor",
        description: "Cadastre seu primeiro tutor",
        completed: (tutorsCountRes?.count || 0) > 0,
        route: "/tutors",
        target: "tutor-create-button",
        actionLabel: "Tutores",
      },
      {
        id: "pets",
        title: "Cadastrar primeiro pet",
        description: "Cadastre um pet vinculado a um tutor",
        completed: (petsCountRes?.count || 0) > 0,
        route: "/pets",
        target: "pet-create-button",
        actionLabel: "Pets",
      },
      {
        id: "bookings",
        title: "Conhecer reservas",
        description: "Crie sua primeira reserva ou veja a agenda",
        completed: (bookingsCountRes?.count || 0) > 0,
        route: "/bookings",
        target: "booking-create-button",
        actionLabel: "Reservas",
      },
    ];

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

  public static getToolsForRole(role: string): AssistantToolDefinition[] {
    return Array.from(this.tools.values()).filter((t) =>
      t.allowedRoles.includes(role as any)
    );
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
    if (forbiddenPatterns.some((pattern) => name.toLowerCase().includes(pattern))) {
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

    // 4. Input Schema Validation via Zod (AI-SEC-008)
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
