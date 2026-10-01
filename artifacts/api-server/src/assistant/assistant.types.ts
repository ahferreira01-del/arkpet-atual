import { z } from "zod";

export type AssistantRole = "master_admin" | "creche_admin" | "staff" | "tutor";

export interface AssistantSecurityContext {
  userId: number;
  role: AssistantRole;
  crecheId: number | null;
  name: string;
  email: string;
  requestId?: string;
}

export interface ScreenContext {
  route: string;
  feature?: string;
  mode?: string;
}

export interface AssistantCitation {
  title: string;
  category: string;
  path: string;
}

export type CanonicalOnboardingStepId =
  | "creche_details"
  | "staff"
  | "tutors"
  | "pets"
  | "bookings";

export interface GuidedOnboardingStep {
  id: CanonicalOnboardingStepId;
  title: string;
  description: string;
  route: string;
  actionLabel?: string;
  target: string;
  completed: boolean;
}

export interface GuidedOnboardingStatus {
  crecheId: number;
  isComplete: boolean;
  completedCount: number;
  totalSteps: number;
  progressPercent: number;
  completedSteps: CanonicalOnboardingStepId[];
  pendingSteps: CanonicalOnboardingStepId[];
  currentStep: GuidedOnboardingStep | null;
  steps: GuidedOnboardingStep[];
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

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  citations?: AssistantCitation[];
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, any>;
    result?: any;
  }>;
  uiActions?: AssistantUIAction[];
  onboarding?: {
    isComplete: boolean;
    progressPercent: number;
    currentStep?: CanonicalOnboardingStepId | null;
    completedSteps?: CanonicalOnboardingStepId[];
    pendingSteps?: CanonicalOnboardingStepId[];
  };
}

export interface AssistantSession {
  id: string;
  userId: number;
  crecheId: number | null;
  role: AssistantRole;
  messages: AssistantMessage[];
  createdAt: string;
  lastActivityAt: string;
}

export interface AssistantToolDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  allowedRoles: AssistantRole[];
  inputSchema: z.ZodType<TInput>;
  confirmationRequired: boolean;
  auditEvent: string;
  execute: (input: TInput, context: AssistantSecurityContext) => Promise<TOutput>;
}

export interface KnowledgeSnippet {
  title: string;
  category: string;
  snippet: string;
  path: string;
  relevanceScore: number;
}
