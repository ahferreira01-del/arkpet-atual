import { Router, type Response } from "express";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { AssistantSafeActionService } from "./assistant-safe-action.service.js";
import type { AssistantSecurityContext } from "./assistant.types.js";

export const assistantActionsRouter = Router();

// Enforce authentication on all action routes (UNAUTHENTICATED_SAFE_ACTION_ACCESS = 0)
assistantActionsRouter.use(authenticate);

function buildSecurityContext(req: AuthRequest): AssistantSecurityContext {
  const user = req.user!;
  return {
    userId: user.id,
    role: user.role as any,
    crecheId: user.crecheId ?? null,
    name: user.name || "Usuário",
    email: user.email || "",
    requestId: (req as any).id,
  };
}

function sendSafeError(
  res: Response,
  err: any,
  defaultCode: string,
  fallbackMessage: string,
  requestId?: string
): void {
  const status =
    typeof err?.statusCode === "number"
      ? err.statusCode
      : typeof err?.status === "number"
      ? err.status
      : 500;

  if (status >= 500) {
    res.status(status).json({
      error: "Ocorreu um erro interno ao processar a ação.",
      code: "internal_error",
      requestId: requestId || undefined,
    });
    return;
  }

  // Client-side / domain error (4xx)
  let safeMessage = err?.message || fallbackMessage;
  if (/postgres:\/\/|bearer\s+|password\s*=|select\s+.+from/i.test(safeMessage)) {
    safeMessage = fallbackMessage;
  }

  res.status(status).json({
    error: safeMessage,
    code: err?.code || defaultCode,
    requestId: requestId || undefined,
  });
}

/**
 * POST /api/assistant/actions/preview
 * Creates a server-bound, expiring pending mutation proposal.
 * Zero domain writes.
 */
assistantActionsRouter.post("/preview", async (req: AuthRequest, res: Response): Promise<void> => {
  let context: AssistantSecurityContext | undefined;
  try {
    context = buildSecurityContext(req);
    const { actionType, payload } = req.body || {};

    if (!actionType || typeof actionType !== "string") {
      res.status(400).json({ error: "actionType é obrigatório", code: "missing_action_type" });
      return;
    }

    const result = await AssistantSafeActionService.createPendingAction(
      actionType,
      payload || {},
      context
    );

    res.status(200).json(result);
  } catch (err: any) {
    sendSafeError(res, err, "preview_failed", "Erro ao gerar proposta de ação", context?.requestId);
  }
});

/**
 * POST /api/assistant/actions/:pendingActionId/confirm
 * Explicit confirmation execution.
 * Deterministic domain service execution. Zero LLM calls. Idempotent.
 */
assistantActionsRouter.post("/:pendingActionId/confirm", async (req: AuthRequest, res: Response): Promise<void> => {
  let context: AssistantSecurityContext | undefined;
  try {
    context = buildSecurityContext(req);
    const pendingActionId = String(req.params.pendingActionId);

    if (!pendingActionId || pendingActionId === "undefined") {
      res.status(400).json({ error: "pendingActionId é obrigatório", code: "missing_action_id" });
      return;
    }

    const result = await AssistantSafeActionService.confirmAction(pendingActionId, context);

    res.status(200).json(result);
  } catch (err: any) {
    sendSafeError(res, err, "execution_failed", "Erro ao executar ação", context?.requestId);
  }
});

/**
 * POST /api/assistant/actions/:pendingActionId/cancel
 * Cancels pending action proposal.
 * Zero domain writes.
 */
assistantActionsRouter.post("/:pendingActionId/cancel", async (req: AuthRequest, res: Response): Promise<void> => {
  let context: AssistantSecurityContext | undefined;
  try {
    context = buildSecurityContext(req);
    const pendingActionId = String(req.params.pendingActionId);

    if (!pendingActionId || pendingActionId === "undefined") {
      res.status(400).json({ error: "pendingActionId é obrigatório", code: "missing_action_id" });
      return;
    }

    const result = await AssistantSafeActionService.cancelAction(pendingActionId, context);

    res.status(200).json(result);
  } catch (err: any) {
    sendSafeError(res, err, "cancel_failed", "Erro ao cancelar ação", context?.requestId);
  }
});

/**
 * GET /api/assistant/actions/:pendingActionId
 * Safe status check of a pending action.
 */
assistantActionsRouter.get("/:pendingActionId", async (req: AuthRequest, res: Response): Promise<void> => {
  let context: AssistantSecurityContext | undefined;
  try {
    context = buildSecurityContext(req);
    const pendingActionId = String(req.params.pendingActionId);

    const action = await AssistantSafeActionService.getPendingAction(pendingActionId, context);

    if (!action) {
      res.status(404).json({ error: "Ação não encontrada", code: "not_found" });
      return;
    }

    res.status(200).json({
      id: action.id,
      actionType: action.actionType,
      targetType: action.targetType,
      targetId: action.targetId,
      status: action.status,
      summary: action.summary,
      preview: action.previewData,
      expiresAt: action.expiresAt,
      confirmedAt: action.confirmedAt,
      executedAt: action.executedAt,
    });
  } catch (err: any) {
    sendSafeError(res, err, "query_failed", "Erro ao consultar ação", context?.requestId);
  }
});

