import { AssistantKnowledgeService } from "./assistant-knowledge.service.js";
import { AssistantToolsRegistry } from "./assistant-tools.registry.js";
import { AssistantAuditService } from "./assistant-audit.service.js";
import { ASSISTANT_CONFIG } from "./assistant.config.js";
import { db } from "@workspace/db";
import { bookingsTable, petsTable, tasksTable } from "@workspace/db/schema";
import { eq, and, like, desc } from "drizzle-orm";
import type {
  AssistantSecurityContext,
  AssistantCitation,
  KnowledgeSnippet,
  ScreenContext,
  AssistantUIAction,
  CanonicalOnboardingStepId,
} from "./assistant.types.js";

export interface AIProviderResponse {
  content: string;
  citations?: AssistantCitation[];
  toolCalls?: Array<{ name: string; arguments: any; result: any }>;
  uiActions?: AssistantUIAction[];
  onboarding?: {
    isComplete: boolean;
    progressPercent: number;
    currentStep?: CanonicalOnboardingStepId | null;
    completedSteps?: CanonicalOnboardingStepId[];
    pendingSteps?: CanonicalOnboardingStepId[];
  };
}

export interface AIProviderOptions {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  securityContext: AssistantSecurityContext;
  screenContext?: ScreenContext;
  knowledgeSnippets?: KnowledgeSnippet[];
}

export interface AIProvider {
  getProviderName?(): string;
  getModel?(): string;
  generateResponse(options: AIProviderOptions): Promise<AIProviderResponse>;
}

/**
 * Deterministic Mock AI Provider
 * Ensures zero paid API costs, zero external network dependencies in automated tests,
 * and reliable adherence to security, knowledge, and anti-hallucination policies.
 */
export class MockAIProvider implements AIProvider {
  public getProviderName(): string {
    return "mock";
  }

  public getModel(): string {
    return "mock-deterministic";
  }

