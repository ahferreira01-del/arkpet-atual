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
