import crypto from "crypto";
import { db } from "@workspace/db";
import {
  assistantPendingActionsTable,
  assistantSafeActionAuditTable,
  type AssistantPendingActionRow,
  bookingsTable,
  petsTable,
  tasksTable,
  medicationsTable,
  vaccinesTable,
  invoiceItemsTable,
  invoicesTable,
} from "@workspace/db/schema";
import { eq, and, desc, inArray, sql, count, ilike, gt } from "drizzle-orm";
import { ASSISTANT_CONFIG } from "./assistant.config.js";
import {
  AssistantSafeActionRegistry,
  type CanonicalMutationToolName,
} from "./assistant-safe-action.registry.js";
import { AssistantAuditService } from "./assistant-audit.service.js";
import { BookingDomainService } from "../services/bookingDomainService.js";
import { TaskDomainService } from "../services/taskDomainService.js";
import type {
  AssistantSecurityContext,
  AssistantSafeActionPayload,
} from "./assistant.types.js";

// Rate limiting in-memory storage (Process-local)
interface RateLimitBucket {
  count: number;
  resetAt: number;
}
const previewRateLimits = new Map<number, RateLimitBucket>();
const executeRateLimits = new Map<number, RateLimitBucket>();

export function resetSafeActionRateLimits(): void {
  previewRateLimits.clear();
  executeRateLimits.clear();
}

function checkRateLimit(
  map: Map<number, RateLimitBucket>,
  userId: number,
  limit: number
): boolean {
  const now = Date.now();
  const bucket = map.get(userId);
  if (!bucket || now > bucket.resetAt) {
    map.set(userId, { count: 1, resetAt: now + 60000 });
    return true;
  }
  if (bucket.count >= limit) {
    return false;
  }
  bucket.count++;
  return true;
}

export function computePayloadHash(payload: Record<string, any>): string {
  const canonicalJson = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash("sha256").update(canonicalJson).digest("hex");
}

