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

export interface OperationalCopilotUI {
  asOf: string;
  businessDate: string;
  dataCompleteness?: "complete" | "partial";
  unavailableSources?: string[];
  occupancy?: {
    current: number | null;
    capacity: number | null;
  } | null;
  arrivals?: {
    totalExpected: number | null;
    checkedIn?: number | null;
    pending: number | null;
    completed?: number | null;
    cancelled?: number | null;
    onTheWay?: number | null;
  } | null;
  tasks?: {
    total?: number | null;
    pending: number | null;
    completed?: number | null;
    overdue: number | null;
    unassigned?: number | null;
  } | null;
  priorities?: Array<{
    id: string;
    priority: "critical" | "high" | "medium" | "low";
    title: string;
    reason: string;
    suggestedAction?: {
      tool: string;
      label: string;
      targetId?: number;
    };
  }>;
}

export interface AssistantUIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  citations?: AssistantCitation[];
  uiActions?: AssistantUIAction[];
  action?: AssistantSafeActionUI;
  operational?: OperationalCopilotUI;
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
