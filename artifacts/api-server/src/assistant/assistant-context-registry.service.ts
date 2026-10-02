import type { AssistantRole, ProductScreenDefinition } from "./assistant.types.js";

/**
 * AssistantProductContextRegistry
 * 
 * Deterministic, source-verified registry mapping ArkPet application routes
 * to structured screen metadata, allowed actions, guidance targets, and knowledge categories.
 * 
 * Invariants:
 * - REGISTERED_CONTEXT_ROUTE_BROKEN_COUNT = 0
 * - CONTEXT_REGISTRY_AUTHORITY = PRESENTATION_ONLY
 * - SERVER_RBAC_REMAINS_AUTHORITATIVE = YES
 */
export class AssistantProductContextRegistry {
  private static readonly screens: readonly ProductScreenDefinition[] = [
    {
      routeId: "dashboard",
      matcher: /^\/(dashboard)?$/,
      feature: "dashboard",
      title: "Painel Principal",
      description: "Visão consolidada da creche com métricas diárias, ocupação, aniversariantes e atalhos rápidos.",
      allowedRoles: ["creche_admin", "staff", "tutor", "master_admin"],
      knowledgeCategories: ["dashboard", "roles"],
      availableActionIds: ["dashboard.view_kpis", "dashboard.quick_nav", "dashboard.announcements"],
      guidanceTargets: [],
    },
    {
      routeId: "pets.list",
      matcher: /^\/pets$/,
      feature: "pets_directory",
      title: "Pets",
      description: "Diretório de cães cadastrados, filtros por raça, tutor e status, além do cadastro de novos pets.",
      allowedRoles: ["creche_admin", "staff", "tutor"],
      knowledgeCategories: ["pets"],
      availableActionIds: ["pet.create", "pet.search", "pet.filter"],
      guidanceTargets: ["pet-create-button", "pet-search-input"],
    },
    {
      routeId: "pets.detail",
      matcher: /^\/pets\/(\d+)$/,
      feature: "pet_detail",
      title: "Ficha do Pet",
      description: "Prontuário completo do pet: dados cadastrais, restrições alimentares, medicações, vacinas e rotinas.",
      allowedRoles: ["creche_admin", "staff", "tutor"],
      knowledgeCategories: ["pets", "operations"],
      availableActionIds: ["pet.edit", "pet.view_care_notes", "pet.view_vaccines", "pet.view_routines"],
      guidanceTargets: ["pet-edit-button", "pet-detail-plan-tab", "pet-detail-care-tab"],
      entityType: "pet",
    },
    {
      routeId: "bookings.list",
      matcher: /^\/bookings$/,
      feature: "bookings_calendar",
      title: "Reservas",
      description: "Agenda e grade de reservas da creche, controle de Day Use e Hospedagem por data e status.",
      allowedRoles: ["creche_admin", "staff", "tutor"],
      knowledgeCategories: ["reservations"],
      availableActionIds: ["booking.create", "booking.filter_status", "booking.filter_date"],
      guidanceTargets: ["booking-create-button", "booking-filter-status"],
    },
    {
      routeId: "bookings.new",
      matcher: /^\/bookings\/new$/,
      feature: "booking_create",
      title: "Nova Reserva",
      description: "Formulário passo a passo para agendamento de estadias em Day Use ou Hotel.",
      allowedRoles: ["creche_admin", "tutor"],
      knowledgeCategories: ["reservations"],
      availableActionIds: ["booking.submit", "booking.select_pet", "booking.select_dates"],
      guidanceTargets: ["booking-submit-button"],
    },
    {
      routeId: "staff.board",
      matcher: /^\/(staff\/board|staff|walks)$/,
      feature: "operational_board",
      title: "Painel Operacional",
      description: "Fluxo de rotina operacional diária: check-in, check-out, alimentação, medicação e passeios.",
      allowedRoles: ["creche_admin", "staff"],
      knowledgeCategories: ["operations"],
      availableActionIds: ["task.checkin", "task.checkout", "task.feeding", "task.medication", "task.walk"],
      guidanceTargets: ["staff-board-checkin-tab", "staff-board-feeding-tab", "staff-board-meds-tab", "staff-board-walks-tab"],
    },
    {
      routeId: "staff.manage",
      matcher: /^\/staff\/manage$/,
      feature: "staff_management",
      title: "Gerenciamento de Equipe",
      description: "Gestão dos colaboradores da creche, convites e controle de permissões operacionais.",
      allowedRoles: ["creche_admin"],
      knowledgeCategories: ["roles", "onboarding"],
      availableActionIds: ["staff.invite", "staff.edit_role"],
      guidanceTargets: ["staff-create-button"],
    },
    {
      routeId: "staff.qr_scanner",
      matcher: /^\/staff\/qr-scanner$/,
      feature: "qr_scanner",
      title: "Leitor de QR Code",
      description: "Identificação rápida de pets via câmera ou token para check-in e check-out automáticos.",
      allowedRoles: ["creche_admin", "staff"],
      knowledgeCategories: ["operations"],
      availableActionIds: ["qr.scan", "qr.manual_code"],
      guidanceTargets: ["qr-scanner-camera-view"],
    },
    {
      routeId: "tutors.list",
      matcher: /^\/tutors$/,
      feature: "tutors_directory",
      title: "Tutores",
      description: "Cadastro e listagem de tutores de animais, informações de contato, faturamento e pets vinculados.",
      allowedRoles: ["creche_admin"],
      knowledgeCategories: ["onboarding", "roles"],
      availableActionIds: ["tutor.create", "tutor.search"],
      guidanceTargets: ["tutor-create-button"],
    },
    {
      routeId: "chat",
      matcher: /^\/chat$/,
      feature: "chat_messaging",
      title: "Mensagens & Chat",
      description: "Canal direto de comunicação entre creche e tutores, envio de atualizações e fotos.",
      allowedRoles: ["creche_admin", "staff", "tutor"],
      knowledgeCategories: ["chat"],
      availableActionIds: ["chat.send_message", "chat.send_media", "chat.select_channel"],
      guidanceTargets: ["chat-input-textarea", "chat-send-button"],
    },
    {
      routeId: "settings",
      matcher: /^\/settings$/,
      feature: "creche_settings",
      title: "Configurações da Creche",
      description: "Configurações cadastrais da creche: dados gerais, telefone, endereço, capacidade e parâmetros.",
      allowedRoles: ["creche_admin"],
      knowledgeCategories: ["settings", "onboarding"],
      availableActionIds: ["settings.save_profile", "settings.save_capacity", "settings.manage_services"],
      guidanceTargets: ["creche-profile-form", "settings-save-button"],
    },
    {
      routeId: "financial",
      matcher: /^\/financial$/,
      feature: "financial_management",
      title: "Módulo Financeiro",
      description: "Fluxo de caixa, relatórios de receitas, faturamento, pedidos e conciliação bancária da creche.",
      allowedRoles: ["creche_admin"],
      knowledgeCategories: ["financial"],
      availableActionIds: ["financial.view_reports", "financial.filter_period", "financial.export"],
      guidanceTargets: ["financial-reports-tab"],
    },
    {
      routeId: "tutor.financial",
      matcher: /^\/tutor\/financial$/,
      feature: "tutor_financial",
      title: "Minhas Faturas",
      description: "Área do tutor para acompanhamento de faturas, pagamentos, boletos, PIX e recibos.",
      allowedRoles: ["tutor"],
      knowledgeCategories: ["financial"],
      availableActionIds: ["tutor.view_invoices", "tutor.download_receipt"],
      guidanceTargets: ["tutor-invoices-list"],
    },
    {
      routeId: "tutor.store",
      matcher: /^\/tutor\/store$/,
      feature: "tutor_store",
      title: "Loja & Serviços",
      description: "Catálogo de produtos e serviços adicionais da creche disponíveis para contratação pelo tutor.",
      allowedRoles: ["tutor"],
      knowledgeCategories: ["reservations", "financial"],
      availableActionIds: ["store.view_items", "store.add_to_cart"],
      guidanceTargets: ["store-catalog-grid"],
    },
    {
      routeId: "billing",
      matcher: /^\/assinatura(\/sucesso)?$/,
      feature: "billing_subscription",
      title: "Assinatura ArkPet",
      description: "Gerenciamento da assinatura ArkPet SaaS pela creche, planos contratados e dados de cobrança.",
      allowedRoles: ["creche_admin"],
      knowledgeCategories: ["financial"],
      availableActionIds: ["billing.select_plan", "billing.checkout"],
      guidanceTargets: ["billing-plans-card"],
    },
    {
      routeId: "marketing.campaigns",
      matcher: /^\/marketing\/campaigns$/,
      feature: "creche_campaigns",
      title: "Campanhas Promocionais",
      description: "Criação e gestão de campanhas promocionais, cupons e oportunidades comerciais da creche.",
      allowedRoles: ["creche_admin", "staff"],
      knowledgeCategories: ["financial", "settings"],
      availableActionIds: ["campaign.create", "campaign.view_metrics"],
      guidanceTargets: ["campaign-create-button"],
    },
    {
      routeId: "admin.creches",
      matcher: /^\/admin(\/creches)?$/,
      feature: "master_admin_creches",
      title: "Administração de Creches",
      description: "Painel master admin para visualização e gestão de todas as creches da rede ArkPet.",
      allowedRoles: ["master_admin"],
      knowledgeCategories: ["roles", "settings"],
      availableActionIds: ["admin.search_creches", "admin.view_creche_details"],
      guidanceTargets: ["admin-creches-table"],
    },
    {
      routeId: "admin.campaigns",
      matcher: /^\/admin\/campaigns$/,
      feature: "master_admin_campaigns",
      title: "Campanhas Globais",
      description: "Gestão das campanhas em nível de plataforma e métricas comerciais globais.",
      allowedRoles: ["master_admin"],
      knowledgeCategories: ["roles"],
      availableActionIds: ["admin.view_campaigns"],
      guidanceTargets: [],
    },
    {
      routeId: "admin.proposals",
      matcher: /^\/admin\/proposals$/,
      feature: "master_admin_proposals",
      title: "Propostas Comerciais",
      description: "Propostas comerciais e contratos para novas creches na plataforma ArkPet.",
      allowedRoles: ["master_admin"],
      knowledgeCategories: ["roles"],
      availableActionIds: ["admin.manage_proposals"],
      guidanceTargets: [],
    },
    {
      routeId: "admin.users",
      matcher: /^\/admin\/users$/,
      feature: "master_admin_users",
      title: "Usuários da Plataforma",
      description: "Gestão de identidades e permissões de usuários em nível global da plataforma.",
      allowedRoles: ["master_admin"],
      knowledgeCategories: ["roles"],
      availableActionIds: ["admin.search_users", "admin.view_user_roles"],
      guidanceTargets: [],
    },
  ];