export function sanitizeAuditString(text?: string | null): string | null {
  if (!text) return null;
  return text
    .replace(/postgres(ql)?:\/\/[^\s]+/gi, "[REDACTED_URI]")
    .replace(/(bearer\s+)[a-zA-Z0-9._\-]+/gi, "[REDACTED_BEARER]")
    .replace(/(password|secret|key|token)["':\s=]+[^\s,"'}{]+/gi, "$1: [REDACTED]");
}



export class AssistantSafeActionService {
  /**
   * Phase 1: PREVIEW
   * Validates parameters, executes domain readiness checks, and registers an expiring pending action.
   * Zero database mutations occur in Phase 1.
   */
  public static async createPendingAction(
    actionType: string,
    rawPayload: Record<string, any>,
    context: AssistantSecurityContext
  ): Promise<{
    action: AssistantSafeActionPayload;
    summary: string;
  }> {
    // 1. Kill Switch & Feature Flag Gate
    if (ASSISTANT_CONFIG.isKillSwitchActive) {
      const err = new Error("O assistente ArkPet está temporariamente desativado pelo administrador.");
      (err as any).statusCode = 503;
      (err as any).code = "assistant_temporarily_unavailable";
      throw err;
    }

    if (!ASSISTANT_CONFIG.areSafeActionsEnabled) {
      const err = new Error("Ações automáticas de mutação estão desativadas nesta instância.");
      (err as any).statusCode = 403;
      (err as any).code = "safe_actions_disabled";
      throw err;
    }

    // 2. Validate Action Registration (GENERIC_MUTATION_TOOL = 0)
    const def = AssistantSafeActionRegistry.getDefinition(actionType);
    if (!def) {
      this.recordSecurityDenialAudit({
        actionType,
        context,
        targetType: "unknown",
        targetId: 0,
        reason: `Tentativa de executar ferramenta de mutação não registrada: "${actionType}"`,
      });
      const err = new Error(`Ação não reconhecida: ${actionType}`);
      (err as any).statusCode = 400;
      (err as any).code = "unregistered_action";
      throw err;
    }

    // 3. RBAC Gate
    if (!def.allowedRoles.includes(context.role)) {
      this.recordSecurityDenialAudit({
        actionType,
        context,
        targetType: def.targetType,
        targetId: rawPayload.bookingId || rawPayload.petId || rawPayload.taskId || 0,
        reason: `Papel ${context.role} não possui permissão para executar ${actionType}`,
      });
      const err = new Error(`Você (${context.role}) não tem permissão para realizar esta ação.`);
      (err as any).statusCode = 403;
      (err as any).code = "role_unauthorized";
      throw err;
    }

    // 4. Tenant Isolation Gate
    if (!context.crecheId) {
      this.recordSecurityDenialAudit({
        actionType,
        context,
        targetType: def.targetType,
        targetId: 0,
        reason: "Mutação de domínio rejeitada: usuário sem crecheId vinculada",
      });
      const err = new Error("Nenhuma unidade (creche) associada à sessão. Ação não autorizada.");
      (err as any).statusCode = 403;
      (err as any).code = "missing_tenant";
      throw err;
    }

    // 5. Rate Limit Gate
    if (!checkRateLimit(previewRateLimits, context.userId, ASSISTANT_CONFIG.safeActionPreviewRateLimit)) {
      const err = new Error("Muitas solicitações de ação. Aguarde um momento antes de tentar novamente.");
      (err as any).statusCode = 429;
      (err as any).code = "rate_limit_exceeded";
      throw err;
    }

    // 6. Validate Input Schema (strip unknown fields)
    const parsedPayload = def.inputSchema.safeParse(rawPayload);
    if (!parsedPayload.success) {
      const err = new Error(`Parâmetros inválidos para ${actionType}: ${JSON.stringify(parsedPayload.error.flatten().fieldErrors)}`);
      (err as any).statusCode = 400;
      (err as any).code = "invalid_payload";
      throw err;
    }
    const validatedPayload = parsedPayload.data;

    // 7. Cleanup and enforce pending action cap
    await this.cleanupExpiredPendingActions(context.userId, context.crecheId);
    const countRows = await db
      .select({ pendingCount: count() })
      .from(assistantPendingActionsTable)
      .where(and(
        eq(assistantPendingActionsTable.userId, context.userId),
        eq(assistantPendingActionsTable.crecheId, context.crecheId),
        eq(assistantPendingActionsTable.status, "pending_confirmation")
      ));
    const pendingCount = Number(countRows[0]?.pendingCount || 0);

    if (Number(pendingCount) >= ASSISTANT_CONFIG.safeActionMaxPendingPerUser) {
      const err = new Error("Limite de ações pendentes atingido. Confirme ou cancele as anteriores antes de criar uma nova.");
      (err as any).statusCode = 429;
      (err as any).code = "pending_actions_quota_exceeded";
      throw err;
    }

    // 8. Execute Domain Preview Builder
    const { targetId, previewData, summary } = await this.buildDomainPreview(
      actionType as CanonicalMutationToolName,
      validatedPayload,
      context
    );

    // 9. Compute Payload Hash & Expiration
    const payloadHash = computePayloadHash(validatedPayload);
    const pendingActionId = `pa_${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + ASSISTANT_CONFIG.safeActionConfirmationTtlSeconds * 1000);

    // 10. Persist Pending Action (Transaction Safe)
    await db.insert(assistantPendingActionsTable).values({
      id: pendingActionId,
      userId: context.userId,
      crecheId: context.crecheId,
      role: context.role,
      actionType,
      targetType: def.targetType,
      targetId,
      validatedPayload,
      payloadHash,
      status: "pending_confirmation",
      previewData,
      summary,
      requestId: context.requestId || null,
      expiresAt,
    });

    const actionPayload: AssistantSafeActionPayload = {
      type: actionType,
      state: "confirmation_required",
      pendingActionId,
      targetType: def.targetType,
      targetId,
      preview: previewData,
      summary,
      expiresAt: expiresAt.toISOString(),
    };

    return {
      action: actionPayload,
      summary,
    };
  }

  /**
   * Phase 2: EXECUTE (Confirmation)
   * Deterministic, zero-LLM execution of a previously previewed pending action.
   * Identity-bound atomic CAS ensures zero foreign state poisoning and zero ID enumeration.
   */
  public static async confirmAction(
    pendingActionId: string,
    context: AssistantSecurityContext
  ): Promise<{
    status: "executed";
    actionType: string;
    targetId: number;
    result: any;
    summary: string;
    isIdempotentReplay?: boolean;
  }> {
    // 1. Kill Switch & Feature Flag Gate
    if (ASSISTANT_CONFIG.isKillSwitchActive) {
      const err = new Error("O assistente ArkPet está temporariamente desativado pelo administrador.");
      (err as any).statusCode = 503;
      (err as any).code = "assistant_temporarily_unavailable";
      throw err;
    }

    if (!ASSISTANT_CONFIG.areSafeActionsEnabled) {
      const err = new Error("Ações automáticas de mutação estão desativadas nesta instância.");
      (err as any).statusCode = 403;
      (err as any).code = "safe_actions_disabled";
      throw err;
    }

    if (!context.crecheId) {
      const err = new Error("Nenhuma unidade (creche) associada à sessão.");
      (err as any).statusCode = 403;
      (err as any).code = "missing_tenant";
      throw err;
    }

    // 2. Rate Limit Gate
    if (!checkRateLimit(executeRateLimits, context.userId, ASSISTANT_CONFIG.safeActionExecuteRateLimit)) {
      const err = new Error("Muitas confirmações enviadas rapidamente. Aguarde alguns segundos.");
      (err as any).statusCode = 429;
      (err as any).code = "rate_limit_exceeded";
      throw err;
    }

    // 3. ATOMIC IDENTITY-BOUND CAS (BLOCKER 1 RESOLUTION):
    // The atomic transition pending_confirmation -> executing MUST be bound to:
    // id, userId, crecheId, role, and expiry!
    const now = new Date();
    const [action] = await db
      .update(assistantPendingActionsTable)
      .set({ status: "executing", confirmedAt: now })
      .where(and(
        eq(assistantPendingActionsTable.id, pendingActionId),
        eq(assistantPendingActionsTable.status, "pending_confirmation"),
        eq(assistantPendingActionsTable.userId, context.userId),
        eq(assistantPendingActionsTable.crecheId, context.crecheId),
        eq(assistantPendingActionsTable.role, context.role),
        gt(assistantPendingActionsTable.expiresAt, now)
      ))
      .returning();

    if (!action) {
      // Secure Failure Lookup (SECURE_BOUND_LOOKUP):
      // Inspect state ONLY bound to current user and current creche!
      // Do NOT fetch unrestricted by ID to prevent enumeration or leaking another user's action.
      const [existing] = await db
        .select()
        .from(assistantPendingActionsTable)
        .where(and(
          eq(assistantPendingActionsTable.id, pendingActionId),
          eq(assistantPendingActionsTable.userId, context.userId),
          eq(assistantPendingActionsTable.crecheId, context.crecheId)
        ))
        .limit(1);

      if (!existing) {
        // Foreign action, guessed ID, or cross-tenant. Return safe 404 without enumeration!
        const err = new Error("Ação pendente não encontrada.");
        (err as any).statusCode = 404;
        (err as any).code = "pending_action_not_found";
        throw err;
      }

      // Action belongs to legitimate user & tenant. Check why CAS failed:

      // Role changed since preview:
      if (existing.role !== context.role) {
        const err = new Error(`Seu papel (${context.role}) é diferente do papel usado na proposta (${existing.role}).`);
        (err as any).statusCode = 403;
        (err as any).code = "role_unauthorized";
        throw err;
      }

      // IDEMPOTENT REPLAY for legitimate owner:
      if (existing.status === "executed") {
        return {
          status: "executed",
          actionType: existing.actionType,
          targetId: existing.targetId,
          result: existing.resultReference,
          summary: `Ação já foi executada anteriormente: ${existing.summary}`,
          isIdempotentReplay: true,
        };
      }

      if (existing.status === "executing") {
        const err = new Error("Esta ação já está sendo executada no momento. Aguarde.");
        (err as any).statusCode = 409;
        (err as any).code = "action_in_flight";
        throw err;
      }

      if (existing.status === "cancelled") {
        const err = new Error("Esta ação foi cancelada pelo usuário e não pode ser executada.");
        (err as any).statusCode = 409;
        (err as any).code = "action_cancelled";
        throw err;
      }

      // Expired:
      if (existing.status === "expired" || existing.expiresAt <= now) {
        if (existing.status === "pending_confirmation") {
          await db
            .update(assistantPendingActionsTable)
            .set({ status: "expired" })
            .where(and(
              eq(assistantPendingActionsTable.id, pendingActionId),
              eq(assistantPendingActionsTable.userId, context.userId),
              eq(assistantPendingActionsTable.status, "pending_confirmation")
            ));
        }
        const err = new Error("Esta confirmação expirou. Peça novamente para realizar a ação.");
        (err as any).statusCode = 410;
        (err as any).code = "action_expired";
        throw err;
      }

      const err = new Error("Ação não está em estado válido para confirmação.");
      (err as any).statusCode = 409;
      (err as any).code = "invalid_action_state";
      throw err;
    }

    // CAS lock acquired! Proceed to deterministic domain execution (ZERO LLM INVOLVEMENT)
    try {
      // 4. Verify payload hash integrity
      const currentHash = computePayloadHash(action.validatedPayload);
      if (currentHash !== action.payloadHash) {
        await db.update(assistantPendingActionsTable)
          .set({ status: "failed", errorMessage: "Payload tampered" })
          .where(eq(assistantPendingActionsTable.id, pendingActionId));
        const err = new Error("Integridade da ação violada. Os parâmetros foram alterados.");
        (err as any).statusCode = 400;
        (err as any).code = "payload_tampered";
        throw err;
      }

      // 5. Execute Canonical Domain Service
      const domainResult = await this.executeCanonicalDomainMutation(action, context);

      // 6. Update status to executed
      const executedAt = new Date();
      await db.update(assistantPendingActionsTable)
        .set({
          status: "executed",
          executedAt,
          resultReference: domainResult.resultReference,
        })
        .where(eq(assistantPendingActionsTable.id, pendingActionId));

      // 7. Record immutable audit record (zero secrets, zero stack traces)
      await db.insert(assistantSafeActionAuditTable).values({
        actionType: action.actionType,
        actorUserId: context.userId,
        actorRole: context.role,
        crecheId: context.crecheId,
        targetType: action.targetType,
        targetId: action.targetId,
        pendingActionId,
        requestId: context.requestId || null,
        result: "SUCCESS",
        beforeState: action.previewData,
        afterState: domainResult.resultReference,
        idempotencyKey: pendingActionId,
        details: sanitizeAuditString(domainResult.summary),
      });

      return {
        status: "executed",
        actionType: action.actionType,
        targetId: action.targetId,
        result: domainResult.resultReference,
        summary: domainResult.summary,
      };
    } catch (execErr: any) {
      // Mark as failed
      await db.update(assistantPendingActionsTable)
        .set({
          status: "failed",
          errorMessage: sanitizeAuditString(execErr.message?.slice(0, 500)) || "Execution failed",
        })
        .where(eq(assistantPendingActionsTable.id, pendingActionId));

      await db.insert(assistantSafeActionAuditTable).values({
        actionType: action.actionType,
        actorUserId: context.userId,
        actorRole: context.role,
        crecheId: context.crecheId,
        targetType: action.targetType,
        targetId: action.targetId,
        pendingActionId,
        requestId: context.requestId || null,
        result: "FAILURE",
        idempotencyKey: `fail_${pendingActionId}`,
        details: sanitizeAuditString(execErr.message?.slice(0, 500)) || "Execution failed",
        denialReason: execErr.code || "DOMAIN_ERROR",
      });

      throw execErr;
    }
  }

  /**
   * User Cancels Pending Action (SAFE_ACTION_CANCEL_CAS_BOUND = YES)
   * Bound to user, tenant, and pending status.
   */
  public static async cancelAction(
    pendingActionId: string,
    context: AssistantSecurityContext,
    reason?: string
  ): Promise<{ status: "cancelled"; pendingActionId: string }> {
    if (!context.crecheId) {
      const err = new Error("Nenhuma unidade (creche) associada à sessão.");
      (err as any).statusCode = 403;
      (err as any).code = "missing_tenant";
      throw err;
    }

    const [action] = await db
      .update(assistantPendingActionsTable)
      .set({ status: "cancelled", errorMessage: reason || "User cancelled" })
      .where(and(
        eq(assistantPendingActionsTable.id, pendingActionId),
        eq(assistantPendingActionsTable.userId, context.userId),
        eq(assistantPendingActionsTable.crecheId, context.crecheId),
        eq(assistantPendingActionsTable.status, "pending_confirmation")
      ))
      .returning();

    if (!action) {
      const [existing] = await db
        .select()
        .from(assistantPendingActionsTable)
        .where(and(
          eq(assistantPendingActionsTable.id, pendingActionId),
          eq(assistantPendingActionsTable.userId, context.userId),
          eq(assistantPendingActionsTable.crecheId, context.crecheId)
        ))
        .limit(1);

      if (!existing) {
        const err = new Error("Ação pendente não encontrada.");
        (err as any).statusCode = 404;
        (err as any).code = "pending_action_not_found";
        throw err;
      }

      if (existing.status === "cancelled") {
        return { status: "cancelled", pendingActionId };
      }

      const err = new Error(`Não é possível cancelar uma ação no estado "${existing.status}".`);
      (err as any).statusCode = 409;
      (err as any).code = existing.status === "executing" ? "action_in_flight" : "invalid_action_state";
      throw err;
    }

    return {
      status: "cancelled",
      pendingActionId,
    };
  }

  public static async confirmPendingAction(
    pendingActionId: string,
    context: AssistantSecurityContext
  ) {
    return this.confirmAction(pendingActionId, context);
  }

  public static async cancelPendingAction(
    pendingActionId: string,
    context: AssistantSecurityContext,
    reason?: string
  ) {
    return this.cancelAction(pendingActionId, context, reason);
  }

  /**
   * Helper to resolve natural language or voice confirmation
   */
  public static async resolveAndConfirmFromInput(
    userText: string,
    context: AssistantSecurityContext
  ): Promise<{
    confirmed: boolean;
    result?: any;
    ambiguous?: boolean;
    pendingActions?: AssistantPendingActionRow[];
  }> {
    const normalized = userText.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    const isConfirmation =
      normalized === "sim" ||
      normalized === "confirmo" ||
      normalized === "confirmar" ||
      normalized === "pode fazer" ||
      normalized === "pode cancelar" ||
      normalized === "confirmar cancelamento" ||
      normalized === "sim confirmar" ||
      normalized === "sim, confirmo" ||
      normalized === "sim, pode fazer";

    if (!isConfirmation || !context.crecheId) {
      return { confirmed: false };
    }

    // Query active pending actions for current user & creche
    const now = new Date();
    const activeActions = await db
      .select()
      .from(assistantPendingActionsTable)
      .where(and(
        eq(assistantPendingActionsTable.userId, context.userId),
        eq(assistantPendingActionsTable.crecheId, context.crecheId),
        eq(assistantPendingActionsTable.status, "pending_confirmation"),
        gt(assistantPendingActionsTable.expiresAt, now)
      ))
      .orderBy(desc(assistantPendingActionsTable.createdAt));

    if (activeActions.length === 0) {
      return { confirmed: false };
    }

    if (activeActions.length > 1) {
      return {
        confirmed: false,
        ambiguous: true,
        pendingActions: activeActions,
      };
    }

    const singleAction = activeActions[0];
    const execResult = await this.confirmAction(singleAction.id, context);
    return {
      confirmed: true,
      result: execResult,
    };
  }

  /**
   * Helper to resolve natural language or voice cancellation
   */
  public static async resolveAndCancelFromInput(
    userText: string,
    context: AssistantSecurityContext
  ): Promise<{
    cancelled: boolean;
    pendingActionId?: string;
  }> {
    const normalized = userText.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    const isCancellation =
      normalized === "nao" ||
      normalized === "cancelar" ||
      normalized === "cancela" ||
      normalized === "esquece" ||
      normalized === "deixa pra la" ||
      normalized === "nao quero" ||
      normalized === "nao confirmo" ||
      normalized.includes("nao quero mais") ||
      normalized.includes("nao quero cancelar") ||
      normalized.includes("cancela a proposta") ||
      normalized.includes("cancelar a proposta") ||
      normalized.startsWith("nao quero");

    if (!isCancellation || !context.crecheId) {
      return { cancelled: false };
    }

    const now = new Date();
    const activeActions = await db
      .select()
      .from(assistantPendingActionsTable)
      .where(and(
        eq(assistantPendingActionsTable.userId, context.userId),
        eq(assistantPendingActionsTable.crecheId, context.crecheId),
        eq(assistantPendingActionsTable.status, "pending_confirmation"),
        gt(assistantPendingActionsTable.expiresAt, now)
      ))
      .orderBy(desc(assistantPendingActionsTable.createdAt));

    if (activeActions.length === 1) {
      await this.cancelAction(activeActions[0].id, context, "Cancelado pelo usuário via chat");
      return { cancelled: true, pendingActionId: activeActions[0].id };
    }

    return { cancelled: false };
  }

  public static async getPendingAction(
    pendingActionId: string,
    context: AssistantSecurityContext
  ): Promise<AssistantPendingActionRow | null> {
    const [action] = await db
      .select()
      .from(assistantPendingActionsTable)
      .where(and(
        eq(assistantPendingActionsTable.id, pendingActionId),
        eq(assistantPendingActionsTable.userId, context.userId),
        eq(assistantPendingActionsTable.crecheId, context.crecheId || 0)
      ))
      .limit(1);

    return action || null;
  }

  private static async cleanupExpiredPendingActions(userId: number, crecheId: number): Promise<void> {
    const now = new Date();
    await db
      .update(assistantPendingActionsTable)
      .set({ status: "expired" })
      .where(and(
        eq(assistantPendingActionsTable.userId, userId),
        eq(assistantPendingActionsTable.crecheId, crecheId),
        eq(assistantPendingActionsTable.status, "pending_confirmation"),
        sql`${assistantPendingActionsTable.expiresAt} <= ${now}`
      ));
  }

  public static async recordSecurityDenialAudit(params: {
    actionType: string;
    context: AssistantSecurityContext;
    targetType: string;
    targetId: number;
    pendingActionId?: string;
    reason: string;
  }): Promise<void> {
    try {
      const cleanReason = sanitizeAuditString(params.reason) || "Security denial";
      await db.insert(assistantSafeActionAuditTable).values({
        actionType: params.actionType,
        actorUserId: params.context.userId,
        actorRole: params.context.role,
        crecheId: params.context.crecheId || 0,
        targetType: params.targetType,
        targetId: params.targetId,
        pendingActionId: params.pendingActionId || null,
        requestId: params.context.requestId || null,
        result: "DENIED",
        idempotencyKey: `denial_${crypto.randomUUID()}`,
        details: cleanReason,
        denialReason: cleanReason,
      });
      AssistantAuditService.logSecurityDenial(params.context, {
        action: params.actionType,
        reason: cleanReason,
        targetId: params.targetId,
      });
    } catch (err) {
      console.error("[safe-action] Failed to write security denial audit:", err);
    }
  }

  /**
   * Domain Preview Builders (Read-Only Validation)
   * Delegates 100% of business eligibility to canonical domain services (BookingDomainService & TaskDomainService).
   * Resolves target strictly without ambiguity (AMBIGUOUS_SAFE_ACTION_TARGET_SELECTION = 0).
   */
  private static async buildDomainPreview(
    actionType: CanonicalMutationToolName,
    payload: any,
    context: AssistantSecurityContext
  ): Promise<{ targetId: number; previewData: any; summary: string }> {
    const crecheId = context.crecheId!;

    switch (actionType) {
      case "cancel_my_booking": {
        return BookingDomainService.previewCancellation({
          bookingId: payload.bookingId,
          crecheId,
          actorUserId: context.userId,
          actorRole: context.role,
          reason: payload.reason,
        });
      }

      case "check_in_pet": {
        return BookingDomainService.previewCheckIn({
          petId: payload.petId,
          bookingId: payload.bookingId,
          crecheId,
          actorUserId: context.userId,
          actorRole: context.role,
          notes: payload.notes,
        });
      }

      case "check_out_pet": {
        return BookingDomainService.previewCheckOut({
          petId: payload.petId,
          bookingId: payload.bookingId,
          crecheId,
          actorUserId: context.userId,
          actorRole: context.role,
          notes: payload.notes,
        });
      }

      case "complete_operational_task": {
        return TaskDomainService.previewTaskCompletion({
          taskId: payload.taskId,
          crecheId,
          expectedType: "operational",
          notes: payload.notes,
        });
      }

      case "complete_feeding_task":
      case "complete_walk_task":
      case "record_medication_administration": {
        const typeMap: Record<string, string> = {
          complete_feeding_task: "feeding",
          complete_walk_task: "walk",
          record_medication_administration: "medication",
        };
        const taskType = typeMap[actionType];

        let resolvedTaskId = payload.taskId;

        if (!resolvedTaskId) {
          const conditions: any[] = [
            eq(tasksTable.crecheId, crecheId),
            eq(tasksTable.type, taskType as any),
            eq(tasksTable.status, "pending"),
          ];
          if (payload.petId) {
            conditions.push(eq(tasksTable.petId, payload.petId));
          }

          const matchingTasks = await db
            .select({ id: tasksTable.id })
            .from(tasksTable)
            .where(and(...conditions))
            .orderBy(tasksTable.scheduledFor);

          if (matchingTasks.length === 0) {
            throw Object.assign(
              new Error(
                payload.petId
                  ? `Nenhuma tarefa de ${taskType} pendente encontrada para este pet.`
                  : `Nenhuma tarefa de ${taskType} pendente encontrada na creche.`
              ),
              { statusCode: 404, code: "target_not_found" }
            );
          }

          if (matchingTasks.length > 1) {
            throw Object.assign(
              new Error(
                payload.petId
                  ? `Existem múltiplas tarefas de ${taskType} pendentes para este pet. Especifique qual tarefa deseja concluir.`
                  : `Existem múltiplas tarefas de ${taskType} pendentes. Especifique o pet ou o identificador da tarefa.`
              ),
              { statusCode: 400, code: "ambiguous_target" }
            );
          }

          resolvedTaskId = matchingTasks[0].id;
        }

        // Delegate domain business validation and preview construction to canonical TaskDomainService
        return TaskDomainService.previewTaskCompletion({
          taskId: resolvedTaskId,
          crecheId,
          expectedType: taskType,
          notes: payload.notes,
        });
      }

      default:
        throw Object.assign(new Error(`Ação não suportada: ${actionType}`), { statusCode: 400, code: "unsupported_action" });
    }
  }

  /**
   * Deterministic execution via Canonical Domain Services (BOOKING_MUTATION_CANONICAL_SERVICE_REUSE = YES)
   */
  private static async executeCanonicalDomainMutation(
    actionRow: AssistantPendingActionRow,
    context: AssistantSecurityContext
  ): Promise<{ resultReference: any; summary: string }> {
    const actionType = actionRow.actionType as CanonicalMutationToolName;
    const payload = actionRow.validatedPayload;
    const crecheId = context.crecheId!;

    switch (actionType) {
      case "cancel_my_booking": {
        const { booking, enriched } = await BookingDomainService.cancelBooking({
          bookingId: actionRow.targetId,
          crecheId,
          actorUserId: context.userId,
          actorRole: context.role,
          reason: payload.reason,
        });

        return {
          resultReference: {
            bookingId: booking.id,
            status: "cancelled",
            petName: enriched.petName,
            cancellationReason: payload.reason || "Cancelado pelo tutor",
          },
          summary: `Reserva #${booking.id} (${enriched.petName ?? "Pet"}) cancelada com sucesso.`,
        };
      }

      case "check_in_pet": {
        const bookingId = payload.bookingId || actionRow.previewData?.bookingId;
        const { booking, enriched } = await BookingDomainService.checkInBooking({
          bookingId,
          petId: actionRow.targetId,
          crecheId,
          actorUserId: context.userId,
          actorRole: context.role,
          notes: payload.notes,
        });

        return {
          resultReference: {
            bookingId: booking.id,
            petId: booking.petId,
            petName: enriched.petName,
            status: "active",
            checkInTime: booking.checkInTime,
          },
          summary: `Check-in do pet ${enriched.petName ?? "Pet"} realizado com sucesso.`,
        };
      }

      case "check_out_pet": {
        const bookingId = payload.bookingId || actionRow.previewData?.bookingId;
        const { booking, enriched } = await BookingDomainService.checkOutBooking({
          bookingId,
          crecheId,
          actorUserId: context.userId,
          actorRole: context.role,
          notes: payload.notes,
        });

        return {
          resultReference: {
            bookingId: booking.id,
            petId: booking.petId,
            petName: enriched.petName,
            status: "completed",
            checkOutTime: booking.checkOutTime,
          },
          summary: `Check-out do pet ${enriched.petName ?? "Pet"} realizado com sucesso.`,
        };
      }

      case "complete_operational_task":
      case "complete_feeding_task":
      case "complete_walk_task": {
        const taskId = actionRow.targetId;
        const { task } = await TaskDomainService.completeTask({
          taskId,
          crecheId,
          actorUserId: context.userId,
          actorName: context.name,
          notes: payload.notes,
        });

        return {
          resultReference: {
            taskId: task.id,
            status: "completed",
            completedAt: task.completedAt,
            completedBy: context.name,
          },
          summary: `Tarefa #${task.id} (${task.title}) marcada como concluída.`,
        };
      }

      case "record_medication_administration": {
        const taskId = actionRow.targetId;
        const { task } = await TaskDomainService.recordMedicationAdministration({
          taskId,
          crecheId,
          actorUserId: context.userId,
          actorName: context.name,
          medicationId: payload.medicationId,
          petId: payload.petId,
          notes: payload.notes,
        });

        return {
          resultReference: {
            taskId: task.id,
            status: "completed",
            completedAt: task.completedAt,
            completedBy: context.name,
          },
          summary: `Administração de medicamento (${task.title}) registrada com sucesso.`,
        };
      }

      default:
        throw Object.assign(new Error(`Ação não suportada para execução: ${actionType}`), { statusCode: 400 });
    }
  }
}
