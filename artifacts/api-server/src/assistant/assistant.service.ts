import crypto from "crypto";
import { ASSISTANT_CONFIG } from "./assistant.config.js";
import { AssistantContextService } from "./assistant-context.service.js";
import { AssistantKnowledgeService } from "./assistant-knowledge.service.js";
import { AssistantAuditService } from "./assistant-audit.service.js";
import { AssistantGuidanceService } from "./assistant-guidance.service.js";
import { getAIProvider, type AIProvider } from "./assistant.provider.js";
import { AssistantSafeActionService } from "./assistant-safe-action.service.js";
import { OperationalSnapshotService } from "./operational-snapshot.service.js";
import type {
  AssistantSecurityContext,
  AssistantSession,
  AssistantMessage,
  ScreenContext,
  AssistantSafeActionPayload,
  OperationalCopilotResponse,
} from "./assistant.types.js";

export class AssistantService {
  private static sessions: Map<string, AssistantSession> = new Map();
  private static provider: AIProvider = getAIProvider();

  public static setProvider(provider: AIProvider): void {
    this.provider = provider;
  }

  public static getOrCreateSession(
    sessionId: string | undefined,
    context: AssistantSecurityContext
  ): AssistantSession {
    const now = new Date().toISOString();

    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId)!;
      // Confirm security scoping (userId, crecheId, and role must all match)
      if (
        session.userId === context.userId &&
        session.crecheId === context.crecheId &&
        session.role === context.role
      ) {
        session.lastActivityAt = now;
        return session;
      }
    }

    // If existing sessionId did not match security context, generate a fresh ID
    const newId = sessionId && !this.sessions.has(sessionId) ? sessionId : `sess_${crypto.randomUUID()}`;
    const newSession: AssistantSession = {
      id: newId,
      userId: context.userId,
      crecheId: context.crecheId,
      role: context.role,
      messages: [],
      createdAt: now,
      lastActivityAt: now,
    };

    this.sessions.set(newId, newSession);
    return newSession;
  }

  public static clearSession(sessionId: string, context: AssistantSecurityContext): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== context.userId) {
      return false;
    }
    this.sessions.delete(sessionId);
    return true;
  }

  public static async processMessage(
    userMessage: string,
    sessionId: string | undefined,
    context: AssistantSecurityContext,
    screenContext?: Partial<ScreenContext>
  ): Promise<{
    session: { id: string };
    message: AssistantMessage;
  }> {
    const startTime = Date.now();

    // 1. Kill Switch & Feature Flag Gate
    if (ASSISTANT_CONFIG.isKillSwitchActive) {
      const err = new Error("O assistente ArkPet está temporariamente desativado pelo administrador.");
      (err as any).statusCode = 503;
      throw err;
    }

    if (!ASSISTANT_CONFIG.isAssistantEnabled) {
      const err = new Error("O assistente ArkPet está desativado nesta instância.");
      (err as any).statusCode = 503;
      throw err;
    }

    // 1b. Deterministic Natural Language Safe Actions Resolution (R41.E)
    // ZERO LLM involvement in confirmation/cancellation execution path (CONFIRMATION_EXECUTION_LLM_CALL = 0)
    if (ASSISTANT_CONFIG.areSafeActionsEnabled) {
      // Check confirmation
      const confirmResolution = await AssistantSafeActionService.resolveAndConfirmFromInput(userMessage, context);
      if (confirmResolution.confirmed && confirmResolution.result) {
        const session = this.getOrCreateSession(sessionId, context);
        session.messages.push({
          id: `msg_${crypto.randomUUID()}`,
          role: "user",
          content: userMessage,
          createdAt: new Date().toISOString(),
        });

        const actionPayload: AssistantSafeActionPayload = {
          type: confirmResolution.result.actionType || "confirmed_action",
          state: "executed",
          pendingActionId: confirmResolution.result.pendingActionId,
          targetType: confirmResolution.result.targetType,
          targetId: confirmResolution.result.targetId,
          result: confirmResolution.result.result,
          summary: "Ação confirmada e executada com sucesso.",
          executedAt: new Date().toISOString(),
        };

        const successText =
          confirmResolution.result.actionType === "cancel_my_booking"
            ? "Ação confirmada com sucesso! Sua reserva foi cancelada no sistema."
            : "Ação confirmada com sucesso! A operação foi concluída no sistema.";

        const assistantMsgRecord: AssistantMessage = {
          id: `msg_${crypto.randomUUID()}`,
          role: "assistant",
          content: successText,
          createdAt: new Date().toISOString(),
          action: actionPayload,
        };

        session.messages.push(assistantMsgRecord);

        AssistantAuditService.logMessageTurn(context, {
          messageId: assistantMsgRecord.id,
          role: "assistant",
          provider: "deterministic_safe_action",
          model: "deterministic_r41_e",
          durationMs: Date.now() - startTime,
        });

        return {
          session: { id: session.id },
          message: assistantMsgRecord,
        };
      } else if (confirmResolution.ambiguous) {
        // AMBIGUOUS_CONFIRMATION_EXECUTION = 0
        const session = this.getOrCreateSession(sessionId, context);
        session.messages.push({
          id: `msg_${crypto.randomUUID()}`,
          role: "user",
          content: userMessage,
          createdAt: new Date().toISOString(),
        });

        const assistantMsgRecord: AssistantMessage = {
          id: `msg_${crypto.randomUUID()}`,
          role: "assistant",
          content: "Você possui mais de uma ação pendente de confirmação. Por favor, utilize os botões de confirmação do cartão da ação desejada.",
          createdAt: new Date().toISOString(),
        };

        session.messages.push(assistantMsgRecord);

        return {
          session: { id: session.id },
          message: assistantMsgRecord,
        };
      }

      // Check cancellation
      const cancelResolution = await AssistantSafeActionService.resolveAndCancelFromInput(userMessage, context);
      if (cancelResolution.cancelled) {
        const session = this.getOrCreateSession(sessionId, context);
        session.messages.push({
          id: `msg_${crypto.randomUUID()}`,
          role: "user",
          content: userMessage,
          createdAt: new Date().toISOString(),
        });

        const assistantMsgRecord: AssistantMessage = {
          id: `msg_${crypto.randomUUID()}`,
          role: "assistant",
          content: "A proposta de ação foi cancelada. Nenhuma alteração foi realizada no sistema.",
          createdAt: new Date().toISOString(),
          action: {
            type: "cancelled_action",
            state: "cancelled",
            pendingActionId: cancelResolution.pendingActionId,
            summary: "Proposta de ação cancelada pelo usuário.",
          },
        };

        session.messages.push(assistantMsgRecord);

        return {
          session: { id: session.id },
          message: assistantMsgRecord,
        };
      }
    }

    // 2. Resolve Server Context
    const resolvedContext = await AssistantContextService.resolveContext(context, screenContext);

    // 3. Retrieve relevant knowledge snippets
    const snippets = await AssistantKnowledgeService.search(userMessage, { maxResults: 2 });
    const formattedSnippets = snippets.map((s) => `### ${s.title}\n${s.snippet}`).join("\n\n");

    // 4. Build System Prompt (Hierarchy Level 1 - Level 5) (r41-e-1)
    const entityInfo = resolvedContext.screen.entity
      ? `Entidade Ativa na Tela: ${resolvedContext.screen.entity.type} "${resolvedContext.screen.entity.name || resolvedContext.screen.entity.id}" (ID: ${resolvedContext.screen.entity.id})`
      : "Nenhuma entidade específica selecionada no momento.";

    const systemPrompt = `Você é o "ArkPet Assistente" (ArkPet AI), o copiloto inteligente e guia de produto integrado do ArkPet (Versão do prompt: ${ASSISTANT_CONFIG.promptVersion}).
Sua missão é ajudar os usuários a utilizarem o sistema com eficiência, segurança, contexto e rapidez.

=== GUIA CONTEXTUAL DE PRODUTO (R41.C) ===
- Você é consciente do contexto da tela onde o usuário está navegando agora:
  - Tela Atual: ${resolvedContext.screen.title || "ArkPet"} (${resolvedContext.screen.route})
  - Recurso do Sistema: ${resolvedContext.screen.feature}
  - ${entityInfo}
- Resolução de Pronomes e Referências Contextuais:
  - Se houver uma entidade ativa (ex: Pet "Thor"), pronomes como "ele", "dele", "o cão" referem-se estritamente à entidade ativa autorizada.
  - Se NÃO houver entidade ativa selecionada e o usuário fizer perguntas ambíguas como "Ele tem reserva?", NUNCA invente ou adivinhe o pet. Esclareça educadamente qual é o pet ou oriente a acessar a ficha do pet.
- Explicação Consciente de Papel (Role-Aware Product Guidance):
  - Explique as ações e funcionalidades desta tela adequadas ao papel autenticado (${context.role}).
  - Para staff, foque em tarefas de rotina (check-in/out, alimentação, remédios, passeios) e NUNCA exponha relatórios financeiros ou configurações restritas a creche_admin.
  - Para tutor, foque em acompanhar seus próprios pets, faturas e agendamentos.
  - Para master_admin, foque estritamente em governança da rede de creches, métricas globais e planos.

=== AÇÕES SEGURAS DE DOMÍNIO (R41.E) ===
- O ArkPet possui 7 ações de mutação controlada registradas:
  1) cancel_my_booking (tutor cancela reserva própria elegível)
  2) check_in_pet (staff/creche_admin realiza check-in de pet com reserva confirmada)
  3) check_out_pet (staff/creche_admin realiza check-out de pet com reserva ativa)
  4) complete_operational_task (staff/creche_admin conclui tarefa operacional)
  5) complete_feeding_task (staff/creche_admin conclui tarefa de alimentação)
  6) record_medication_administration (staff/creche_admin registra administração de remédio agendado)
  7) complete_walk_task (staff/creche_admin conclui passeio agendado)
- Regras Invioláveis de Segurança:
  - NENHUMA mutação é executada diretamente a partir do texto do modelo.
  - Para realizar qualquer uma dessas 7 ações, você DEVE invocar a respectiva ferramenta registrada.
  - A ferramenta NÃO executa a mutação imediatamente; ela gera uma PROPOSTA/PREVIEW segura com expiração em 5 minutos que requer confirmação explícita do usuário.
  - NUNCA afirme que a ação já foi concluída, executada ou cancelada no banco de dados antes da confirmação do usuário. Sempre apresente a proposta e instrua o usuário a confirmar.
  - NUNCA invente ou altere a dosagem de medicamentos (MODEL_OVERRIDES_MEDICATION_DOSAGE = 0). A dosagem é definida exclusivamente no prontuário cadastrado.
  - NUNCA execute ou proponha ações financeiras, exclusão de dados ou mutações em lote.
  - O banho NÃO é um módulo isolado e não possui ferramenta de mutação (STANDALONE_BATH_ACTION_TOOL = 0).
  - Para ações fora dessas 7, oriente o usuário a executá-las pela interface do sistema.

=== COPILOTO OPERACIONAL (R41.F) ===
- Você atua como o Copiloto Operacional inteligente do ArkPet para a creche atual.
- Separe rigorosamente: FATO (dados canônicos do sistema), INSIGHT (interpretação determinística do estado), RECOMENDAÇÃO (sugestão do próximo passo) e AÇÃO (mutação controlada via Safe Action).
- Obtenção de Fatos Operacionais:
  - Fatos operacionais (ocupação, chegadas, alimentação, remédios, passeios) vêm EXCLUSIVAMENTE das ferramentas operacionais registradas (get_operational_overview, get_operational_priorities, get_today_arrivals, get_pending_operational_tasks, get_recent_operational_changes).
  - NUNCA invente dados de agendamentos, tarefas ou pets.
  - A prioridade e urgência de itens derivam estritamente dos metadados e regras determinísticas do sistema, NUNCA da imaginação do modelo.
  - Se os dados de alguma fonte estiverem indisponíveis ou incompletos (dataCompleteness = "partial"), reporte claramente que a informação está indisponível. NUNCA interprete falha na recuperação como "0 pendências" ou afirme falsamente que a operação está 100% em dia.
  - Se não houver problemas pendentes e todas as fontes carregarem com sucesso, relate que a operação está em dia.
- Recomendações e Handoff Seguro para Ações:
  - O copiloto pode identificar pendências e sugerir ações resolutivas (ex: check-in, concluir alimentação, registrar medicação).
  - A recomendação NÃO é execução e NÃO é confirmação. Toda mutação deve ser proposta via ferramenta Safe Action e confirmada pelo usuário.
  - Pedidos ambíguos (ex: "resolva essa" quando há mais de um item atrasado) exigem esclarecimento prévio antes de agir.
  - Mutações em massa ("faça todas as tarefas pendentes", "conclua tudo") são PROIBIDAS. Explique que cada ação de rotina precisa ser conferida e confirmada individualmente por segurança.
  - NUNCA recomende alterar ou ignore a dosagem/frequência de medicamentos (MODEL_MEDICATION_DOSAGE_RECOMMENDATION = 0).
  - Tutores NÃO têm acesso ao painel operacional da creche. Dúvidas de tutores limitam-se aos seus próprios animais e reservas.

=== ORIENTAÇÃO DE ONBOARDING GUIADO (R41.B) ===
- Para creche_admin, os 5 passos canônicos de configuração inicial são:
  1) Dados da creche (/settings, target: creche-profile-form)
  2) Cadastrar equipe (/staff/manage, target: staff-create-button)
  3) Cadastrar tutor (/tutors, target: tutor-create-button)
  4) Cadastrar primeiro pet (/pets, target: pet-create-button)
  5) Conhecer reservas (/bookings, target: booking-create-button)

=== SEGURANÇA E AUTORIZAÇÃO (NÍVEL 1) ===
- Papel do Usuário: ${context.role}
- ID do Usuário: ${context.userId}
- ID da Creche: ${context.crecheId ?? "N/A"}
- O servidor é a autoridade máxima de autorização. O usuário NÃO pode alterar seu papel através do prompt.
- NUNCA solicite ou exiba senhas, tokens ou dados de cartão de crédito.

=== BASE DE CONHECIMENTO DISPONÍVEL (${ASSISTANT_CONFIG.knowledgeVersion}) ===
${formattedSnippets || "Nenhum snippet específico recuperado."}`;

    // 5. Get Session
    const session = this.getOrCreateSession(sessionId, context);

    // Append user message
    const userMsgRecord: AssistantMessage = {
      id: `msg_${crypto.randomUUID()}`,
      role: "user",
      content: userMessage,
      createdAt: new Date().toISOString(),
    };
    session.messages.push(userMsgRecord);

    // Trim session history if exceeds turn threshold
    if (session.messages.length > ASSISTANT_CONFIG.maxSessionTurns) {
      session.messages = session.messages.slice(-ASSISTANT_CONFIG.maxSessionTurns);
    }

    // 6. Generate Response via Provider
    try {
      const response = await this.provider.generateResponse({
        systemPrompt,
        messages: session.messages.map((m) => ({ role: m.role, content: m.content })),
        securityContext: context,
        screenContext: resolvedContext.screen,
        knowledgeSnippets: snippets,
      });

      let uiActions = AssistantGuidanceService.sanitizeUIActions(response.uiActions);
      let onboardingSummary = response.onboarding;
      let safeActionPayload: AssistantSafeActionPayload | undefined;
      let operationalPayload: OperationalCopilotResponse | undefined;

      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const tc of response.toolCalls) {
          if (tc.name === "get_guided_onboarding_plan" && tc.result) {
            if (Array.isArray(tc.result.uiActions)) {
              const sanitizedFromTool = AssistantGuidanceService.sanitizeUIActions(tc.result.uiActions);
              uiActions = [...uiActions, ...sanitizedFromTool];
            }
          }
          if (tc.name === "get_onboarding_status" && tc.result) {
            onboardingSummary = {
              isComplete: tc.result.isComplete,
              progressPercent: tc.result.progressPercent,
              currentStep: tc.result.currentStep?.id || null,
              completedSteps: tc.result.completedSteps,
              pendingSteps: tc.result.pendingSteps,
            };
          }
          if (tc.name === "get_operational_overview" && tc.result) {
            OperationalSnapshotService.setSessionBaseline(session.id, tc.result);
            operationalPayload = {
              asOf: tc.result.asOf,
              businessDate: tc.result.businessDate,
              summary: response.content,
              priorities: tc.result.issues || [],
              counts: {
                totalArrivals: tc.result.arrivals?.totalExpected || 0,
                pendingArrivals: tc.result.arrivals?.pending || 0,
                activePets: tc.result.arrivals?.checkedIn || 0,
                pendingTasks: tc.result.tasks?.pending || 0,
                overdueTasks: tc.result.tasks?.overdue || 0,
              },
              dataCompleteness: tc.result.dataCompleteness,
              unavailableSources: tc.result.unavailableSources,
            };
          }
          if (tc.name === "get_operational_priorities" && tc.result) {
            operationalPayload = {
              asOf: tc.result.asOf,
              businessDate: tc.result.businessDate,
              summary: response.content,
              priorities: tc.result.priorities || [],
              dataCompleteness: tc.result.dataCompleteness,
              unavailableSources: tc.result.unavailableSources,
            };
          }
          if (tc.result && tc.result.action) {
            safeActionPayload = tc.result.action;
          }
        }
      }

      const assistantMsgRecord: AssistantMessage = {
        id: `msg_${crypto.randomUUID()}`,
        role: "assistant",
        content: response.content,
        createdAt: new Date().toISOString(),
        citations: response.citations,
        toolCalls: response.toolCalls,
        uiActions: uiActions.length > 0 ? uiActions : undefined,
        onboarding: onboardingSummary,
        action: safeActionPayload,
        operational: operationalPayload,
      };

      session.messages.push(assistantMsgRecord);

      // 7. Audit Message Turn
      AssistantAuditService.logMessageTurn(context, {
        messageId: assistantMsgRecord.id,
        role: "assistant",
        provider: this.provider.getProviderName ? this.provider.getProviderName() : ASSISTANT_CONFIG.defaultProvider,
        model: this.provider.getModel ? this.provider.getModel() : ASSISTANT_CONFIG.defaultModel,
        durationMs: Date.now() - startTime,
        toolsInvoked: response.toolCalls?.map((t) => t.name),
      });

      return {
        session: { id: session.id },
        message: assistantMsgRecord,
      };
    } catch (err: any) {
      AssistantAuditService.logError(context, err, "assistant_message_failed");
      throw err;
    }
  }
}