  public static listDefinitions(): readonly ProductScreenDefinition[] {
    return this.screens;
  }

  public static getDefinition(routeId: string): ProductScreenDefinition | undefined {
    return this.screens.find((s) => s.routeId === routeId);
  }

  public static resolveScreen(route: string): {
    definition: ProductScreenDefinition;
    params: Record<string, string>;
  } | null {
    if (!route || typeof route !== "string") {
      return null;
    }

    // Clean query strings and fragments
    const cleanPath = route.trim().split("?")[0].split("#")[0];

    for (const screen of this.screens) {
      if (screen.matcher instanceof RegExp) {
        const match = cleanPath.match(screen.matcher);
        if (match) {
          const params: Record<string, string> = {};
          if (match[1] && screen.entityType) {
            params.id = match[1];
          }
          return { definition: screen, params };
        }
      } else if (screen.matcher === cleanPath) {
        return { definition: screen, params: {} };
      }
    }

    return null;
  }

  public static getFallbackScreen(route: string): ProductScreenDefinition {
    const cleanPath = (route || "/").trim().split("?")[0].split("#")[0];
    return {
      routeId: "unknown",
      matcher: cleanPath,
      feature: "general_view",
      title: "ArkPet",
      description: "Plataforma de gestão integrada de creches e hospedagens caninas.",
      allowedRoles: ["creche_admin", "staff", "tutor", "master_admin"],
      knowledgeCategories: ["roles", "settings"],
      availableActionIds: ["view_help", "search_documentation"],
      guidanceTargets: [],
    };
  }

