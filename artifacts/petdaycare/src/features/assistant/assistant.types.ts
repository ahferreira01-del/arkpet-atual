export type AssistantRole = "master_admin" | "creche_admin" | "staff" | "tutor";

export type AssistantVisualState =
  | "idle"
  | "thinking"
  | "executing_action"
  | "waiting_confirmation"
  | "error"
  | "offline";

export interface AssistantCitation {
  title: string;
  category: string;
  path: string;
}

export type AssistantUIAction =
  | {
      type: "navigate";
      route: string;
    }
  | {
      type: "highlight";
      targetId: string;
    }
  | {
      type: "scroll_to";
      targetId: string;
    };

export interface AssistantSafeActionUI {
  type: string;
  state: "confirmation_required" | "confirmed" | "executing" | "executed" | "cancelled" | "expired" | "failed";
  pendingActionId?: string;
  targetType?: string;
  targetId?: number;
  preview?: Record<string, any>;
  summary?: string;
  expiresAt?: string;
  executedAt?: string;
  result?: any;
  error?: string;
}

export interface AssistantUIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  citations?: AssistantCitation[];
  uiActions?: AssistantUIAction[];
  action?: AssistantSafeActionUI;
  onboarding?: {
    isComplete: boolean;
    progressPercent: number;
    currentStep?: string | null;
    completedSteps?: string[];
    pendingSteps?: string[];
  };
  isPending?: boolean;
  error?: string;
}

export interface ScreenEntityInfo {
  type: "pet" | "booking" | "tutor" | "invoice";
  id: number | string;
}

export interface ScreenContextInfo {
  route: string;
  feature: string;
  title: string;
  entity?: ScreenEntityInfo;
}
