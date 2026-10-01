import { AssistantKnowledgeService } from "./assistant-knowledge.service.js";
import { AssistantToolsRegistry } from "./assistant-tools.registry.js";
import { AssistantAuditService } from "./assistant-audit.service.js";
import { ASSISTANT_CONFIG } from "./assistant.config.js";
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
      lowerQuery.includes("ignore previous instructions")
    ) {
      AssistantAuditService.logSecurityDenial(context, {
        action: "prompt_injection_role_override",
        reason: "User prompt attempted to override server-enforced role",
      });
      return {
        content: `Você está autenticado no ArkPet como ${context.role}. As permissões do sistema são gerenciadas exclusivamente pelo servidor e não podem ser alteradas através da conversa. Como posso ajudar dentro das funções do seu perfil?`,
      };
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
      (lowerQuery.includes("relatorio financeiro") || lowerQuery.includes("receita total da creche"))
    ) {
      return {
        content: `Como ${context.role}, você não tem permissão para acessar os dados do relatório financeiro consolidado ou receita da creche. Esse acesso é restrito ao creche_admin.`,
      };
    }

    if (context.role === "tutor" && lowerQuery.includes("pets de outros tutores")) {
      return {
        content: "No ArkPet, tutores possuem acesso estrito e exclusivo apenas aos seus próprios pets cadastrados.",
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
      if (context.role === "creche_admin" || context.role === "master_admin") {
        if (!context.crecheId) {
          return {
            content: "Você precisa selecionar ou estar vinculado a uma creche para consultar o onboarding.",
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
    if (lowerQuery.includes("diferenca entre hospedagem e day use") || lowerQuery.includes("hospedagem e day use")) {
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

    // 8. Pet Registration & Care Details
    if (
      lowerQuery.includes("cadastrar um pet") ||
      lowerQuery.includes("cadastrar pet") ||
      lowerQuery.includes("primeiro pet") ||
      lowerQuery.includes("meu primeiro pet")
    ) {
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

    if (lowerQuery.includes("master_admin pode fazer") || lowerQuery.includes("creches cadastradas na rede") || lowerQuery.includes("planos de assinatura da plataforma")) {
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

