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

export interface AssistantUIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  citations?: AssistantCitation[];
  uiActions?: AssistantUIAction[];
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