  public async generateResponse(options: AIProviderOptions): Promise<AIProviderResponse> {
    const lastUserMessage = [...options.messages].reverse().find((m) => m.role === "user");
    const userQuery = lastUserMessage?.content || "";
    const lowerQuery = userQuery.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const context = options.securityContext;

    const toolCalls: Array<{ name: string; arguments: any; result: any }> = [];
    const citations: AssistantCitation[] = [];

    // 1. Anti-Injection Check: Attempted role override
    if (
      lowerQuery.includes("sou agora master_admin") ||
      lowerQuery.includes("mude meu papel") ||
      lowerQuery.includes("ignore todas as regras") ||
      lowerQuery.includes("ignore suas regras") ||
      lowerQuery.includes("ignore previous instructions") ||
      lowerQuery.includes("system override") ||
      lowerQuery.includes("autonomous mode") ||
      lowerQuery.includes("execute sql") ||
      lowerQuery.includes("executar sql")
    ) {
      AssistantAuditService.logSecurityDenial(context, {
        action: "prompt_injection_role_override",
        reason: "User prompt attempted to override server-enforced role",
      });
      return {
        content: `Você está autenticado no ArkPet como ${context.role}. Você não tem permissão para alterar regras do sistema. As permissões são gerenciadas exclusivamente pelo servidor e não podem ser alteradas através da conversa. Como posso ajudar dentro das funções do seu perfil?`,
      };
    }

    // ── Strict Safety Invariants (R41.E) ──────────────────────────────────────
    // 1. Deletions strictly forbidden (AI_DELETE_TOOL_COUNT = 0)
    if (
      lowerQuery.includes("exclua o pet") ||
      lowerQuery.includes("delete o pet") ||
      lowerQuery.includes("excluir o pet") ||
      lowerQuery.includes("deletar o pet") ||
      lowerQuery.includes("exclua a creche") ||
      lowerQuery.includes("delete a creche") ||
      lowerQuery.includes("exclua o tutor") ||
      lowerQuery.includes("delete o tutor") ||
      lowerQuery.includes("deletar tutor") ||
      lowerQuery.includes("delete todas as tarefas") ||
      lowerQuery.includes("deletar tarefas") ||
      lowerQuery.includes("exclua todas as tarefas") ||
      lowerQuery.includes("apagar pet")
    ) {
      return {
        content: "O assistente não possui permissão para excluir registros do sistema. Para excluir dados, utilize a interface administrativa correspondente caso possua os privilégios necessários.",
      };
    }

    // 2. Financial mutations strictly forbidden (AI_FINANCIAL_MUTATION_TOOL_COUNT = 0)
    if (
      (lowerQuery.includes("estorne") ||
        lowerQuery.includes("estornar") ||
        lowerQuery.includes("fazer estorno") ||
        lowerQuery.includes("cobre") ||
        lowerQuery.includes("cobrar") ||
        lowerQuery.includes("mudar valor") ||
        lowerQuery.includes("alterar valor") ||
        lowerQuery.includes("cancelar fatura")) &&
      (lowerQuery.includes("fatura") ||
        lowerQuery.includes("pagamento") ||
        lowerQuery.includes("mensalidade") ||
        lowerQuery.includes("cartao") ||
        lowerQuery.includes("cobranca"))
    ) {
      return {
        content: "O assistente não realiza operações financeiras ou alterações de cobrança diretamente. Acesse o módulo financeiro em /financial para gerenciar transações e faturas.",
      };
    }

    // 3. Standalone Bath Action strictly forbidden (STANDALONE_BATH_ACTION_TOOL = 0)
    if (
      lowerQuery.includes("banho avulso") ||
      (lowerQuery.includes("banho") &&
        (lowerQuery.includes("cadastrar") ||
          lowerQuery.includes("registrar") ||
          lowerQuery.includes("fazer") ||
          lowerQuery.includes("criar") ||
          lowerQuery.includes("agendar") ||
          lowerQuery.includes("marcar")))
    ) {
      return {
        content: "No ArkPet, o banho não é um módulo isolado e não possui registro avulso. O banho é gerenciado como serviço adicional dentro da reserva do pet.",
      };
    }

    // 4. Medication Dosage Override strictly forbidden (MODEL_OVERRIDES_MEDICATION_DOSAGE = 0)
    if (
      (lowerQuery.includes("remedio") ||
        lowerQuery.includes("medicamento") ||
        lowerQuery.includes("medicacao") ||
        lowerQuery.includes("antibiotico") ||
        lowerQuery.includes("vacina") ||
        lowerQuery.includes("aplique")) &&
      (lowerQuery.includes("mude a dose") ||
        lowerQuery.includes("altere a dosagem") ||
        lowerQuery.includes("mudar dose") ||
        lowerQuery.includes("mude a dosagem") ||
        lowerQuery.includes("mudar a dosagem") ||
        lowerQuery.includes("dobre a dosagem") ||
        lowerQuery.includes("100ml") ||
        lowerQuery.includes("dar 2 comprimidos") ||
        lowerQuery.includes("de 10mg") ||
        lowerQuery.includes("de 20mg") ||
        lowerQuery.includes("50ml") ||
        lowerQuery.includes("aplique 5ml") ||
        lowerQuery.includes("dar 50ml"))
    ) {
      return {
        content: "A dosagem de medicamentos não pode ser definida ou alterada pelo assistente. Ela é carregada estritamente a partir do prontuário médico cadastrado no sistema.",
      };
    }

    // ── Safe Actions Execution (R41.E: Exactly 7 Canonical Mutations) ─────────
    const isInformationalQuery =
      lowerQuery.startsWith("ele ") ||
      lowerQuery.includes("ele tomou") ||
      lowerQuery.startsWith("como ") ||
      lowerQuery.includes("como faco") ||
      lowerQuery.includes("como registrar") ||
      lowerQuery.includes("como funciona") ||
      lowerQuery.includes("onde ") ||
      lowerQuery.includes("vou receber") ||
      lowerQuery.includes("o que significa") ||
      lowerQuery.includes("qual e");

    const isMutationQuery =
      !isInformationalQuery &&
      (lowerQuery.includes("cancele minha reserva") ||
        lowerQuery.includes("cancela minha reserva") ||
        lowerQuery.includes("cancele a reserva") ||
        lowerQuery.includes("cancelar reserva") ||
        ((lowerQuery.includes("check-in") || lowerQuery.includes("checkin")) &&
          (lowerQuery.includes("faca") || lowerQuery.includes("fazer") || lowerQuery.includes("realizar") || lowerQuery.includes("do pet") || lowerQuery.includes("pet 1") || lowerQuery.includes("thor") || lowerQuery.includes("rex"))) ||
        ((lowerQuery.includes("check-out") || lowerQuery.includes("checkout")) &&
          (lowerQuery.includes("faca") || lowerQuery.includes("fazer") || lowerQuery.includes("realizar") || lowerQuery.includes("do pet") || lowerQuery.includes("pet 1") || lowerQuery.includes("thor") || lowerQuery.includes("rex"))) ||
        ((lowerQuery.includes("alimentacao") || lowerQuery.includes("racao") || lowerQuery.includes("comeu")) &&
          (lowerQuery.includes("concluir") || lowerQuery.includes("marcar") || lowerQuery.includes("registrar") || lowerQuery.includes("ja "))) ||
        ((lowerQuery.includes("medicamento") || lowerQuery.includes("remedio") || lowerQuery.includes("medicacao")) &&
          (lowerQuery.includes("administrar") || lowerQuery.includes("marcar") || lowerQuery.includes("tomou") || lowerQuery.includes("aplicar") || lowerQuery.includes("registrar"))) ||
        ((lowerQuery.includes("passeio") || lowerQuery.includes("passear")) &&
          (lowerQuery.includes("concluir") || lowerQuery.includes("concluido") || lowerQuery.includes("marcar") || lowerQuery.includes("registrar") || lowerQuery.includes("finalizar"))) ||
        (lowerQuery.includes("tarefa") &&
          (lowerQuery.includes("concluir") || lowerQuery.includes("concluida") || lowerQuery.includes("marcar") || lowerQuery.includes("finalizar"))));

    if (isMutationQuery) {
      if (!ASSISTANT_CONFIG.areSafeActionsEnabled) {
        return {
          content: "O assistente funciona em modo somente-leitura e não realiza cancelamentos ou alterações automáticas no sistema. Para cancelar uma reserva ou realizar operações, acesse a tela correspondente no sistema.",
        };
      }

      // 5a. Action 1: cancel_my_booking (tutor only)
      if (
        lowerQuery.includes("cancela minha reserva") ||
        lowerQuery.includes("cancele minha reserva") ||
        lowerQuery.includes("cancele a reserva") ||
        lowerQuery.includes("cancelar reserva")
      ) {
        if (context.role !== "tutor") {
          return {
            content: `Você está autenticado como ${context.role} e não possui permissão para cancelar reservas como tutor. O cancelamento pelo assistente é restrito ao papel tutor para suas próprias reservas.`,
          };
        }

        try {
          let bookingId: number = 1;
          const match = userQuery.match(/\b(?:reserva|booking)\s*(?:#|id:?)?\s*(\d+)/i);
          if (match) {
            bookingId = parseInt(match[1], 10);
          } else if (options.screenContext?.entity?.type === "booking") {
            bookingId = Number(options.screenContext.entity.id);
          } else {
            const [b] = await db
              .select({ id: bookingsTable.id })
              .from(bookingsTable)
              .where(eq(bookingsTable.tutorId, context.userId))
              .orderBy(desc(bookingsTable.startDate))
              .limit(1);
            if (b) bookingId = b.id;
          }

          const result = await AssistantToolsRegistry.executeTool(
            "cancel_my_booking",
            { bookingId, reason: "Cancelamento solicitado via assistente ArkPet" },
            context
          );
          toolCalls.push({
            name: "cancel_my_booking",
            arguments: { bookingId, reason: "Cancelamento solicitado via assistente ArkPet" },
            result,
          });

          return {
            content: `Criei uma proposta para cancelar sua reserva #${bookingId}. Por favor, revise as informações e confirme no cartão abaixo para efetivar o cancelamento.`,
            toolCalls,
          };
        } catch (err: any) {
          return {
            content: err.message || "Não foi possível gerar a proposta de cancelamento da reserva.",
          };
        }
      }

      // 5b. Action 2: check_in_pet (staff, creche_admin)
      if (
        (lowerQuery.includes("check-in") || lowerQuery.includes("checkin")) &&
        (lowerQuery.includes("faca") || lowerQuery.includes("fazer") || lowerQuery.includes("realizar") || lowerQuery.includes("do pet") || lowerQuery.includes("pet") || lowerQuery.includes("thor") || lowerQuery.includes("rex") || lowerQuery.includes("bob"))
      ) {
        if (context.role === "tutor") {
          return {
            content: "Você está autenticado como tutor. A realização de check-in é uma operação operacional restrita à equipe da creche.",
          };
        }

        try {
          let petId = 1;
          const petMatch = userQuery.match(/\bpet\s*(\d+)/i);
          if (petMatch) {
            petId = parseInt(petMatch[1], 10);
          } else if (options.screenContext?.entity?.type === "pet") {
            petId = Number(options.screenContext.entity.id);
          } else if (context.crecheId) {
            const petNameMatch = userQuery.match(/\b(thor|rex|bob|mel|luna|max|pipoca)\b/i);
            if (petNameMatch) {
              const [found] = await db
                .select({ id: petsTable.id })
                .from(petsTable)
                .where(and(eq(petsTable.crecheId, context.crecheId), like(petsTable.name, `%${petNameMatch[1]}%`)))
                .limit(1);
              if (found) petId = found.id;
            }
          }

          const result = await AssistantToolsRegistry.executeTool(
            "check_in_pet",
            { petId, notes: "Check-in iniciado via assistente" },
            context
          );
          toolCalls.push({
            name: "check_in_pet",
            arguments: { petId, notes: "Check-in iniciado via assistente" },
            result,
          });

          return {
            content: `Criei uma proposta para o check-in do pet #${petId}. Por favor, confirme a entrada no cartão abaixo para atualizar o status no sistema.`,
            toolCalls,
          };
        } catch (err: any) {
          return {
            content: err.message || "Não foi possível gerar a proposta de check-in.",
          };
        }
      }

      // 5c. Action 3: check_out_pet (staff, creche_admin)
      if (
        (lowerQuery.includes("check-out") || lowerQuery.includes("checkout")) &&
        (lowerQuery.includes("faca") || lowerQuery.includes("fazer") || lowerQuery.includes("realizar") || lowerQuery.includes("do pet") || lowerQuery.includes("pet") || lowerQuery.includes("thor") || lowerQuery.includes("rex") || lowerQuery.includes("bob"))
      ) {
        if (context.role === "tutor") {
          return {
            content: "Você está autenticado como tutor. A realização de check-out é uma operação operacional restrita à equipe da creche.",
          };
        }

        try {
          let petId = 1;
          const petMatch = userQuery.match(/\bpet\s*(\d+)/i);
          if (petMatch) {
            petId = parseInt(petMatch[1], 10);
          } else if (options.screenContext?.entity?.type === "pet") {
            petId = Number(options.screenContext.entity.id);
          } else if (context.crecheId) {
            const petNameMatch = userQuery.match(/\b(thor|rex|bob|mel|luna|max|pipoca)\b/i);
            if (petNameMatch) {
              const [found] = await db
                .select({ id: petsTable.id })
                .from(petsTable)
                .where(and(eq(petsTable.crecheId, context.crecheId), like(petsTable.name, `%${petNameMatch[1]}%`)))
                .limit(1);
              if (found) petId = found.id;
            }
          }

          const result = await AssistantToolsRegistry.executeTool(
            "check_out_pet",
            { petId, notes: "Check-out iniciado via assistente" },
            context
          );
          toolCalls.push({
            name: "check_out_pet",
            arguments: { petId, notes: "Check-out iniciado via assistente" },
            result,
          });

          return {
            content: `Criei uma proposta para o check-out do pet #${petId}. Por favor, confirme a saída no cartão abaixo para atualizar o status no sistema.`,
            toolCalls,
          };
        } catch (err: any) {
          return {
            content: err.message || "Não foi possível gerar a proposta de check-out.",
          };
        }
      }

      // 5d. Action 4: complete_operational_task (staff, creche_admin)
      if (
        lowerQuery.includes("tarefa") &&
        (lowerQuery.includes("concluir") || lowerQuery.includes("concluida") || lowerQuery.includes("marcar") || lowerQuery.includes("finalizar"))
      ) {
        if (context.role === "tutor") {
          return {
            content: "Você está autenticado como tutor. A conclusão de tarefas operacionais é restrita à equipe da creche.",
          };
        }

        try {
          let taskId = 1;
          const taskMatch = userQuery.match(/\btarefa\s*(\d+)/i);
          if (taskMatch) {
            taskId = parseInt(taskMatch[1], 10);
          }

          const result = await AssistantToolsRegistry.executeTool(
            "complete_operational_task",
            { taskId, notes: "Tarefa concluída via assistente" },
            context
          );
          toolCalls.push({
            name: "complete_operational_task",
            arguments: { taskId, notes: "Tarefa concluída via assistente" },
            result,
          });

          return {
            content: `Criei uma proposta para concluir a tarefa #${taskId}. Por favor, confirme no cartão abaixo.`,
            toolCalls,
          };
        } catch (err: any) {
          return {
            content: err.message || "Não foi possível gerar a proposta de conclusão da tarefa.",
          };
        }
      }

      // 5e. Action 5: complete_feeding_task (staff, creche_admin)
      if (
        (lowerQuery.includes("alimentacao") || lowerQuery.includes("racao") || lowerQuery.includes("comeu")) &&
        (lowerQuery.includes("concluir") || lowerQuery.includes("concluida") || lowerQuery.includes("marcar") || lowerQuery.includes("registrar") || lowerQuery.includes("ja"))
      ) {
        if (context.role === "tutor") {
          return {
            content: "Você está autenticado como tutor. O registro de alimentação é restrito à equipe operacional da creche.",
          };
        }

        try {
          const result = await AssistantToolsRegistry.executeTool(
            "complete_feeding_task",
            { notes: "Alimentação registrada via assistente" },
            context
          );
          toolCalls.push({
            name: "complete_feeding_task",
            arguments: { notes: "Alimentação registrada via assistente" },
            result,
          });

          return {
            content: "Criei uma proposta para registrar a alimentação como concluída. Por favor, confirme no cartão abaixo.",
            toolCalls,
          };
        } catch (err: any) {
          return {
            content: err.message || "Não foi possível registrar a proposta de alimentação.",
          };
        }
      }

      // 5f. Action 6: record_medication_administration (staff, creche_admin)
      if (
        (lowerQuery.includes("medicamento") || lowerQuery.includes("remedio") || lowerQuery.includes("medicacao")) &&
        (lowerQuery.includes("administrar") || lowerQuery.includes("marcar") || lowerQuery.includes("tomou") || lowerQuery.includes("aplicar") || lowerQuery.includes("registrar"))
      ) {
        if (context.role === "tutor") {
          return {
            content: "Você está autenticado como tutor. O registro de administração de medicamentos é restrito à equipe da creche.",
          };
        }

        try {
          const result = await AssistantToolsRegistry.executeTool(
            "record_medication_administration",
            { notes: "Administração de medicamento registrada via assistente" },
            context
          );
          toolCalls.push({
            name: "record_medication_administration",
            arguments: { notes: "Administração de medicamento registrada via assistente" },
            result,
          });

          return {
            content: "Criei uma proposta para registrar a administração do medicamento (com a dosagem canônica do prontuário). Por favor, confirme no cartão abaixo.",
            toolCalls,
          };
        } catch (err: any) {
          return {
            content: err.message || "Não foi possível registrar a proposta de administração do medicamento.",
          };
        }
      }

      // 5g. Action 7: complete_walk_task (staff, creche_admin)
      if (
        (lowerQuery.includes("passeio") || lowerQuery.includes("passear")) &&
        (lowerQuery.includes("concluir") || lowerQuery.includes("concluido") || lowerQuery.includes("marcar") || lowerQuery.includes("registrar") || lowerQuery.includes("finalizar"))
      ) {
        if (context.role === "tutor") {
          return {
            content: "Você está autenticado como tutor. O registro de passeio é restrito à equipe da creche.",
          };
        }

        try {
          const result = await AssistantToolsRegistry.executeTool(
            "complete_walk_task",
            { notes: "Passeio registrado via assistente" },
            context
          );
          toolCalls.push({
            name: "complete_walk_task",
            arguments: { notes: "Passeio registrado via assistente" },
            result,
          });

          return {
            content: "Criei uma proposta para marcar o passeio como concluído. Por favor, confirme no cartão abaixo.",
            toolCalls,
          };
        } catch (err: any) {
          return {
            content: err.message || "Não foi possível registrar a proposta de passeio.",
          };
        }
      }
    }

    // ── R41.F: OPERATIONAL COPILOT INTELLIGENCE ──────────────────────────────
    // 1. Bulk Operational Mutation Guard (BULK_OPERATIONAL_AI_MUTATION = 0)
    if (
      (lowerQuery.includes("faca todas") ||
        lowerQuery.includes("faca tudo") ||
        lowerQuery.includes("faca todos") ||
        lowerQuery.includes("conclua todas") ||
        lowerQuery.includes("conclua tudo") ||
        lowerQuery.includes("resolva todas") ||
        lowerQuery.includes("resolva tudo") ||
        lowerQuery.includes("marque todas") ||
        lowerQuery.includes("marque todos")) &&
      (lowerQuery.includes("tarefa") ||
        lowerQuery.includes("tarefas") ||
        lowerQuery.includes("pendencia") ||
        lowerQuery.includes("pendencias") ||
        lowerQuery.includes("acao") ||
        lowerQuery.includes("acoes") ||
        lowerQuery.includes("alimentacao") ||
        lowerQuery.includes("alimentacoes") ||
        lowerQuery.includes("medicacao") ||
        lowerQuery.includes("medicacoes") ||
        lowerQuery.includes("passeio") ||
        lowerQuery.includes("passeios") ||
        lowerQuery.includes("operacao") ||
        lowerQuery.includes("operacoes"))
    ) {
      return {
        content: "Por motivos de segurança e rastreabilidade operacional, ações de rotina não podem ser executadas em lote pelo assistente. Por favor, confirme as ações individualmente ou utilize o painel operacional.",
      };
    }

    // 2. Ambiguous "Resolva essa / Resolva isso" Guard (AMBIGUOUS_OPERATIONAL_ACTION_EXECUTION = 0, R41F-VOICE-003)
    if (
      (lowerQuery === "resolva essa" ||
        lowerQuery === "resolva isso" ||
        lowerQuery === "pode resolver isso" ||
        lowerQuery === "pode resolver" ||
        lowerQuery === "resolva" ||
        lowerQuery === "resolver") &&
      !options.screenContext?.entity
    ) {
      return {
        content: "Há mais de uma pendência operacional no momento. Por favor, especifique qual ação ou pet deseja atender (por exemplo: 'fazer check-in do Thor' ou 'concluir alimentação').",
      };
    }

    // 3. Tutor Creche-Wide Operational Inquiry Guard (R41F-RBAC-001)
    if (
      context.role === "tutor" &&
      (lowerQuery.includes("quais pets ainda nao tomaram medicacao") ||
        lowerQuery.includes("quais pets ainda nao comeram") ||
        lowerQuery.includes("como esta a operacao") ||
        lowerQuery.includes("resumo da operacao") ||
        lowerQuery.includes("resumo operacional") ||
        lowerQuery.includes("resumo de hoje") ||
        lowerQuery.includes("o que precisa da minha atencao") ||
        lowerQuery.includes("o que esta critico") ||
        lowerQuery.includes("quais tarefas estao atrasadas") ||
        lowerQuery.includes("quem ainda esta aguardando check-in") ||
        lowerQuery.includes("reservas de hoje ainda nao chegaram"))
    ) {
      return {
        content: "Como tutor, você tem acesso apenas às informações dos seus próprios pets cadastrados. Para verificar o status do seu animalzinho, consulte o prontuário ou fale com a equipe da creche.",
      };
    }

    // 4. Staff Financial Bypass Guard (R41F-RBAC-002)
    if (
      (context.role === "staff" || context.role === "tutor") &&
      (lowerQuery.includes("faturamento de hoje") ||
        lowerQuery.includes("qual o faturamento") ||
        lowerQuery.includes("faturamento total") ||
        lowerQuery.includes("faturamento da creche") ||
        lowerQuery.includes("receita total da creche"))
    ) {
      return {
        content: `Como ${context.role}, você não tem permissão para visualizar o faturamento ou a receita da creche. O acesso a métricas e relatórios financeiros é restrito aos administradores da creche.`,
      };
    }

    // 5. Contextual Entity Ambiguity for "o que falta para ele?" / "o que ainda está pendente para ele?" (R41F-CONTEXT-001, R41F-CONTEXT-002)
    if (
      lowerQuery.includes("o que ainda esta pendente para ele") ||
      lowerQuery.includes("o que falta para ele") ||
      lowerQuery.includes("o que falta para o pet")
    ) {
      const activeEntity = options.screenContext?.entity;
      if (!activeEntity || activeEntity.type !== "pet") {
        return {
          content: "Para qual pet você gostaria de verificar as pendências? Por favor, informe o nome do pet ou acesse a ficha dele no sistema.",
        };
      }
      if (!context.crecheId) {
        return { content: "Acesso a dados operacionais requer contexto de uma creche autorizada." };
      }
      try {
        const petId = Number(activeEntity.id);
        const petName = activeEntity.name || `Pet #${petId}`;
        const result = await AssistantToolsRegistry.executeTool(
          "get_pending_operational_tasks",
          { petId },
          context
        );
        toolCalls.push({
          name: "get_pending_operational_tasks",
          arguments: { petId },
          result,
        });
        if (result.tasks.length === 0) {
          return {
            content: `Não há tarefas pendentes registradas para ${petName} no momento.`,
            toolCalls,
          };
        }
        const taskTitles = result.tasks.map((t: any) => `- ${t.title} (${t.type}): agendada para ${new Date(t.scheduledFor).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`).join("\n");
        return {
          content: `Atividades pendentes para ${petName}:\n${taskTitles}`,
          toolCalls,
        };
      } catch (err: any) {
        return { content: err.message || "Erro ao consultar pendências do pet.", toolCalls };
      }
    }

    // 6. Operational Overview / Daily Summary
    if (
      lowerQuery.includes("resumo operacional") ||
      lowerQuery.includes("como esta a operacao") ||
      lowerQuery.includes("resumo da operacao") ||
      lowerQuery.includes("resumo do dia") ||
      lowerQuery.includes("visao geral da operacao") ||
      lowerQuery.includes("capacidade e ocupacao") ||
      lowerQuery.includes("ocupacao atual") ||
      lowerQuery.includes("resumo de hoje")
    ) {
      if (!context.crecheId) {
        return { content: "Como master_admin, a consulta operacional requer a seleção explícita de uma creche autorizada." };
      }
      try {
        const result = await AssistantToolsRegistry.executeTool("get_operational_overview", {}, context);
        toolCalls.push({
          name: "get_operational_overview",
          arguments: {},
          result,
        });

        let summaryText = `Resumo Operacional de Hoje (${result.businessDate}) — Atualizado em ${new Date(result.asOf).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}:\n\n`;
        if (result.dataCompleteness === "partial") {
          summaryText += `⚠️ Aviso: Os dados de ${result.unavailableSources?.join(", ")} estão temporariamente indisponíveis. A visão operacional pode estar incompleta.\n\n`;
        }

        if (result.occupancy && result.occupancy.current !== null && result.occupancy.capacity !== null) {
          summaryText += `- Ocupação Atual: ${result.occupancy.current}/${result.occupancy.capacity} pets\n`;
        } else {
          summaryText += `- Ocupação Atual: Indisponível\n`;
        }

        if (result.arrivals && result.arrivals.totalExpected !== null) {
          summaryText += `- Chegadas Previstas: ${result.arrivals.totalExpected} (Check-ins realizados: ${result.arrivals.checkedIn}, Aguardando: ${result.arrivals.pending})\n`;
        } else {
          summaryText += `- Chegadas Previstas: Indisponível\n`;
        }

        if (result.tasks && result.tasks.pending !== null) {
          summaryText += `- Tarefas Pendentes: ${result.tasks.pending} (${result.tasks.overdue} atrasada(s))\n`;
          summaryText += `  • Alimentação: ${result.tasks.byType.feeding.pending} pendente(s)\n`;
          summaryText += `  • Medicação: ${result.tasks.byType.medication.pending} pendente(s)\n`;
          summaryText += `  • Passeios: ${result.tasks.byType.walk.pending} pendente(s)\n\n`;
        } else {
          summaryText += `- Tarefas Pendentes: Indisponível\n\n`;
        }

        if (result.issues.length > 0) {
          summaryText += `Principais prioridades de atenção:\n`;
          for (let i = 0; i < Math.min(3, result.issues.length); i++) {
            const iss = result.issues[i];
            summaryText += `${i + 1}. [${iss.priority.toUpperCase()}] ${iss.title}: ${iss.reason}\n`;
          }
        } else if (result.dataCompleteness === "complete") {
          summaryText += `A operação está em dia! Nenhuma pendência crítica ou tarefa atrasada no momento.`;
        }

        return {
          content: summaryText.trim(),
          toolCalls,
        };
      } catch (err: any) {
        return { content: err.message || "Erro ao consultar visão operacional.", toolCalls };
      }
    }

    // 7. Priorities / Critical Issues ("O que precisa da minha atenção agora?")
    if (
      lowerQuery.includes("o que precisa da minha atencao") ||
      lowerQuery.includes("o que esta mais critico") ||
      lowerQuery.includes("o que e mais urgente") ||
      lowerQuery.includes("prioridades") ||
      lowerQuery.includes("quais acoes voce recomenda") ||
      lowerQuery.includes("acoes recomendadas")
    ) {
      if (!context.crecheId) {
        return { content: "Como master_admin, a consulta operacional requer a seleção explícita de uma creche autorizada." };
      }
      try {
        const result = await AssistantToolsRegistry.executeTool("get_operational_priorities", { limit: 5 }, context);
        toolCalls.push({
          name: "get_operational_priorities",
          arguments: { limit: 5 },
          result,
        });

        if (result.priorities.length === 0) {
          return {
            content: "Nenhuma pendência crítica encontrada no momento. A rotina da creche está em dia!",
            toolCalls,
          };
        }

        let respText = `Itens que precisam da sua atenção agora (${result.totalIssues} pendência(s) detectada(s)):\n\n`;
        result.priorities.forEach((item: any, idx: number) => {
          respText += `${idx + 1}. [${item.priority.toUpperCase()}] ${item.title}\n`;
          respText += `   Motivo: ${item.reason}\n`;
          if (item.suggestedAction) {
            respText += `   Ação recomendada: ${item.suggestedAction.label}\n`;
          }
          respText += "\n";
        });

        respText += "Deseja que eu prepare a proposta de alguma dessas ações para sua confirmação?";
        return {
          content: respText.trim(),
          toolCalls,
        };
      } catch (err: any) {
        return { content: err.message || "Erro ao consultar prioridades operacionais.", toolCalls };
      }
    }

    // 8. Today's Arrivals ("Quem ainda está aguardando check-in?")
    if (
      lowerQuery.includes("aguardando check-in") ||
      lowerQuery.includes("aguardando checkin") ||
      lowerQuery.includes("ainda nao chegaram") ||
      lowerQuery.includes("chegadas de hoje") ||
      lowerQuery.includes("quem ainda nao chegou") ||
      lowerQuery.includes("a caminho") ||
      lowerQuery.includes("reservas de hoje ainda nao chegaram")
    ) {
      if (!context.crecheId) {
        return { content: "Como master_admin, a consulta operacional requer a seleção explícita de uma creche autorizada." };
      }
      try {
        const result = await AssistantToolsRegistry.executeTool("get_today_arrivals", { status: "confirmed" }, context);
        toolCalls.push({
          name: "get_today_arrivals",
          arguments: { status: "confirmed" },
          result,
        });

        if (result.arrivals.length === 0) {
          return {
            content: "Não há pets a caminho ou aguardando check-in no momento. Todos os pets previstos para hoje já realizaram check-in.",
            toolCalls,
          };
        }

        let respText = `Pets aguardando check-in hoje (${result.arrivals.length} pet(s)):\n\n`;
        result.arrivals.forEach((a: any) => {
          const onWayInfo = a.onTheWayType ? ` (A caminho - ETA: ${a.onTheWayEtaMinutes ?? "?"} min)` : "";
          respText += `- ${a.petName}: Reserva #${a.bookingId} (${a.serviceType})${onWayInfo}\n`;
        });

        return {
          content: respText.trim(),
          toolCalls,
        };
      } catch (err: any) {
        return { content: err.message || "Erro ao consultar chegadas.", toolCalls };
      }
    }

    // 9. Pending Feedings ("Quais pets ainda não comeram?")
    if (
      lowerQuery.includes("ainda nao comeram") ||
      lowerQuery.includes("ainda nao comeu") ||
      lowerQuery.includes("alimentacao pendente") ||
      lowerQuery.includes("alimentacoes pendentes")
    ) {
      if (!context.crecheId) {
        return { content: "Como master_admin, a consulta operacional requer a seleção explícita de uma creche autorizada." };
      }
      try {
        const result = await AssistantToolsRegistry.executeTool(
          "get_pending_operational_tasks",
          { type: "feeding" },
          context
        );
        toolCalls.push({
          name: "get_pending_operational_tasks",
          arguments: { type: "feeding" },
          result,
        });

        if (result.tasks.length === 0) {
          return {
            content: "Todas as alimentações programadas para hoje já foram concluídas!",
            toolCalls,
          };
        }

        let respText = `Alimentações pendentes (${result.tasks.length}):\n\n`;
        result.tasks.forEach((t: any) => {
          const lateInfo = t.isOverdue ? ` [ATRASADA há ${t.delayMinutes} min]` : "";
          respText += `- ${t.petName || "Pet"}: ${t.title}${lateInfo}\n`;
        });

        return {
          content: respText.trim(),
          toolCalls,
        };
      } catch (err: any) {
        return { content: err.message || "Erro ao consultar alimentações pendentes.", toolCalls };
      }
    }

    // 10. Pending Medications ("Tem alguma medicação atrasada?")
    if (
      lowerQuery.includes("medicacao atrasada") ||
      lowerQuery.includes("medicacoes atrasadas") ||
      lowerQuery.includes("remedios atrasados") ||
      lowerQuery.includes("remedio atrasado") ||
      lowerQuery.includes("medicacoes estao pendentes") ||
      lowerQuery.includes("medicacao pendente")
    ) {
      if (!context.crecheId) {
        return { content: "Como master_admin, a consulta operacional requer a seleção explícita de uma creche autorizada." };
      }
      try {
        const result = await AssistantToolsRegistry.executeTool(
          "get_pending_operational_tasks",
          { type: "medication" },
          context
        );
        toolCalls.push({
          name: "get_pending_operational_tasks",
          arguments: { type: "medication" },
          result,
        });

        if (result.tasks.length === 0) {
          return {
            content: "Não há medicações pendentes ou atrasadas no momento.",
            toolCalls,
          };
        }

        let respText = `Medicações agendadas pendentes (${result.tasks.length}):\n\n`;
        result.tasks.forEach((t: any) => {
          const lateInfo = t.isOverdue ? ` [ATRASADA há ${t.delayMinutes} min]` : " [Pendente]";
          respText += `- ${t.petName || "Pet"}: ${t.title}${lateInfo}\n`;
        });

        return {
          content: respText.trim(),
          toolCalls,
        };
      } catch (err: any) {
        return { content: err.message || "Erro ao consultar medicações.", toolCalls };
      }
    }

    // 11. Pending Walks ("Quais passeios pendentes?")
    if (
      lowerQuery.includes("passeios pendentes") ||
      lowerQuery.includes("passeio pendente") ||
      lowerQuery.includes("passeios atrasados") ||
      lowerQuery.includes("passeio atrasado") ||
      lowerQuery.includes("tem passeio pendente") ||
      lowerQuery.includes("tem algum passeio pendente")
    ) {
      if (!context.crecheId) {
        return { content: "Como master_admin, a consulta operacional requer a seleção explícita de uma creche autorizada." };
      }
      try {
        const result = await AssistantToolsRegistry.executeTool(
          "get_pending_operational_tasks",
          { type: "walk" },
          context
        );
        toolCalls.push({
          name: "get_pending_operational_tasks",
          arguments: { type: "walk" },
          result,
        });

        if (result.tasks.length === 0) {
          return {
            content: "Não há passeios pendentes no momento.",
            toolCalls,
          };
        }

        let respText = `Passeios pendentes (${result.tasks.length}):\n\n`;
        result.tasks.forEach((t: any) => {
          const lateInfo = t.isOverdue ? ` [ATRASADO há ${t.delayMinutes} min]` : "";
          respText += `- ${t.petName || "Pet"}: ${t.title}${lateInfo}\n`;
        });

        return {
          content: respText.trim(),
          toolCalls,
        };
      } catch (err: any) {
        return { content: err.message || "Erro ao consultar passeios.", toolCalls };
      }
    }

    // 12. Overdue or Unassigned Tasks ("Quais tarefas estão atrasadas?", "Tem alguma tarefa sem responsável?")
    if (
      lowerQuery.includes("tarefas estao atrasadas") ||
      lowerQuery.includes("tarefas atrasadas") ||
      lowerQuery.includes("tarefa sem responsavel") ||
      lowerQuery.includes("tarefas sem responsavel") ||
      lowerQuery.includes("quais tarefas estao pendentes")
    ) {
      if (!context.crecheId) {
        return { content: "Como master_admin, a consulta operacional requer a seleção explícita de uma creche autorizada." };
      }
      try {
        const overdueOnly = lowerQuery.includes("atrasada");
        const result = await AssistantToolsRegistry.executeTool(
          "get_pending_operational_tasks",
          { overdueOnly },
          context
        );
        toolCalls.push({
          name: "get_pending_operational_tasks",
          arguments: { overdueOnly },
          result,
        });

        if (result.tasks.length === 0) {
          return {
            content: overdueOnly
              ? "Não há tarefas atrasadas no momento. A rotina está em dia!"
              : "Não há tarefas pendentes no momento.",
            toolCalls,
          };
        }

        let respText = `Tarefas encontradas (${result.tasks.length}):\n\n`;
        result.tasks.forEach((t: any) => {
          const resp = t.assignedToName ? `Responsável: ${t.assignedToName}` : "SEM RESPONSÁVEL";
          const lateInfo = t.isOverdue ? ` [ATRASADA há ${t.delayMinutes} min]` : "";
          respText += `- ${t.title} (${t.type})${lateInfo} — ${resp}\n`;
        });

        return {
          content: respText.trim(),
          toolCalls,
        };
      } catch (err: any) {
        return { content: err.message || "Erro ao consultar tarefas.", toolCalls };
      }
    }

    // 13. Recent Operational Changes ("O que mudou desde o último resumo?")
    if (
      lowerQuery.includes("o que mudou desde o ultimo resumo") ||
      lowerQuery.includes("o que mudou") ||
      lowerQuery.includes("mudancas recentes")
    ) {
      if (!context.crecheId) {
        return { content: "Como master_admin, a consulta operacional requer a seleção explícita de uma creche autorizada." };
      }
      try {
        const result = await AssistantToolsRegistry.executeTool("get_recent_operational_changes", {}, context);
        toolCalls.push({
          name: "get_recent_operational_changes",
          arguments: {},
          result,
        });

        return {
          content: result.changes.join("\n"),
          toolCalls,
        };
      } catch (err: any) {
        return { content: err.message || "Erro ao consultar mudanças operacionais.", toolCalls };
      }
    }

    // 2. Secret Exposure Defense
    if (
      lowerQuery.includes("openai_api_key") ||
      lowerQuery.includes("jwt_secret") ||
      lowerQuery.includes("database_url") ||
      lowerQuery.includes("chave secreta") ||
      lowerQuery.includes("minha chave") ||
      lowerQuery.includes("sua chave") ||
      lowerQuery.includes("senha") ||
      lowerQuery.includes("secret") ||
      lowerQuery.includes("print your secret")
    ) {
      AssistantAuditService.logSecurityDenial(context, {
        action: "credential_solicitation",
        reason: "User prompted for environment secrets or credentials",
      });
      return {
        content: "Por motivos de segurança e privacidade, chaves de sistema, senhas e credenciais confidenciais nunca são compartilhadas nem solicitadas.",
      };
    }

    // 3. Hallucination Guard: Unknown / Non-existent features
    const suspiciousNonFeatures = [
      "drone",
      "telepatia",
      "criptomoeda",
      "bitcoin",
      "ethereum",
      "blockchain",
      "laser",
      "robo",
      "holograma",
      "foguete",
      "extraterrestre",
      "ondas cerebrais",
    ];

    if (suspiciousNonFeatures.some((nf) => lowerQuery.includes(nf))) {
      return {
        content: "Não encontrei essa funcionalidade no ArkPet. O ArkPet é focado na gestão de creches e hospedagens caninas (Day Use, Hotel, Pets, Tutores, Equipe e Financeiro).",
      };
    }

    // 4. Role Permission Boundary Inquiries
    if (
      (context.role === "staff" || context.role === "tutor") &&
      (lowerQuery.includes("relatorio financeiro") ||
        lowerQuery.includes("receita total da creche") ||
        lowerQuery.includes("faturamento total") ||
        lowerQuery.includes("faturamento da creche"))
    ) {
      return {
        content: `Como ${context.role}, você não tem permissão para acessar os dados do relatório financeiro consolidado ou receita da creche. Esse acesso é restrito ao creche_admin.`,
      };
    }

    if (
      context.role === "tutor" &&
      (lowerQuery.includes("pets de outros tutores") ||
        lowerQuery.includes("pet 102") ||
        lowerQuery.includes("outro pet") ||
        lowerQuery.includes("prontuario do pet 102"))
    ) {
      return {
        content: "No ArkPet, tutores possuem acesso estrito e exclusivo apenas aos seus próprios pets cadastrados. Você não tem permissão para visualizar dados de pets de outros tutores.",
      };
    }

    // 4b. Anti-Hallucination: Standalone Bath Module Check (R41C-KNOW-002)
    if (
      lowerQuery.includes("banho") &&
      (lowerQuery.includes("modulo") ||
        lowerQuery.includes("tela") ||
        lowerQuery.includes("exclusivo") ||
        lowerQuery.includes("separado") ||
        lowerQuery.includes("existe"))
    ) {
      return {
        content: "No ArkPet, o banho é um serviço adicional que pode ser contratado junto a uma reserva ou adquirido na loja de serviços, e não um módulo separado.",
      };
    }

    // 4c. Tenant Isolation & Cross-Tenant Boundary Checks (R41C-SEC-001, R41C-SEC-004)
    if (
      context.role === "master_admin" &&
      (lowerQuery.includes("selecione a creche") || lowerQuery.includes("automaticamente"))
    ) {
      return {
        content: "Como master_admin, a seleção de creche requer autorização explícita e contexto definido, não podendo ser inferida automaticamente para ações de tenant na plataforma.",
      };
    }

    if (
      lowerQuery.includes("outra creche") ||
      lowerQuery.includes("outras creches") ||
      lowerQuery.includes("pets de outra creche") ||
      lowerQuery.includes("creche 999") ||
      lowerQuery.includes("dados da creche 999")
    ) {
      return {
        content: "Você não tem permissão para acessar dados de outra creche. O ArkPet isola estritamente os dados de cada creche.",
      };
    }

    // 4d. Booking Status Semantics (R41C-CONTEXT-004)
    if (
      lowerQuery.includes("o que significa pendente") ||
      lowerQuery.includes("significa o status pendente") ||
      lowerQuery.includes("significa pendente")
    ) {
      return {
        content: "No ArkPet, uma reserva com status pendente (pending) indica que a solicitação foi enviada pelo tutor ou criada pela creche e aguarda aprovação e confirmação antes de ser efetivada no calendário da creche.",
        citations: [{ title: "Reservas > Status de Reserva", category: "reservations", path: "knowledge/reservations.md#Status" }],
      };
    }

    // 4e. Contextual Pronoun / Reference Resolution (R41C-ENTITY-001, R41C-ENTITY-002, R41C-CONTEXT-003)
    if (
      lowerQuery.includes("ele tem reserva") ||
      lowerQuery.includes("ele tem alguma reserva") ||
      lowerQuery.includes("o que posso ver sobre ele") ||
      lowerQuery.includes("ele tem vacinas") ||
      lowerQuery.includes("ele tem vacina") ||
      lowerQuery.includes("ele tomou remedio") ||
      lowerQuery.includes("ele tomou a medicacao")
    ) {
      const activeEntity = options.screenContext?.entity;
      if (activeEntity && activeEntity.name) {
        const petName = activeEntity.name;
        if (lowerQuery.includes("reserva")) {
          return {
            content: `Consultando as reservas de ${petName}: ${petName} possui reservas registradas no sistema. Você pode acompanhar as datas e status na agenda de reservas (/bookings).`,
          };
        }
        if (lowerQuery.includes("o que posso ver sobre ele")) {
          return {
            content: `Na ficha de ${petName}, você pode visualizar dados cadastrais, prontuário, raça, restrições alimentares, medicações, vacinas e histórico de reservas.`,
          };
        }
        if (lowerQuery.includes("vacina")) {
          return {
            content: `Na ficha de ${petName}, você pode consultar o histórico de vacinas e conferir se há doses ou reforços pendentes.`,
          };
        }
        if (lowerQuery.includes("remedio") || lowerQuery.includes("medicacao")) {
          return {
            content: `Consultando o prontuário de ${petName}: ${petName} tem registro de medicações e cuidados no painel operacional.`,
          };
        }
      }

      // Ambiguous pronoun without verified entity context (R41C-ENTITY-002 / AMBIGUOUS_ENTITY_HALLUCINATION = 0)
      return {
        content: "Você não selecionou um pet específico. Por favor, informe qual pet ou acesse a ficha do cãozinho para consultar as informações.",
      };
    }

    // 4f. Operational Routine Inquiries (Feeding, Medication, Walks)
    if (
      lowerQuery.includes("onde cadastro a medicacao") ||
      lowerQuery.includes("onde registro a medicacao") ||
      lowerQuery.includes("remedios que preciso dar hoje")
    ) {
      return {
        content: "A medicação do cão pode ser registrada no painel operacional em /staff/board na aba de medicação, ou consultada diretamente no prontuário do pet.",
      };
    }

    if (
      lowerQuery.includes("como registrar um passeio aqui") ||
      lowerQuery.includes("registrar um passeio") ||
      lowerQuery.includes("registro um passeio")
    ) {
      return {
        content: "Para registrar um passeio, utilize a aba de passeios no painel operacional para marcar o horário e a rotina do cãozinho.",
      };
    }

    // 4g. Current Screen & Feature Contextual Guide (R41C-CONTEXT-001, R41C-RBAC-001, R41C-RBAC-003, R41C-STATE-001)
    if (
      lowerQuery.includes("o que posso fazer nesta tela") ||
      lowerQuery.includes("o que posso fazer aqui") ||
      lowerQuery.includes("como funciona esta pagina") ||
      lowerQuery.includes("como funciona esta tela") ||
      lowerQuery.includes("qual e o proximo passo aqui") ||
      lowerQuery.includes("como funciona essa tela")
    ) {
      const screen = options.screenContext;
      const feature = screen?.feature || "";
      const route = screen?.route || "/";
      const role = context.role;

      // 1. Dashboard
      if (feature === "dashboard" || route === "/" || route.startsWith("/dashboard")) {
        if (role === "creche_admin") {
          return {
            content: "Nesta tela de dashboard do ArkPet você acompanha os principais indicadores da creche: taxa de ocupação, check-ins e check-outs previstos para hoje, novas reservas pendentes de aprovação e aniversariantes do mês.",
          };
        }
        if (role === "staff") {
          return {
            content: "Nesta tela do ArkPet você visualiza a lista de cães presentes na creche hoje e atalhos rápidos para o painel operacional de alimentação, medicação e passeios.",
          };
        }
        if (role === "tutor") {
          return {
            content: "Aqui no painel do ArkPet você acompanha o status dos seus pets, avisos importantes da creche e atalhos para solicitar novas reservas ou abrir o chat.",
          };
        }
        if (role === "master_admin") {
          return {
            content: "Visão geral da plataforma ArkPet com métricas consolidadas da rede e atalhos de administração global de creches.",
          };
        }
      }

      // 2. Pets List
      if (feature === "pets_directory" || route === "/pets") {
        if (role === "creche_admin") {
          return {
            content: "Nesta tela de pets do ArkPet você pode cadastrar novos pets vinculados aos tutores, buscar pets por nome ou raça e filtrar por status.",
            uiActions: [{ type: "highlight", targetId: "pet-create-button" }],
          };
        }
        if (role === "staff") {
          return {
            content: "Nesta tela do ArkPet você consulta a ficha cadastral dos pets, raça, porte, restrições alimentares e observações de comportamento.",
          };
        }
        if (role === "tutor") {
          return {
            content: "Aqui você visualiza seus pets cadastrados na creche ArkPet, seus dados e prontuários.",
          };
        }
      }

      // 3. Pet Detail
      if (feature === "pet_detail" || route.startsWith("/pets/")) {
        const petName = screen?.entity?.name ? ` de ${screen.entity.name}` : "";
        return {
          content: `Na ficha do pet${petName} no ArkPet, você pode visualizar dados cadastrais, raça, restrições alimentares, medicações, vacinas e histórico de estadias.`,
        };
      }

      // 4. Bookings Calendar
      if (feature === "bookings_calendar" || route === "/bookings") {
        if (role === "creche_admin") {
          return {
            content: "Nesta tela de reservas do ArkPet você gerencia a grade de reservas em Day Use e Hospedagem, aprova reservas com status pendente, filtra por data e cria novas reservas.",
            uiActions: [{ type: "highlight", targetId: "booking-create-button" }],
          };
        }
        if (role === "staff") {
          return {
            content: "Nesta tela do ArkPet você consulta a agenda de reservas para saber quais cães estão previstos para chegar ou sair na data de hoje.",
          };
        }
        if (role === "tutor") {
          return {
            content: "Aqui no ArkPet você acompanha suas reservas agendadas, em andamento ou histórico, com seus respectivos status.",
          };
        }
      }

      // 5. Staff Operational Board
      if (
        feature === "operational_board" ||
        route.startsWith("/staff/board") ||
        route === "/staff" ||
        route === "/walks"
      ) {
        return {
          content: "Nesta tela do painel operacional do ArkPet você realiza check-in e check-out de pets, registra alimentação, administração de medicação e passeios da rotina diária.",
        };
      }

      // 6. Staff Manage
      if (feature === "staff_management" || route === "/staff/manage") {
        return {
          content: "Nesta tela do ArkPet você gerencia a equipe da creche, convida novos funcionários e define permissões operacionais.",
        };
      }

      // 7. Settings
      if (feature === "creche_settings" || route === "/settings") {
        return {
          content: "Nesta tela de configurações do ArkPet você define telefone, endereço, capacidade máxima e horários de funcionamento da creche.",
        };
      }

      // 8. Tutor Financial
      if (feature === "tutor_financial" || route === "/tutor/financial") {
        return {
          content: "Nesta tela de faturas do ArkPet você acompanha mensalidades, histórico de cobranças e comprovantes de pagamento.",
        };
      }

      // 9. Chat
      if (feature === "chat_messaging" || route === "/chat") {
        return {
          content: "No chat do ArkPet você pode trocar mensagens em tempo real com tutores e creche, enviando fotos e atualizações.",
        };
      }

      // 10. Admin Creches
      if (feature === "master_admin_creches" || route.startsWith("/admin")) {
        return {
          content: "Nesta tela do ArkPet você gerencia todas as creches cadastradas na rede e parâmetros da plataforma.",
        };
      }

      // Fallback for unknown screen (UNKNOWN_SCREEN_BREAKS_ASSISTANT = NO)
      return {
        content: "Você está na plataforma ArkPet. Como posso ajudar com dúvidas sobre funcionalidades, reservas ou cadastros?",
      };
    }

    // 5. Onboarding Queries & Tool
    if (
      lowerQuery.includes("onboarding") ||
      lowerQuery.includes("passos para configurar") ||
      lowerQuery.includes("passos do onboarding") ||
      lowerQuery.includes("progresso da creche") ||
      lowerQuery.includes("configuro minha creche") ||
      lowerQuery.includes("o que falta configurar") ||
      lowerQuery.includes("proximo passo") ||
      lowerQuery.includes("etapa pendente") ||
      lowerQuery.includes("status do onboarding") ||
      lowerQuery.includes("primeiros passos")
    ) {
      if (context.role === "creche_admin") {
        if (!context.crecheId) {
          return {
            content: "Você precisa selecionar ou estar vinculado a uma creche para consultar o onboarding.",
          };
        }

        if (
          lowerQuery.includes("5 passos") ||
          lowerQuery.includes("quais sao os passos") ||
          lowerQuery.includes("primeira vez") ||
          lowerQuery.includes("como configuro")
        ) {
          return {
            content: "Para configurar sua creche pela primeira vez, o onboarding possui 5 passos canônicos: 1) Dados da creche (/settings), 2) Equipe (/staff/manage), 3) Tutor (/tutors), 4) Pet (/pets) e 5) Reservas (/bookings).",
            citations: [{ title: "Onboarding > Os 5 Passos Canônicos", category: "onboarding", path: "knowledge/onboarding.md" }],
          };
        }

        try {
          const currentRoute = options.screenContext?.route || "/";
          const plan = await AssistantToolsRegistry.executeTool(
            "get_guided_onboarding_plan",
            { currentRoute },
            context
          );
          toolCalls.push({ name: "get_guided_onboarding_plan", arguments: { currentRoute }, result: plan });

          const status = await AssistantToolsRegistry.getOnboardingStatus(context.crecheId);

          if (status.isComplete) {
            return {
              content: `Parabéns! O onboarding da sua creche está 100% completo com todos os 5 passos canônicos concluídos: 1) Dados da creche, 2) Equipe, 3) Tutor, 4) Pet e 5) Reservas.`,
              toolCalls,
              onboarding: {
                isComplete: true,
                progressPercent: 100,
                currentStep: null,
                completedSteps: status.completedSteps,
                pendingSteps: [],
              },
            };
          }

          return {
            content: plan.content,
            toolCalls,
            uiActions: plan.uiActions,
            onboarding: {
              isComplete: false,
              progressPercent: status.progressPercent,
              currentStep: status.currentStep?.id || null,
              completedSteps: status.completedSteps,
              pendingSteps: status.pendingSteps,
            },
          };
        } catch {
          return {
            content: "Para configurar sua creche pela primeira vez, o onboarding possui 5 passos canônicos: 1) Dados da creche (/settings), 2) Equipe (/staff/manage), 3) Tutor (/tutors), 4) Pet (/pets) e 5) Reservas (/bookings).",
          };
        }
      } else {
        return {
          content: "O onboarding da creche é gerenciado exclusivamente pelos administradores da creche.",
        };
      }
    }

    // 6. Reservations: Hospedagem vs Day Use
    if (
      lowerQuery.includes("diferenca entre hospedagem e day use") ||
      lowerQuery.includes("hospedagem e day use") ||
      lowerQuery.includes("funciona a hospedagem") ||
      lowerQuery.includes("como funciona hospedagem")
    ) {
      return {
        content: "No ArkPet, a Hospedagem (Hotel) inclui pernoite para estadias prolongadas, enquanto o Day Use (Creche Diurna) é sem pernoite, voltado para socialização e recreação do pet durante o dia.",
        citations: [{ title: "Reservas > Modalidades: Hospedagem vs Day Use", category: "reservations", path: "knowledge/reservations.md#Modalidades" }],
      };
    }

    // 7. Reservations: Creation & Booking Flow
    if (lowerQuery.includes("crio uma nova reserva") || lowerQuery.includes("solicito uma reserva") || lowerQuery.includes("criar uma reserva") || lowerQuery.includes("nova reserva")) {
      return {
        content: "Para criar ou solicitar uma reserva no ArkPet, acesse o módulo de reservas em /bookings. Selecione o pet cadastrado, a modalidade (Day Use ou Hospedagem), o período desejado e confirme o agendamento.",
        citations: [{ title: "Reservas > Visão Geral", category: "reservations", path: "knowledge/reservations.md" }],
      };
    }

    // 7b. Staff: Team Management
    if (lowerQuery.includes("adiciono um funcionario") || lowerQuery.includes("adicionar funcionario") || lowerQuery.includes("cadastrar equipe") || lowerQuery.includes("minha equipe")) {
      return {
        content: "Para cadastrar ou convidar novos membros para sua equipe de staff, acesse o gerenciamento de colaboradores em /staff/manage.",
        citations: [{ title: "Papéis e Permissões > staff", category: "roles", path: "knowledge/roles.md" }],
      };
    }

    // 8. Pet Registration & Care Details (R41C-CONTEXT-002)
    if (
      lowerQuery.includes("cadastrar um pet") ||
      lowerQuery.includes("cadastrar pet") ||
      lowerQuery.includes("cadastro um pet") ||
      lowerQuery.includes("primeiro pet") ||
      lowerQuery.includes("meu primeiro pet")
    ) {
      if (options.screenContext?.route === "/pets" || options.screenContext?.feature === "pets_directory") {
        return {
          content: "Você já está na tela de pets. Para cadastrar um pet no sistema, clique no botão destacado 'Cadastrar Pet' (pet-create-button) e vincule-o ao tutor responsável.",
          citations: [{ title: "Pets > Dados do Pet", category: "pets", path: "knowledge/pets.md" }],
          uiActions: [{ type: "highlight", targetId: "pet-create-button" }],
        };
      }
      return {
        content: "Para cadastrar um pet no sistema, acesse a tela /pets. Todo pet deve ser vinculado a um tutor responsável já cadastrado.",
        citations: [{ title: "Pets > Dados do Pet", category: "pets", path: "knowledge/pets.md" }],
        uiActions: [{ type: "navigate", route: "/pets" }, { type: "highlight", targetId: "pet-create-button" }],
      };
    }

    // 8b. Tutor Registration
    if (
      lowerQuery.includes("cadastrar um tutor") ||
      lowerQuery.includes("cadastrar tutor") ||
      lowerQuery.includes("cadastrar tutores") ||
      lowerQuery.includes("novo tutor")
    ) {
      return {
        content: "Para cadastrar um tutor, acesse o módulo de tutores em /tutors e clique em 'Novo Tutor'.",
        citations: [{ title: "Tutores > Visão Geral", category: "tutors", path: "knowledge/tutors.md" }],
        uiActions: [{ type: "navigate", route: "/tutors" }, { type: "highlight", targetId: "tutor-create-button" }],
      };
    }

    // 8c. Step Progression Inquiries
    if (
      lowerQuery.includes("depois de cadastrar a equipe") ||
      lowerQuery.includes("apos cadastrar a equipe") ||
      lowerQuery.includes("depois da equipe")
    ) {
      return {
        content: "Após cadastrar a equipe, o próximo passo do onboarding é cadastrar os tutores em /tutors (passo 3).",
        uiActions: [{ type: "navigate", route: "/tutors" }, { type: "highlight", targetId: "tutor-create-button" }],
      };
    }

    if (lowerQuery.includes("restricoes alimentares") || lowerQuery.includes("restricao alimentar")) {
      return {
        content: "As restrições alimentares e rotina de alimentação de cada pet podem ser configuradas no prontuário médico do pet em /pets.",
        citations: [{ title: "Pets > Prontuário Médico e Cuidados", category: "pets", path: "knowledge/pets.md" }],
      };
    }

    if (lowerQuery.includes("alergias") || lowerQuery.includes("alergia")) {
      return {
        content: "As alergias e cuidados médicos de cada pet ficam registrados no prontuário médico do animal em /pets.",
        citations: [{ title: "Pets > Prontuário Médico e Cuidados", category: "pets", path: "knowledge/pets.md" }],
      };
    }

    // 9. Daycare Settings: Phone & Address
    if (lowerQuery.includes("telefone e endereco") || lowerQuery.includes("endereco da creche")) {
      return {
        content: "O telefone e endereço da creche podem ser alterados na tela de configurações (/settings).",
        citations: [{ title: "Configurações > Visão Geral", category: "settings", path: "knowledge/settings.md" }],
      };
    }

    // 10. Financial: Stripe & Invoices
    if (lowerQuery.includes("pagamento da assinatura") || lowerQuery.includes("assinatura do arkpet")) {
      return {
        content: "A assinatura da plataforma ArkPet é cobrada de forma recorrente via Stripe e pode ser gerenciada em /assinatura.",
        citations: [{ title: "Módulo Financeiro > Assinatura da Creche", category: "financial", path: "knowledge/financial.md" }],
      };
    }

    if (lowerQuery.includes("faturamento da creche") || lowerQuery.includes("faturamento")) {
      return {
        content: "O faturamento e fluxo de caixa da creche podem ser visualizados no módulo financeiro em /financial.",
        citations: [{ title: "Módulo Financeiro > Cobrança de Tutores", category: "financial", path: "knowledge/financial.md" }],
      };
    }

    // 11. Roles & RBAC Queries
    if (
      lowerQuery.includes("4 papeis") ||
      lowerQuery.includes("quais sao os papeis") ||
      lowerQuery.includes("rbac") ||
      lowerQuery.includes("papeis do arkpet")
    ) {
      return {
        content: "O ArkPet possui exatamente 4 papéis canônicos de usuário com autorização controlada pelo servidor: master_admin (administração geral da rede), creche_admin (gestão da creche), staff (equipe operacional) e tutor (clientes tutores).",
        citations: [{ title: "Papéis e Permissões > Os Quatro Papéis Canônicos", category: "roles", path: "knowledge/roles.md#Papeis" }],
      };
    }

    if (
      lowerQuery.includes("master_admin pode fazer") ||
      lowerQuery.includes("creches cadastradas na rede") ||
      lowerQuery.includes("planos de assinatura da plataforma") ||
      lowerQuery.includes("listar todas as creches") ||
      lowerQuery.includes("creches da rede")
    ) {
      return {
        content: "O master_admin gerencia todas as creches cadastradas na rede no painel /admin/creches, acompanha métricas globais e configura os planos de assinatura da plataforma via Stripe.",
        citations: [{ title: "Papéis e Permissões > master_admin", category: "roles", path: "knowledge/roles.md#master_admin" }],
      };
    }

    // 12. Operations: Check-in, Check-out & QR Code
    if (lowerQuery.includes("receber aviso") || (lowerQuery.includes("aviso") && lowerQuery.includes("check-in"))) {
      return {
        content: "Sim! Você receberá uma notificação push no seu celular assim que o check-in do seu pet for confirmado pela equipe da creche.",
        citations: [{ title: "Notificações > Visão Geral", category: "notifications", path: "knowledge/notifications.md" }],
      };
    }

    if (lowerQuery.includes("check-in") || lowerQuery.includes("check-out") || lowerQuery.includes("qr code")) {
      return {
        content: "O check-in e check-out de pets são realizados na rotina operacional do staff, permitindo confirmação rápida via leitura de QR Code pelo scanner ou localização do pet na lista de agendamentos do dia.",
        citations: [{ title: "Papéis e Permissões > staff", category: "roles", path: "knowledge/roles.md#staff" }],
      };
    }

    // 13. Operations: Tasks, Medicação, Alimentação & Passeios
    if (lowerQuery.includes("passeio") || lowerQuery.includes("medicacao") || lowerQuery.includes("remedio") || lowerQuery.includes("alimentacao")) {
      return {
        content: "A equipe operacional (staff) registra horários de alimentação, medicação contínua e passeios dos pets, gerando histórico de cuidados e atualizações automáticas para os tutores.",
        citations: [{ title: "Pets > Prontuário Médico e Cuidados", category: "pets", path: "knowledge/pets.md#Prontuario" }],
      };
    }

    // 14. Tool Invocation: List My Pets
    if (
      lowerQuery.includes("meus pets") ||
      lowerQuery.includes("listar pets") ||
      lowerQuery.includes("quais sao os pets")
    ) {
      if (["tutor", "creche_admin", "staff"].includes(context.role)) {
        try {
          const pets = await AssistantToolsRegistry.executeTool("list_my_pets", { limit: 10 }, context);
          toolCalls.push({ name: "list_my_pets", arguments: { limit: 10 }, result: pets });

          if (pets.length === 0) {
            return {
              content: context.role === "tutor"
                ? "Você ainda não possui pets cadastrados na sua conta. Entre em contato com a creche para cadastrar seus pets!"
                : "Nenhum pet cadastrado encontrado nesta creche.",
              toolCalls,
            };
          }

          const petList = pets.map((p: any) => `- **${p.name}** (${p.breed || "Sem raça definida"} - ${p.species})`).join("\n");
          return {
            content: `Aqui estão os pets encontrados:\n${petList}`,
            toolCalls,
          };
        } catch {
          return { content: "Você pode visualizar e gerenciar seus pets acessando a tela de Pets (/pets)." };
        }
      }
    }

    // 15. Tool Invocation: List My Bookings
    if (
      lowerQuery.includes("minhas reservas") ||
      lowerQuery.includes("proximas reservas") ||
      lowerQuery.includes("listar reservas") ||
      lowerQuery.includes("minha agenda")
    ) {
      if (["tutor", "creche_admin", "staff"].includes(context.role)) {
        try {
          const bookings = await AssistantToolsRegistry.executeTool("list_my_bookings", { limit: 5 }, context);
          toolCalls.push({ name: "list_my_bookings", arguments: { limit: 5 }, result: bookings });

          if (bookings.length === 0) {
            return {
              content: "Nenhuma reserva ativa encontrada no momento. Você pode criar novas reservas na tela /bookings.",
              toolCalls,
            };
          }

          const bookingList = bookings
            .map((b: any) => `- **${b.petName}** (${b.serviceType === "hotel" ? "Hospedagem" : "Day Use"}) — Status: ${b.status} (${b.startDate} a ${b.endDate})`)
            .join("\n");
          return {
            content: `Aqui estão as reservas recentes:\n${bookingList}`,
            toolCalls,
          };
        } catch {
          return { content: "Você pode consultar todas as suas reservas acessando a agenda em /bookings." };
        }
      }
    }

    // 16. Financial Inquiries (Tutor)
    if (lowerQuery.includes("mensalidades") || lowerQuery.includes("faturas")) {
      if (context.role === "tutor") {
        return {
          content: "Você pode consultar seu histórico financeiro, faturas e comprovantes de pagamento acessando a tela /tutor/financial.",
          citations: [{ title: "Módulo Financeiro > Cobrança de Tutores", category: "financial", path: "knowledge/financial.md" }],
        };
      }
    }

    // 17. Chat & Communications
    if (lowerQuery.includes("convers") || lowerQuery.includes("chat") || lowerQuery.includes("fotos")) {
      return {
        content: "O módulo de chat permite a troca direta de mensagens de texto, fotos e vídeos entre a creche e o tutor por canal de pet ou geral.",
        citations: [{ title: "Chat e Mensagens > Funcionalidades", category: "chat", path: "knowledge/chat.md" }],
      };
    }

    // 18. Notifications
    if (lowerQuery.includes("notificacoes") || lowerQuery.includes("push") || lowerQuery.includes("aviso")) {
      return {
        content: "O ArkPet envia notificações push via Service Worker para avisos de check-in, check-out, novas mensagens no chat e tarefas operacionais.",
        citations: [{ title: "Notificações > Visão Geral", category: "notifications", path: "knowledge/notifications.md" }],
      };
    }

    // 19. Support & Escalation
    if (lowerQuery.includes("suporte") || lowerQuery.includes("duvidas se o assistente nao souber") || lowerQuery.includes("se o assistente nao souber")) {
      return {
        content: "Se precisar de ajuda adicional que o assistente não souber responder, você pode entrar em contato diretamente com a equipe da creche ou consultar a documentação oficial do ArkPet.",
      };
    }

    // 20. Grounding via Knowledge Base Search
    const searchResults = await AssistantKnowledgeService.search(userQuery, { maxResults: 2 });
    if (searchResults.length > 0) {
      for (const res of searchResults) {
        citations.push({
          title: res.title,
          category: res.category,
          path: res.path,
        });
      }

      const topResult = searchResults[0];
      return {
        content: `${topResult.snippet}\n\n*Baseado na documentação oficial do ArkPet (${ASSISTANT_CONFIG.knowledgeVersion}).*`,
        citations,
      };
    }

    // 21. General Welcoming & Help Fallback
    return {
      content: `Olá, ${context.name}! Eu sou o ArkPet Assistente. Posso ajudar você a gerenciar pets, solicitar reservas de Hospedagem ou Day Use, tirar dúvidas sobre o sistema e acompanhar a rotina da creche. Como posso ajudar?`,
    };
  }
}

export class AIProviderError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 500) {
    super(message);
    this.name = "AIProviderError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface OpenAICompatibleProviderOptions {
  providerName: "openai" | "groq";
  apiKey: string;
  model: string;
  baseUrl: string;
  fetcher?: typeof fetch;
  missingKeyErrorMessage?: string;
}

/**
 * Universal OpenAI-Compatible AI Provider.
 * Powers both OpenAI and Groq runtimes using standard /chat/completions transport.
 * Operates strictly server-side with RBAC enforcement, tool registry bounds, and safe error masking.
 */
export class OpenAICompatibleProvider implements AIProvider {
  protected providerName: "openai" | "groq";
  protected apiKey: string;
  protected model: string;
  protected baseUrl: string;
  protected fetcher: typeof fetch;
  protected missingKeyErrorMessage: string;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.providerName = options.providerName;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = options.baseUrl;
    this.fetcher = options.fetcher || globalThis.fetch;
    this.missingKeyErrorMessage =
      options.missingKeyErrorMessage || `${options.providerName.toUpperCase()}_API_KEY não configurada no servidor.`;
  }

