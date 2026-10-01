import { logger, type LogContext } from "../lib/logger.js";
import { ASSISTANT_CONFIG } from "./assistant.config.js";
import type { AssistantSecurityContext } from "./assistant.types.js";

export class AssistantAuditService {
  public static logMessageTurn(
    context: AssistantSecurityContext,
    details: {
      messageId: string;
      role: "user" | "assistant";
      provider?: string;
      model?: string;
      toolsInvoked?: string[];
      durationMs?: number;
    }
  ): void {
    const logData: LogContext = {
      requestId: context.requestId,
      userId: context.userId,
      crecheId: context.crecheId ?? undefined,
      role: context.role,
      entityType: "assistant_message",
      entityId: details.messageId,
      provider: details.provider || ASSISTANT_CONFIG.defaultProvider,
      promptVersion: ASSISTANT_CONFIG.promptVersion,
      knowledgeVersion: ASSISTANT_CONFIG.knowledgeVersion,
      model: details.model || ASSISTANT_CONFIG.defaultModel,
      toolsCount: details.toolsInvoked?.length || 0,
      durationMs: details.durationMs,
    };

    logger.info("assistant_message_turn", logData);
  }

  public static logToolExecution(
    context: AssistantSecurityContext,
    details: {
      toolName: string;
      status: "SUCCESS" | "FAILURE";
      durationMs: number;
      error?: string;
    }
  ): void {
    const logData: LogContext = {
      requestId: context.requestId,
      userId: context.userId,
      crecheId: context.crecheId ?? undefined,
      role: context.role,
      entityType: "assistant_tool",
      entityId: details.toolName,
      status: details.status,
      durationMs: details.durationMs,
      errorCode: details.error ? "TOOL_EXECUTION_ERROR" : undefined,
      reason: details.error,
    };

    if (details.status === "SUCCESS") {
      logger.info("assistant_tool_executed", logData);
    } else {
      logger.warn("assistant_tool_failed", logData);
    }
  }

  public static logSecurityDenial(
    context: AssistantSecurityContext,
    details: {
      action: string;
      reason: string;
      targetId?: string | number;
    }
  ): void {
    const logData: LogContext = {
      requestId: context.requestId,
      userId: context.userId,
      crecheId: context.crecheId ?? undefined,
      role: context.role,
      entityType: "assistant_security",
      entityId: details.action,
      reason: details.reason,
    };

    logger.warn("assistant_security_denial", logData);
  }

  public static logOnboardingEvent(
    context: AssistantSecurityContext,
    event:
      | "assistant_onboarding_started"
      | "assistant_onboarding_step_viewed"
      | "assistant_onboarding_navigation"
      | "assistant_onboarding_step_completed"
      | "assistant_onboarding_dismissed"
      | "assistant_onboarding_completed",
    details?: {
      stepId?: string;
      route?: string;
      progressPercent?: number;
      reason?: string;
    }
  ): void {
    const logData: LogContext = {
      requestId: context.requestId,
      userId: context.userId,
      crecheId: context.crecheId ?? undefined,
      role: context.role,
      entityType: "assistant_onboarding",
      entityId: details?.stepId,
      stepId: details?.stepId,
      route: details?.route,
      progressPercent: details?.progressPercent,
      reason: details?.reason,
    };

    logger.info(event, logData);
  }

  public static logError(
    context: AssistantSecurityContext | undefined,
    error: unknown,
    event: string = "assistant_error"
  ): void {
    logger.error(event, error, {
      requestId: context?.requestId,
      userId: context?.userId,
      crecheId: context?.crecheId ?? undefined,
      role: context?.role,
    });
  }
}
