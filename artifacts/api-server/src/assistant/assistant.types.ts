import { z } from "zod";

export type AssistantRole = "master_admin" | "creche_admin" | "staff" | "tutor";

export interface AssistantSecurityContext {
  userId: number;
  role: AssistantRole;
  crecheId: number | null;
  name: string;
  email: string;
  requestId?: string;
  sessionId?: string;
}

export interface ScreenEntityContext {
  type: "pet" | "booking" | "tutor" | "invoice";
  id: number | string;
  name?: string;
  breed?: string;
  species?: string;
  status?: string;
  allergies?: string;
  summary?: string;
}

export interface ScreenContext {
  route: string;
  routeId?: string;
  feature?: string;
  title?: string;
  description?: string;
  mode?: string;
  allowedActions?: string[];
  availableActionIds?: string[];
  guidanceTargets?: string[];
  knowledgeCategories?: string[];
  entity?: ScreenEntityContext | null;
}

export interface ProductScreenDefinition {
  routeId: string;
  matcher: string | RegExp;
  feature: string;
  title: string;
  description: string;
  allowedRoles: AssistantRole[];
  knowledgeCategories: string[];
  availableActionIds: string[];
  guidanceTargets: string[];
  entityType?: "pet" | "booking" | "tutor" | "invoice";
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

export type AssistantToolMode = "read" | "mutation";
export type AssistantSafeActionRiskLevel = "low" | "medium" | "high";
export type AssistantSafeActionState =
  | "confirmation_required"
  | "confirmed"
  | "executing"
  | "executed"
  | "cancelled"
  | "expired"
  | "failed";

export interface AssistantSafeActionPayload {
  type: string;
  state: AssistantSafeActionState;
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
  action?: AssistantSafeActionPayload;
  onboarding?: {
    isComplete: boolean;
    progressPercent: number;
    currentStep?: CanonicalOnboardingStepId | null;
    completedSteps?: CanonicalOnboardingStepId[];
    pendingSteps?: CanonicalOnboardingStepId[];
  };
  operational?: OperationalCopilotResponse;
}

export type OperationalIssuePriority = "critical" | "high" | "medium" | "low";
export type OperationalIssueCategory =
  | "medication"
  | "feeding"
  | "walk"
  | "arrival"
  | "checkout"
  | "task"
  | "capacity"
  | "booking";

export interface OperationalIssue {
  id: string;
  category: OperationalIssueCategory;
  priority: OperationalIssuePriority;
  title: string;
  reason: string;
  reasonCode: string;
  targetType?: "booking" | "pet" | "task" | "medication";
  targetId?: number;
  petId?: number;
  petName?: string;
  scheduledFor?: string;
  delayMinutes?: number;
  detectedAt: string;
  suggestedAction?: {
    tool: string;
    targetId?: number;
    petId?: number;
    bookingId?: number;
    taskId?: number;
    label: string;
  };
}

export interface OperationalArrivalItem {
  bookingId: number;
  petId: number;
  petName: string;
  tutorId: number;
  status: string;
  serviceType: string;
  onTheWayType?: string | null;
  onTheWayEtaMinutes?: number | null;
  onTheWayAt?: string | null;
}

export interface OperationalTaskItem {
  id: number;
  type: string;
  title: string;
  status: string;
  scheduledFor: string;
  petId?: number | null;
  petName?: string | null;
  assignedToId?: number | null;
  assignedToName?: string | null;
  priority: string;
  isOverdue: boolean;
  delayMinutes?: number;
}

export interface OperationalSourceStatus {
  occupancy: "available" | "unavailable";
  bookings: "available" | "unavailable";
  tasks: "available" | "unavailable";
}

export interface OperationalSnapshot {
  asOf: string;
  businessDate: string;
  crecheId: number;
  dataCompleteness: "complete" | "partial";
  unavailableSources?: string[];
  sourceStatus: OperationalSourceStatus;
  occupancy: {
    current: number | null;
    capacity: number | null;
  } | null;
  arrivals: {
    totalExpected: number | null;
    checkedIn: number | null;
    pending: number | null;
    completed: number | null;
    cancelled: number | null;
    onTheWay: number | null;
    items: OperationalArrivalItem[];
  } | null;
  departures: {
    totalExpected: number | null;
    checkedOut: number | null;
    pending: number | null;
  } | null;
  tasks: {
    total: number | null;
    pending: number | null;
    completed: number | null;
    overdue: number | null;
    unassigned: number | null;
    byType: {
      feeding: { total: number | null; pending: number | null; completed: number | null; overdue: number | null };
      medication: { total: number | null; pending: number | null; completed: number | null; overdue: number | null };
      walk: { total: number | null; pending: number | null; completed: number | null; overdue: number | null };
      other: { total: number | null; pending: number | null; completed: number | null; overdue: number | null };
    };
    items: OperationalTaskItem[];
  } | null;
  issues: OperationalIssue[];
}

export interface OperationalCopilotResponse {
  asOf: string;
  businessDate: string;
  summary: string;
  priorities: OperationalIssue[];
  occupancy?: {
    current: number | null;
    capacity: number | null;
  } | null;
  arrivals?: {
    totalExpected: number | null;
    pending: number | null;
    checkedIn: number | null;
  } | null;
  tasks?: {
    pending: number | null;
    overdue: number | null;
  } | null;
  counts?: Record<string, number | null>;
  dataCompleteness: "complete" | "partial";
  unavailableSources?: string[];
  sourceStatus?: OperationalSourceStatus;
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
  mode?: AssistantToolMode;
  allowedRoles: AssistantRole[];
  inputSchema: z.ZodType<TInput>;
  confirmationRequired: boolean;
  riskLevel?: AssistantSafeActionRiskLevel;
  targetType?: string;
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