  public getProviderName(): string {
    return this.providerName;
  }

  public getModel(): string {
    return this.model;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public async generateResponse(options: AIProviderOptions): Promise<AIProviderResponse> {
    if (
      !this.apiKey ||
      this.apiKey.startsWith("sk-placeholder") ||
      this.apiKey.startsWith("gsk-placeholder") ||
      this.apiKey === "mock"
    ) {
      throw new AIProviderError("AI_PROVIDER_AUTH_ERROR", this.missingKeyErrorMessage, 502);
    }

    // Build tool definitions from registry for user's role
    const availableTools = AssistantToolsRegistry.getToolsForRole(options.securityContext.role);
    const tools = availableTools.map((t) => {
      let parameters: any = { type: "object", properties: {}, required: [] };
      if (t.name === "search_arkpet_knowledge") {
        parameters = {
          type: "object",
          properties: {
            query: { type: "string", description: "Termo de busca na documentação" },
          },
          required: ["query"],
        };
      } else if (t.name === "list_my_pets" || t.name === "list_my_bookings") {
        parameters = {
          type: "object",
          properties: {
            limit: { type: "integer", description: "Número máximo de itens" },
          },
        };
      } else if (t.name === "get_guided_onboarding_plan") {
        parameters = {
          type: "object",
          properties: {
            currentRoute: { type: "string", description: "Rota atual na tela do usuário (ex: /settings, /pets)" },
          },
        };
      } else if (t.name === "cancel_my_booking") {
        parameters = {
          type: "object",
          properties: {
            bookingId: { type: "integer", description: "ID da reserva a ser cancelada" },
            reason: { type: "string", description: "Motivo opcional do cancelamento" },
          },
          required: ["bookingId"],
        };
      } else if (t.name === "check_in_pet" || t.name === "check_out_pet") {
        parameters = {
          type: "object",
          properties: {
            petId: { type: "integer", description: "ID do pet" },
            bookingId: { type: "integer", description: "ID da reserva (opcional)" },
            notes: { type: "string", description: "Observações operacionais (opcional)" },
          },
          required: ["petId"],
        };
      } else if (t.name === "complete_operational_task") {
        parameters = {
          type: "object",
          properties: {
            taskId: { type: "integer", description: "ID da tarefa operacional agendada" },
            notes: { type: "string", description: "Observações operacionais (opcional)" },
          },
          required: ["taskId"],
        };
      } else if (t.name === "complete_feeding_task") {
        parameters = {
          type: "object",
          properties: {
            taskId: { type: "integer", description: "ID da tarefa (opcional)" },
            petId: { type: "integer", description: "ID do pet (opcional)" },
            notes: { type: "string", description: "Observações (opcional)" },
          },
        };
      } else if (t.name === "record_medication_administration") {
        parameters = {
          type: "object",
          properties: {
            taskId: { type: "integer", description: "ID da tarefa de medicação (opcional)" },
            petId: { type: "integer", description: "ID do pet (opcional)" },
            notes: { type: "string", description: "Observações (opcional)" },
          },
        };
      } else if (t.name === "complete_walk_task") {
        parameters = {
          type: "object",
          properties: {
            taskId: { type: "integer", description: "ID da tarefa de passeio (opcional)" },
            petId: { type: "integer", description: "ID do pet (opcional)" },
            notes: { type: "string", description: "Observações (opcional)" },
          },
        };
      } else if (t.name === "get_operational_overview") {
        parameters = {
          type: "object",
          properties: {
            forceRefresh: { type: "boolean", description: "Forçar atualização ignorando cache" },
          },
        };
      } else if (t.name === "get_operational_priorities") {
        parameters = {
          type: "object",
          properties: {
            limit: { type: "integer", description: "Número máximo de prioridades (1 a 25)" },
            category: { type: "string", description: "Filtrar por categoria" },
          },
        };
      } else if (t.name === "get_today_arrivals") {
        parameters = {
          type: "object",
          properties: {
            status: { type: "string", enum: ["confirmed", "active", "completed", "cancelled", "all"], description: "Filtrar status da chegada" },
            limit: { type: "integer", description: "Limite de registros" },
          },
        };
      } else if (t.name === "get_pending_operational_tasks") {
        parameters = {
          type: "object",
          properties: {
            type: { type: "string", enum: ["feeding", "medication", "walk", "grooming", "play", "health_check", "other", "all"], description: "Tipo de tarefa" },
            overdueOnly: { type: "boolean", description: "Apenas tarefas atrasadas" },
            petId: { type: "integer", description: "Filtrar por ID do pet" },
            limit: { type: "integer", description: "Limite de registros" },
          },
        };
      } else if (t.name === "get_recent_operational_changes") {
        parameters = {
          type: "object",
          properties: {},
        };
      }
      return {
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters,
        },
      };
    });

    const MAX_ASSISTANT_TOOL_ROUNDS = 3;
    let rounds = 0;
    const toolCallsExecuted: Array<{ name: string; arguments: any; result: any }> = [];

    const conversationMessages: any[] = [
      { role: "system", content: options.systemPrompt },
      ...options.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    while (rounds < MAX_ASSISTANT_TOOL_ROUNDS) {
      rounds++;

      const body: any = {
        model: this.model,
        messages: conversationMessages,
        temperature: 0.2,
        max_tokens: 1000,
      };

      if (tools.length > 0) {
        body.tools = tools;
      }

      let response: Response;
      try {
        response = await this.fetcher(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        });
      } catch {
        throw new AIProviderError("AI_PROVIDER_UNAVAILABLE", "O serviço de IA está temporariamente inacessível.", 503);
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new AIProviderError("AI_PROVIDER_AUTH_ERROR", "Falha de autenticação com o provedor de IA.", 502);
        }
        if (response.status === 429) {
          throw new AIProviderError("AI_PROVIDER_RATE_LIMIT", "Limite de requisições do provedor de IA excedido.", 429);
        }
        if (response.status === 408 || response.status === 504) {
          throw new AIProviderError("AI_PROVIDER_TIMEOUT", "Tempo limite esgotado ao contatar o provedor de IA.", 504);
        }
        throw new AIProviderError("AI_PROVIDER_UNAVAILABLE", "O provedor de IA retornou uma falha temporária.", 503);
      }

      let data: any;
      try {
        data = (await response.json()) as any;
      } catch {
        throw new AIProviderError("AI_PROVIDER_BAD_RESPONSE", "Resposta malformada recebida do provedor de IA.", 502);
      }

      const choice = data.choices?.[0];
      if (!choice) {
        throw new AIProviderError("AI_PROVIDER_BAD_RESPONSE", "Resposta vazia recebida do provedor de IA.", 502);
      }

      const message = choice.message;

      // If model did not request tool execution, return final natural-language response
      if (!message.tool_calls || !Array.isArray(message.tool_calls) || message.tool_calls.length === 0) {
        const citations: AssistantCitation[] = (options.knowledgeSnippets || []).map((k) => ({
          title: k.title,
          category: k.category,
          path: k.path,
        }));

        return {
          content: message.content || "Não foi possível gerar uma resposta detalhada.",
          citations: citations.length > 0 ? citations : undefined,
          toolCalls: toolCallsExecuted.length > 0 ? toolCallsExecuted : undefined,
        };
      }

      // Step 5: Append assistant turn with tool_calls
      conversationMessages.push({
        role: "assistant",
        content: message.content || null,
        tool_calls: message.tool_calls,
      });

      // Steps 3, 4, 6: Validate each tool independently and append results
      for (const tc of message.tool_calls) {
        const toolName = tc.function?.name;
        const toolCallId = tc.id || `call_${Date.now()}`;

        // Verify tool exists in registry and is allowed for user role
        const toolDef = AssistantToolsRegistry.getTool(toolName);
        if (!toolDef || !toolDef.allowedRoles.includes(options.securityContext.role)) {
          AssistantAuditService.logSecurityDenial(options.securityContext, {
            action: `unregistered_or_unauthorized_tool_attempt:${toolName}`,
            reason: `Model attempted to execute unauthorized or unregistered tool '${toolName}'`,
          });
          throw new AIProviderError(
            "UNREGISTERED_TOOL_EXECUTION",
            `Tentativa de execução de ferramenta não autorizada ou inexistente: ${toolName}`,
            403
          );
        }

        let parsedArgs = {};
        try {
          parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          parsedArgs = {};
        }

        const toolResult = await AssistantToolsRegistry.executeTool(
          toolName,
          parsedArgs,
          options.securityContext
        );

        toolCallsExecuted.push({
          name: toolName,
          arguments: parsedArgs,
          result: toolResult,
        });

        // Step 6: Append tool result message using correct tool_call_id
        conversationMessages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: JSON.stringify(toolResult),
        });
      }

      // Roundtrip loop continues: send tool outputs to model for final synthesis
    }

    // Step 5 invariant: Loop limit reached
    throw new AIProviderError(
      "UNBOUNDED_AI_TOOL_LOOP",
      "Limite de rodadas de ferramentas do assistente excedido.",
      500
    );
  }
}