  public static getGuidanceSummaryForRole(
    definition: ProductScreenDefinition,
    role: AssistantRole
  ): string {
    switch (definition.routeId) {
      case "dashboard":
        if (role === "creche_admin") {
          return "Nesta tela você acompanha os principais indicadores da creche: taxa de ocupação, check-ins e check-outs previstos para hoje, novas reservas pendentes de aprovação e aniversariantes do mês.";
        }
        if (role === "staff") {
          return "Nesta tela você visualiza a lista de cães presentes na creche hoje e atalhos rápidos para o painel operacional de alimentação, medicação e passeios da rotina diária.";
        }
        if (role === "tutor") {
          return "Aqui você acompanha o status dos seus pets, avisos importantes da creche e atalhos para solicitar novas reservas ou abrir o chat.";
        }
        if (role === "master_admin") {
          return "Visão geral da plataforma ArkPet com métricas consolidadas da rede e atalhos de administração global.";
        }
        break;

      case "pets.list":
        if (role === "creche_admin") {
          return "Nesta tela você pode cadastrar novos pets vinculados aos tutores, buscar pets por nome ou raça e gerenciar suas fichas completas.";
        }
        if (role === "staff") {
          return "Nesta tela você consulta a ficha cadastral dos pets, raça, porte, restrições alimentares e observações de comportamento.";
        }
        if (role === "tutor") {
          return "Aqui você visualiza seus pets cadastrados na creche, seus dados e prontuários.";
        }
        break;

      case "pets.detail":
        return "Na ficha do pet você confere detalhes cadastrais, histórico médico, carteira de vacinas, restrições alimentares, rotinas de cuidado e histórico de estadias.";

      case "bookings.list":
        if (role === "creche_admin") {
          return "Nesta tela você gerencia a grade de reservas em Day Use e Hospedagem, aprova reservas pendentes, filtra por data e status, ou cria novas reservas.";
        }
        if (role === "staff") {
          return "Nesta tela você consulta a agenda de reservas para saber quais cães estão previstos para chegar ou sair na data de hoje.";
        }
        if (role === "tutor") {
          return "Aqui você acompanha suas reservas agendadas, em andamento ou histórico, com seus respectivos status.";
        }
        break;

      case "bookings.new":
        return "Nesta tela você seleciona o pet, o tipo de estadia (Day Use ou Hotel/Hospedagem), as datas e horários, e serviços adicionais.";

      case "staff.board":
        if (role === "creche_admin" || role === "staff") {
          return "Nesta tela operacional você realiza check-in e check-out de pets, registra alimentação, administração de medicamentos e histórico de passeios.";
        }
        break;

      case "staff.manage":
        return "Nesta tela você convida novos membros para a equipe da creche e gerencia as funções operacionais.";

      case "staff.qr_scanner":
        return "Nesta tela você pode escanear o QR Code da coleira ou aplicativo do tutor para realizar check-in ou check-out imediato do pet.";

      case "tutors.list":
        return "Nesta tela você gerencia o cadastro dos tutores de animais, telefones, endereços e visualiza os pets sob a responsabilidade de cada tutor.";

      case "chat":
        return "No chat você pode trocar mensagens em tempo real com a creche ou tutores, tirar dúvidas e compartilhar fotos do dia do cãozinho.";

      case "settings":
        return "Nesta tela você configura as informações cadastrais da creche, telefone, endereço, horário de funcionamento e capacidade máxima de cães.";

      case "financial":
        return "Nesta tela você gerencia o fluxo financeiro da creche, faturamento por período, status de cobranças e relatórios consolidados.";

      case "tutor.financial":
        return "Aqui você visualiza suas faturas em aberto e histórico de pagamentos, com opção de baixar recibos e comprovantes.";

      case "tutor.store":
        return "Aqui você encontra serviços adicionais e produtos oferecidos pela creche para contratação rápida.";

      case "billing":
        return "Nesta tela você gerencia a assinatura ArkPet da sua creche, opções de plano e faturamento via Stripe.";

      case "marketing.campaigns":
        return "Nesta tela você gerencia campanhas promocionais e cupons de desconto para os tutores da creche.";

      case "admin.creches":
      case "admin.campaigns":
      case "admin.proposals":
      case "admin.users":
        return "Área restrita de administração da plataforma ArkPet em nível global.";
    }

    return definition.description;
  }
}
