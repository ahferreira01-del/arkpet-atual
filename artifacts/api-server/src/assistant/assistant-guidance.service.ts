import { ASSISTANT_CONFIG } from "./assistant.config.js";
import type {
  CanonicalOnboardingStepId,
  GuidedOnboardingStep,
  GuidedOnboardingStatus,
  AssistantUIAction,
  AssistantRole,
} from "./assistant.types.js";

export interface CanonicalStepMetadata {
  id: CanonicalOnboardingStepId;
  title: string;
  description: string;
  route: string;
  target: string;
  actionLabel: string;
}

export const CANONICAL_ONBOARDING_METADATA: readonly CanonicalStepMetadata[] = [
  {
    id: "creche_details",
    title: "Completar dados da creche",
    description: "Informe telefone e endereço da creche",
    route: "/settings",
    target: "creche-profile-form",
    actionLabel: "Configurar",
  },
  {
    id: "staff",
    title: "Cadastrar equipe",
    description: "Convide ou adicione membros da equipe",
    route: "/staff/manage",
    target: "staff-create-button",
    actionLabel: "Equipe",
  },
  {
    id: "tutors",
    title: "Cadastrar tutor",
    description: "Cadastre seu primeiro tutor",
    route: "/tutors",
    target: "tutor-create-button",
    actionLabel: "Tutores",
  },
  {
    id: "pets",
    title: "Cadastrar primeiro pet",
    description: "Cadastre um pet vinculado a um tutor",
    route: "/pets",
    target: "pet-create-button",
    actionLabel: "Pets",
  },
  {
    id: "bookings",
    title: "Conhecer reservas",
    description: "Crie sua primeira reserva ou veja a agenda",
    route: "/bookings",
    target: "booking-create-button",
    actionLabel: "Reservas",
  },
] as const;

export class AssistantGuidanceService {
  /**
   * Validates if a route is safe and present in the internal guidance allowlist.
   * Strictly rejects external URLs, javascript:, and unknown paths.
   */
  public static isValidRoute(route: string): boolean {
    if (!route || typeof route !== "string") return false;
    const trimmed = route.trim();

    // Reject dangerous URI protocols
    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("javascript:") ||
      trimmed.startsWith("data:")
    ) {
      return false;
    }

    // Match against strictly allowed internal routes (ignoring query strings / hash for path validation)
    const pathname = trimmed.split("?")[0].split("#")[0];
    return (ASSISTANT_CONFIG.allowedGuidanceRoutes as readonly string[]).includes(pathname);
  }

  /**
   * Validates if a UI target identifier is present in the registered allowlist.
   * Strictly rejects arbitrary CSS selectors, HTML tags, or unlisted targets.
   */
  public static isValidTarget(targetId: string): boolean {
    if (!targetId || typeof targetId !== "string") return false;
    const trimmed = targetId.trim();

    // Reject arbitrary CSS selector patterns
    if (
      trimmed.includes(" ") ||
      trimmed.includes(">") ||
      trimmed.includes("+") ||
      trimmed.includes("~") ||
      trimmed.includes(".") ||
      trimmed.includes("#") ||
      trimmed.includes("[") ||
      trimmed.includes(":")
    ) {
      return false;
    }

    return (ASSISTANT_CONFIG.allowedGuidanceTargets as readonly string[]).includes(trimmed);
  }

  /**
   * Sanitizes and validates a candidate AssistantUIAction.
   * Returns a clean typed action or null if rejected.
   */
  public static sanitizeUIAction(action: any): AssistantUIAction | null {
    if (!action || typeof action !== "object") return null;

    if (action.type === "navigate") {
      if (this.isValidRoute(action.route)) {
        return {
          type: "navigate",
          route: action.route.trim().split("?")[0].split("#")[0],
        };
      }
      return null;
    }

    if (action.type === "highlight") {
      if (this.isValidTarget(action.targetId)) {
        return {
          type: "highlight",
          targetId: action.targetId.trim(),
        };
      }
      return null;
    }

    if (action.type === "scroll_to") {
      if (this.isValidTarget(action.targetId)) {
        return {
          type: "scroll_to",
          targetId: action.targetId.trim(),
        };
      }
      return null;
    }

    return null;
  }

  /**
   * Sanitizes an array of candidate UIActions, rejecting any invalid entries.
   */
  public static sanitizeUIActions(actions?: any[]): AssistantUIAction[] {
    if (!Array.isArray(actions)) return [];
    const valid: AssistantUIAction[] = [];
    for (const a of actions) {
      const sanitized = this.sanitizeUIAction(a);
      if (sanitized) {
        valid.push(sanitized);
      }
    }
    return valid;
  }

  /**
   * Generates a contextual guided onboarding plan based on dynamic server status and current screen.
   */
  public static generatePlan(
    status: GuidedOnboardingStatus,
    currentScreenPath?: string,
    userRole?: AssistantRole
  ): {
    content: string;
    uiActions: AssistantUIAction[];
    currentStep: GuidedOnboardingStep | null;
    isCurrentScreen: boolean;
  } {
    // Role boundary guard
    if (userRole !== "creche_admin" && userRole !== "master_admin") {
      return {
        content: "O onboarding da creche é gerenciado exclusivamente pelos administradores da creche.",
        uiActions: [],
        currentStep: null,
        isCurrentScreen: false,
      };
    }

    // 100% complete state
    if (status.isComplete || !status.currentStep) {
      return {
        content: "Configuração inicial concluída. Sua creche já possui os dados básicos, equipe, tutores, pets e estrutura para reservas.",
        uiActions: [],
        currentStep: null,
        isCurrentScreen: false,
      };
    }

    const currentStep = status.currentStep;
    const normalizedScreen = (currentScreenPath || "").trim().split("?")[0].split("#")[0];
    const isCurrentScreen = normalizedScreen === currentStep.route;

    if (isCurrentScreen) {
      return {
        content: `Você já está na tela correta (${currentStep.title}). Clique no botão de cadastro para continuar e concluir esta etapa.`,
        uiActions: [{ type: "highlight", targetId: currentStep.target }],
        currentStep,
        isCurrentScreen: true,
      };
    }

    return {
      content: `Sua configuração está em ${status.progressPercent}% concluída. O próximo passo é **${currentStep.title}** (${currentStep.description}). Posso te levar até lá.`,
      uiActions: [
        { type: "navigate", route: currentStep.route },
        { type: "highlight", targetId: currentStep.target },
      ],
      currentStep,
      isCurrentScreen: false,
    };
  }
}