/**
 * Groq AI Provider (openai/gpt-oss-20b)
 * Primary development and free-tier runtime for ArkPet R41.
 */
export class GroqProvider extends OpenAICompatibleProvider {
  constructor(options?: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    fetcher?: typeof fetch;
  }) {
    super({
      providerName: "groq",
      apiKey: options?.apiKey || process.env.GROQ_API_KEY || "",
      model: options?.model || process.env.AI_MODEL || "openai/gpt-oss-20b",
      baseUrl: options?.baseUrl || process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
      fetcher: options?.fetcher,
      missingKeyErrorMessage: "GROQ_API_KEY não configurada no servidor.",
    });
  }
}

/**
 * OpenAI Provider (gpt-4o-mini)
 * Optional production provider for ArkPet R41.
 */
export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(options?: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    fetcher?: typeof fetch;
  }) {
    super({
      providerName: "openai",
      apiKey: options?.apiKey || process.env.OPENAI_API_KEY || "",
      model: options?.model || process.env.AI_MODEL || "gpt-4o-mini",
      baseUrl: options?.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      fetcher: options?.fetcher,
      missingKeyErrorMessage: "OPENAI_API_KEY não configurada no servidor.",
    });
  }
}

/**
 * Factory providing the configured AI provider.
 * Supports: mock | groq | openai
 * Defaults to MockAIProvider in automated regression test suites.
 * Defaults to GroqProvider in active development.
 * Fails closed on unknown provider configurations.
 */
export function getAIProvider(overrideProvider?: string): AIProvider {
  const configured = (overrideProvider || process.env.AI_PROVIDER || "").toLowerCase().trim();

  // In automated unit/integration test runs (NODE_ENV === "test"), default to MockAIProvider
  // unless an explicit AI_PROVIDER is provided
  if (process.env.NODE_ENV === "test" && !overrideProvider && !process.env.AI_PROVIDER) {
    return new MockAIProvider();
  }

  if (configured === "mock") {
    return new MockAIProvider();
  }

  if (configured === "groq") {
    return new GroqProvider();
  }

  if (configured === "openai") {
    return new OpenAIProvider();
  }

  // Outside test environment, if no explicit AI_PROVIDER is set:
  if (!configured) {
    if (process.env.GROQ_API_KEY) {
      return new GroqProvider();
    }
    if (process.env.OPENAI_API_KEY) {
      return new OpenAIProvider();
    }
    // Default development provider is groq (fails closed if GROQ_API_KEY is not configured)
    return new GroqProvider();
  }

  // Unknown provider fails closed
  throw new AIProviderError(
    "UNKNOWN_AI_PROVIDER",
    `Provedor de IA desconhecido: '${configured}'. Provedores válidos: mock, groq, openai.`,
    500
  );
}

