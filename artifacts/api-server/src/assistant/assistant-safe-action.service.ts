import crypto from "crypto";
import { db } from "@workspace/db";
import {
  assistantPendingActionsTable,
  assistantSafeActionAuditTable,
  type AssistantPendingActionRow,
} from "@workspace/db/schema";
import {
  bookingsTable,
  petsTable,
  tasksTable,
  medicationsTable,
  vaccinesTable,
  invoiceItemsTable,
  invoicesTable,
} from "@workspace/db/schema";
import { eq, and, desc, inArray, sql, count, ilike } from "drizzle-orm";
import { ASSISTANT_CONFIG } from "./assistant.config.js";
import {
  AssistantSafeActionRegistry,
  SAFE_ACTION_REGISTRY,
  type CanonicalMutationToolName,
} from "./assistant-safe-action.registry.js";
import { AssistantAuditService } from "./assistant-audit.service.js";
import {
  restoreBookingPackageCredits,
  restoreBookingServiceCredits,
  restoreAdditionalServices,
} from "../services/credits.js";
import { CrecheCampaignReservationService } from "../services/crecheCampaignReservation.service.js";
import { logFinancialAudit } from "../services/audit.js";
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

    // 4. Tenant Isolation Gate (MASTER_ADMIN_IMPLICIT_TENANT_MUTATION = 0)
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

    // 7. Cleanup and enforce pending action cap (max 20)
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
   * Revalidates RBAC, tenant, entity ownership, expiry, and domain state.
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

    // 2. Rate Limit Gate
    if (!checkRateLimit(executeRateLimits, context.userId, ASSISTANT_CONFIG.safeActionExecuteRateLimit)) {
      const err = new Error("Muitas confirmações enviadas rapidamente. Aguarde alguns segundos.");
      (err as any).statusCode = 429;
      (err as any).code = "rate_limit_exceeded";
      throw err;
    }

    // 3. Atomic CAS: Attempt to lock and transition pending_confirmation -> executing
    const [action] = await db
      .update(assistantPendingActionsTable)
      .set({ status: "executing" })
      .where(and(
        eq(assistantPendingActionsTable.id, pendingActionId),
        eq(assistantPendingActionsTable.status, "pending_confirmation")
      ))
      .returning();

    if (!action) {
      // Check existing state for idempotency, cancellation, or expiration
      const [existing] = await db
        .select()
        .from(assistantPendingActionsTable)
        .where(eq(assistantPendingActionsTable.id, pendingActionId))
        .limit(1);

      if (!existing) {
        const err = new Error("Ação pendente não encontrada.");
        (err as any).statusCode = 404;
        (err as any).code = "pending_action_not_found";
        throw err;
      }

      // IDEMPOTENCY: If already executed, return cached result without duplicating writes!
      if (existing.status === "executed") {
        return {
          status: "executed",
          actionType: existing.actionType,
          targetId: existing.targetId,
          result: existing.resultReference,
          summary: `Ação já foi executada anteriormente: ${existing.summary}`,
        };
      }

      if (existing.status === "cancelled") {
        const err = new Error("Esta ação foi cancelada pelo usuário e não pode ser executada.");
        (err as any).statusCode = 409;
        (err as any).code = "action_cancelled";
        throw err;
      }

      if (existing.status === "expired") {
        const err = new Error("Esta confirmação expirou. Peça novamente para realizar a ação.");
        (err as any).statusCode = 409;
        (err as any).code = "action_expired";
        throw err;
      }

      if (existing.status === "executing") {
        const err = new Error("Esta ação já está sendo executada no momento. Aguarde.");
        (err as any).statusCode = 409;
        (err as any).code = "action_in_flight";
        throw err;
      }

      const err = new Error("Ação não está em estado válido para confirmação.");
      (err as any).statusCode = 409;
      (err as any).code = "invalid_action_state";
      throw err;
    }

    try {
      // 4. Revalidate User Binding (CONFIRMATION_TOKEN_USER_BOUND = YES)
      if (action.userId !== context.userId) {
        await this.recordSecurityDenialAudit({
          actionType: action.actionType,
          context,
          targetType: action.targetType,
          targetId: action.targetId,
          pendingActionId,
          reason: `Tentativa de confirmação por usuário diferente (criador: ${action.userId}, atual: ${context.userId})`,
        });
        await db.update(assistantPendingActionsTable)
          .set({ status: "failed", errorMessage: "User mismatch" })
          .where(eq(assistantPendingActionsTable.id, pendingActionId));
        const err = new Error("Você não tem autorização para confirmar ações geradas por outro usuário.");
        (err as any).statusCode = 403;
        (err as any).code = "user_mismatch";
        throw err;
      }

      // 5. Revalidate Tenant Binding (CONFIRMATION_TOKEN_TENANT_BOUND = YES, CROSS_TENANT_MUTATION = 0)
      if (action.crecheId !== context.crecheId) {
        await this.recordSecurityDenialAudit({
          actionType: action.actionType,
          context,
          targetType: action.targetType,
          targetId: action.targetId,
          pendingActionId,
          reason: `Tentativa de confirmação cross-tenant (crecheId ação: ${action.crecheId}, sessão: ${context.crecheId})`,
        });
        await db.update(assistantPendingActionsTable)
          .set({ status: "failed", errorMessage: "Tenant mismatch" })
          .where(eq(assistantPendingActionsTable.id, pendingActionId));
        const err = new Error("Ação não pertence à unidade atual.");
        (err as any).statusCode = 403;
        (err as any).code = "tenant_mismatch";
        throw err;
      }

      // 6. Revalidate Role Binding (STALE_AUTHORIZATION_MUTATION = 0)
      if (action.role !== context.role) {
        await this.recordSecurityDenialAudit({
          actionType: action.actionType,
          context,
          targetType: action.targetType,
          targetId: action.targetId,
          pendingActionId,
          reason: `Mudança de papel entre preview e confirmação (preview: ${action.role}, atual: ${context.role})`,
        });
        await db.update(assistantPendingActionsTable)
          .set({ status: "failed", errorMessage: "Role changed" })
          .where(eq(assistantPendingActionsTable.id, pendingActionId));
        const err = new Error("Suas permissões foram alteradas. Ação cancelada por segurança.");
        (err as any).statusCode = 403;
        (err as any).code = "role_changed";
        throw err;
      }

      // 7. Check Expiry
      if (new Date() > new Date(action.expiresAt)) {
        await db.update(assistantPendingActionsTable)
          .set({ status: "expired" })
          .where(eq(assistantPendingActionsTable.id, pendingActionId));
        await this.recordSecurityDenialAudit({
          actionType: action.actionType,
          context,
          targetType: action.targetType,
          targetId: action.targetId,
          pendingActionId,
          reason: `Tentativa de confirmação de ação expirada em ${action.expiresAt}`,
        });
        const err = new Error("Esta confirmação expirou. Peça novamente para realizar a ação.");
        (err as any).statusCode = 409;
        (err as any).code = "action_expired";
        throw err;
      }

      // 8. Revalidate Payload Hash (CONFIRMATION_PAYLOAD_TAMPERING = 0)
      const currentHash = computePayloadHash(action.validatedPayload);
      if (currentHash !== action.payloadHash) {
        await this.recordSecurityDenialAudit({
          actionType: action.actionType,
          context,
          targetType: action.targetType,
          targetId: action.targetId,
          pendingActionId,
          reason: "Detecção de adulteração de payload (hash mismatch)",
        });
        await db.update(assistantPendingActionsTable)
          .set({ status: "failed", errorMessage: "Payload tampering detected" })
          .where(eq(assistantPendingActionsTable.id, pendingActionId));
        const err = new Error("Dados da ação foram corrompidos ou alterados. Ação cancelada.");
        (err as any).statusCode = 400;
        (err as any).code = "payload_tampered";
        throw err;
      }

      // 9. Execute Canonical Domain Service (Transaction Bound)
      const executionResult = await this.executeDomainAction(
        action.actionType as CanonicalMutationToolName,
        action.validatedPayload,
        context,
        action
      );

      // 10. Write Immutable Audit Record (SAFE_ACTION_AUDIT = PASS)
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
        afterState: executionResult.resultReference,
        idempotencyKey: pendingActionId,
        details: executionResult.summary,
      });

      // 11. Mark Pending Action Executed
      await db.update(assistantPendingActionsTable)
        .set({
          status: "executed",
          confirmedAt: new Date(),
          executedAt: new Date(),
          resultReference: executionResult.resultReference,
        })
        .where(eq(assistantPendingActionsTable.id, pendingActionId));

      return {
        status: "executed",
        actionType: action.actionType,
        targetId: action.targetId,
        result: executionResult.resultReference,
        summary: executionResult.summary,
      };
    } catch (err: any) {
      // If error occurred during execution, mark failed if not already handled
      if (err.code !== "user_mismatch" && err.code !== "tenant_mismatch" && err.code !== "role_changed" && err.code !== "action_expired" && err.code !== "payload_tampered") {
        await db.update(assistantPendingActionsTable)
          .set({ status: "failed", errorMessage: err.message || String(err) })
          .where(eq(assistantPendingActionsTable.id, pendingActionId));
      }
      throw err;
    }
  }

  /**
   * User Cancels Pending Action (CANCELLED_PENDING_ACTION_EXECUTION = 0)
   */
  public static async cancelAction(
    pendingActionId: string,
    context: AssistantSecurityContext
  ): Promise<{ status: "cancelled"; pendingActionId: string }> {
    const [action] = await db
      .select()
      .from(assistantPendingActionsTable)
      .where(eq(assistantPendingActionsTable.id, pendingActionId))
      .limit(1);

    if (!action) {
      const err = new Error("Ação pendente não encontrada.");
      (err as any).statusCode = 404;
      (err as any).code = "pending_action_not_found";
      throw err;
    }

    if (action.userId !== context.userId || action.crecheId !== context.crecheId) {
      const err = new Error("Ação não pertence a você.");
      (err as any).statusCode = 403;
      throw err;
    }

    if (action.status !== "pending_confirmation") {
      const err = new Error(`Não é possível cancelar uma ação no estado "${action.status}".`);
      (err as any).statusCode = 409;
      throw err;
    }

    await db.update(assistantPendingActionsTable)
      .set({ status: "cancelled" })
      .where(eq(assistantPendingActionsTable.id, pendingActionId));

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
    _reason?: string
  ) {
    return this.cancelAction(pendingActionId, context);
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

    // Query active pending actions
    const now = new Date();
    const activeActions = await db
      .select()
      .from(assistantPendingActionsTable)
      .where(and(
        eq(assistantPendingActionsTable.userId, context.userId),
        eq(assistantPendingActionsTable.crecheId, context.crecheId),
        eq(assistantPendingActionsTable.status, "pending_confirmation"),
        sql`${assistantPendingActionsTable.expiresAt} > ${now}`
      ))
      .orderBy(desc(assistantPendingActionsTable.createdAt));

    if (activeActions.length === 0) {
      return { confirmed: false };
    }

    if (activeActions.length > 1) {
      // AMBIGUOUS_CONFIRMATION_EXECUTION = 0
      return {
        confirmed: false,
        ambiguous: true,
        pendingActions: activeActions,
      };
    }

    // Exactly 1 pending action -> Execute deterministic confirmation
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
  ): Promise<{ cancelled: boolean; pendingActionId?: string }> {
    const normalized = userText.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    const isCancellation =
      normalized === "nao" ||
      normalized === "cancelar" ||
      normalized === "cancele" ||
      normalized === "cancela isso" ||
      normalized === "desistir" ||
      normalized === "desisto" ||
      normalized.includes("nao quero") ||
      normalized.includes("nao cancelar") ||
      normalized.includes("nao confirmo");

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
        sql`${assistantPendingActionsTable.expiresAt} > ${now}`
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
        details: params.reason,
        denialReason: params.reason,
      });
      AssistantAuditService.logSecurityDenial(params.context, {
        action: params.actionType,
        reason: params.reason,
        targetId: params.targetId,
      });
    } catch (err) {
      console.error("[safe-action] Failed to write security denial audit:", err);
    }
  }

  /**
   * Domain Preview Builders (Read-Only Validation)
   */
  private static async buildDomainPreview(
    actionType: CanonicalMutationToolName,
    payload: any,
    context: AssistantSecurityContext
  ): Promise<{ targetId: number; previewData: any; summary: string }> {
    const crecheId = context.crecheId!;

    switch (actionType) {
      case "cancel_my_booking": {
        const bookingId = payload.bookingId;
        const [booking] = await db
          .select({
            id: bookingsTable.id,
            tutorId: bookingsTable.tutorId,
            crecheId: bookingsTable.crecheId,
            petId: bookingsTable.petId,
            startDate: bookingsTable.startDate,
            endDate: bookingsTable.endDate,
            type: bookingsTable.type,
            status: bookingsTable.status,
          })
          .from(bookingsTable)
          .where(and(
            eq(bookingsTable.id, bookingId),
            eq(bookingsTable.crecheId, crecheId)
          ))
          .limit(1);

        if (!booking || booking.tutorId !== context.userId) {
          throw Object.assign(new Error("Reserva não encontrada."), { statusCode: 404 });
        }

        if (!["pending", "confirmed"].includes(booking.status)) {
          throw Object.assign(new Error(`Não é possível cancelar reserva com status "${booking.status}". Só é possível cancelar reservas pendentes ou confirmadas.`), { statusCode: 400 });
        }

        // Paid items guard (reusing canonical domain rule from bookings.ts)
        const paidItems = await db
          .select({ itemId: invoiceItemsTable.id })
          .from(invoiceItemsTable)
          .innerJoin(invoicesTable, eq(invoiceItemsTable.invoiceId, invoicesTable.id))
          .where(and(
            eq(invoiceItemsTable.bookingId, bookingId),
            eq(invoicesTable.crecheId, crecheId),
            inArray(invoicesTable.status, ["paid", "refunded"])
          ))
          .limit(1);

        if (paidItems.length > 0) {
          throw Object.assign(new Error("Não é possível cancelar - a reserva possui cobranças com pagamento já processado."), { statusCode: 422 });
        }

        const [pet] = await db.select({ name: petsTable.name }).from(petsTable).where(eq(petsTable.id, booking.petId)).limit(1);
        const petName = pet?.name || "Pet";
        const dateStr = new Date(booking.startDate).toLocaleDateString("pt-BR");

        return {
          targetId: booking.id,
          previewData: {
            bookingId: booking.id,
            petId: booking.petId,
            petName,
            date: dateStr,
            serviceType: booking.type,
            status: booking.status,
          },
          summary: `Cancelar reserva #${booking.id} (${booking.type}) de ${petName} para ${dateStr}`,
        };
      }

      case "check_in_pet": {
        const petId = payload.petId;
        const [pet] = await db
          .select({ id: petsTable.id, name: petsTable.name, isCheckedIn: petsTable.isCheckedIn })
          .from(petsTable)
          .where(and(eq(petsTable.id, petId), eq(petsTable.crecheId, crecheId)))
          .limit(1);

        if (!pet) {
          throw Object.assign(new Error("Pet não encontrado nesta creche."), { statusCode: 404 });
        }

        // Find confirmed booking for today
        const conditions: any[] = [
          eq(bookingsTable.crecheId, crecheId),
          eq(bookingsTable.petId, petId),
          eq(bookingsTable.status, "confirmed"),
        ];
        if (payload.bookingId) {
          conditions.push(eq(bookingsTable.id, payload.bookingId));
        }

        const [booking] = await db
          .select({
            id: bookingsTable.id,
            type: bookingsTable.type,
            startDate: bookingsTable.startDate,
            status: bookingsTable.status,
          })
          .from(bookingsTable)
          .where(and(...conditions))
          .limit(1);

        if (!booking) {
          throw Object.assign(new Error("Não há reserva confirmada para este pet realizar check-in."), { statusCode: 400 });
        }

        // Rabies vaccine check
        const [rabies] = await db
          .select()
          .from(vaccinesTable)
          .where(and(
            eq(vaccinesTable.petId, petId),
            eq(vaccinesTable.crecheId, crecheId),
            ilike(vaccinesTable.name, "%antirr%")
          ))
          .orderBy(desc(vaccinesTable.appliedDate))
          .limit(1);

        if (rabies?.nextDueDate && new Date(rabies.nextDueDate) < new Date()) {
          throw Object.assign(new Error("Vacina antirrábica vencida. Check-in bloqueado por razões de saúde e segurança."), { statusCode: 403 });
        }

        // Active check-in check
        const [activeBooking] = await db
          .select({ id: bookingsTable.id, status: bookingsTable.status })
          .from(bookingsTable)
          .where(and(
            eq(bookingsTable.crecheId, crecheId),
            eq(bookingsTable.petId, petId),
            eq(bookingsTable.status, "active")
          ))
          .limit(1);

        if (activeBooking && activeBooking.status === "active") {
          throw Object.assign(new Error("Este pet já possui um check-in ativo desta mesma categoria. Realize o check-out antes de fazer um novo."), { statusCode: 409 });
        }

        return {
          targetId: pet.id,
          previewData: {
            petId: pet.id,
            petName: pet.name,
            bookingId: booking.id,
            serviceType: booking.type,
            notes: payload.notes || null,
          },
          summary: `Realizar check-in do pet ${pet.name} (Reserva #${booking.id} - ${booking.type})`,
        };
      }

      case "check_out_pet": {
        const petId = payload.petId;
        const [pet] = await db
          .select({ id: petsTable.id, name: petsTable.name, isCheckedIn: petsTable.isCheckedIn })
          .from(petsTable)
          .where(and(eq(petsTable.id, petId), eq(petsTable.crecheId, crecheId)))
          .limit(1);

        if (!pet) {
          throw Object.assign(new Error("Pet não encontrado nesta creche."), { statusCode: 404 });
        }

        const conditions: any[] = [
          eq(bookingsTable.crecheId, crecheId),
          eq(bookingsTable.petId, petId),
          eq(bookingsTable.status, "active"),
        ];
        if (payload.bookingId) {
          conditions.push(eq(bookingsTable.id, payload.bookingId));
        }

        const [activeBooking] = await db
          .select({
            id: bookingsTable.id,
            type: bookingsTable.type,
            checkInTime: bookingsTable.checkInTime,
          })
          .from(bookingsTable)
          .where(and(...conditions))
          .limit(1);

        if (!activeBooking) {
          throw Object.assign(new Error("O pet não possui reserva ativa para check-out."), { statusCode: 400 });
        }

        return {
          targetId: pet.id,
          previewData: {
            petId: pet.id,
            petName: pet.name,
            bookingId: activeBooking.id,
            serviceType: activeBooking.type,
            checkInTime: activeBooking.checkInTime,
            notes: payload.notes || null,
          },
          summary: `Realizar check-out do pet ${pet.name} (Reserva #${activeBooking.id})`,
        };
      }

      case "complete_feeding_task": {
        let task: any = null;
        if (payload.taskId) {
          [task] = await db
            .select()
            .from(tasksTable)
            .where(and(
              eq(tasksTable.id, payload.taskId),
              eq(tasksTable.crecheId, crecheId),
              eq(tasksTable.type, "feeding")
            ))
            .limit(1);
        } else if (payload.petId) {
          [task] = await db
            .select()
            .from(tasksTable)
            .where(and(
              eq(tasksTable.crecheId, crecheId),
              eq(tasksTable.petId, payload.petId),
              eq(tasksTable.type, "feeding"),
              eq(tasksTable.status, "pending")
            ))
            .orderBy(tasksTable.scheduledFor)
            .limit(1);
        } else {
          [task] = await db
            .select()
            .from(tasksTable)
            .where(and(
              eq(tasksTable.crecheId, crecheId),
              eq(tasksTable.type, "feeding"),
              eq(tasksTable.status, "pending")
            ))
            .orderBy(tasksTable.scheduledFor)
            .limit(1);
        }

        if (!task) {
          throw Object.assign(new Error("Tarefa de alimentação não encontrada ou já concluída."), { statusCode: 404 });
        }

        if (task.status !== "pending") {
          throw Object.assign(new Error("Esta tarefa de alimentação já foi concluída."), { statusCode: 409 });
        }

        const [pet] = task.petId ? await db.select({ name: petsTable.name }).from(petsTable).where(eq(petsTable.id, task.petId)).limit(1) : [null];
        const petName = pet?.name || "Pet";

        return {
          targetId: task.id,
          previewData: {
            taskId: task.id,
            petId: task.petId,
            petName,
            title: task.title,
            scheduledFor: task.scheduledFor,
            description: task.description,
            notes: payload.notes || null,
          },
          summary: `Concluir alimentação: ${task.title} para ${petName}`,
        };
      }

      case "record_medication_administration": {
        let task: any = null;
        if (payload.taskId) {
          [task] = await db
            .select()
            .from(tasksTable)
            .where(and(
              eq(tasksTable.id, payload.taskId),
              eq(tasksTable.crecheId, crecheId),
              eq(tasksTable.type, "medication")
            ))
            .limit(1);
        } else if (payload.petId) {
          [task] = await db
            .select()
            .from(tasksTable)
            .where(and(
              eq(tasksTable.crecheId, crecheId),
              eq(tasksTable.petId, payload.petId),
              eq(tasksTable.type, "medication"),
              eq(tasksTable.status, "pending")
            ))
            .orderBy(tasksTable.scheduledFor)
            .limit(1);
        } else {
          [task] = await db
            .select()
            .from(tasksTable)
            .where(and(
              eq(tasksTable.crecheId, crecheId),
              eq(tasksTable.type, "medication"),
              eq(tasksTable.status, "pending")
            ))
            .orderBy(tasksTable.scheduledFor)
            .limit(1);
        }

        if (!task) {
          throw Object.assign(new Error("Tarefa de medicação não encontrada ou já administrada."), { statusCode: 404 });
        }

        if (task.status !== "pending") {
          throw Object.assign(new Error("Esta medicação já foi marcada como administrada."), { statusCode: 409 });
        }

        const [pet] = task.petId ? await db.select({ name: petsTable.name }).from(petsTable).where(eq(petsTable.id, task.petId)).limit(1) : [null];
        const petName = pet?.name || "Pet";

        return {
          targetId: task.id,
          previewData: {
            taskId: task.id,
            petId: task.petId,
            petName,
            medicationName: task.title,
            canonicalDosage: task.description || "Dose prescrita",
            scheduledFor: task.scheduledFor,
            notes: payload.notes || null,
          },
          summary: `Registrar administração de medicamento: ${task.title} (${task.description || "Dose padrão"}) para ${petName}`,
        };
      }

      case "complete_walk_task": {
        let task: any = null;
        if (payload.taskId) {
          [task] = await db
            .select()
            .from(tasksTable)
            .where(and(
              eq(tasksTable.id, payload.taskId),
              eq(tasksTable.crecheId, crecheId),
              eq(tasksTable.type, "walk")
            ))
            .limit(1);
        } else if (payload.petId) {
          [task] = await db
            .select()
            .from(tasksTable)
            .where(and(
              eq(tasksTable.crecheId, crecheId),
              eq(tasksTable.petId, payload.petId),
              eq(tasksTable.type, "walk"),
              eq(tasksTable.status, "pending")
            ))
            .orderBy(tasksTable.scheduledFor)
            .limit(1);
        } else {
          [task] = await db
            .select()
            .from(tasksTable)
            .where(and(
              eq(tasksTable.crecheId, crecheId),
              eq(tasksTable.type, "walk"),
              eq(tasksTable.status, "pending")
            ))
            .orderBy(tasksTable.scheduledFor)
            .limit(1);
        }

        if (!task) {
          throw Object.assign(new Error("Tarefa de passeio não encontrada ou já concluída."), { statusCode: 404 });
        }

        if (task.status !== "pending") {
          throw Object.assign(new Error("Este passeio já foi marcado como concluído."), { statusCode: 409 });
        }

        const [pet] = task.petId ? await db.select({ name: petsTable.name }).from(petsTable).where(eq(petsTable.id, task.petId)).limit(1) : [null];
        const petName = pet?.name || "Pet";

        return {
          targetId: task.id,
          previewData: {
            taskId: task.id,
            petId: task.petId,
            petName,
            title: task.title,
            scheduledFor: task.scheduledFor,
            notes: payload.notes || null,
          },
          summary: `Concluir passeio: ${task.title} para ${petName}`,
        };
      }

      case "complete_operational_task": {
        const taskId = payload.taskId;
        const [task] = await db
          .select()
          .from(tasksTable)
          .where(and(
            eq(tasksTable.id, taskId),
            eq(tasksTable.crecheId, crecheId)
          ))
          .limit(1);

        if (!task) {
          throw Object.assign(new Error("Tarefa operacional não encontrada."), { statusCode: 404 });
        }

        if (task.status !== "pending") {
          throw Object.assign(new Error("Esta tarefa já foi concluída."), { statusCode: 409 });
        }

        const [pet] = task.petId ? await db.select({ name: petsTable.name }).from(petsTable).where(eq(petsTable.id, task.petId)).limit(1) : [null];

        return {
          targetId: task.id,
          previewData: {
            taskId: task.id,
            petId: task.petId,
            petName: pet?.name || null,
            title: task.title,
            type: task.type,
            scheduledFor: task.scheduledFor,
            notes: payload.notes || null,
          },
          summary: `Concluir tarefa operacional #${task.id}: ${task.title}`,
        };
      }

      default:
        throw Object.assign(new Error(`Ação não suportada: ${actionType}`), { statusCode: 400 });
    }
  }

  /**
   * Domain Execution Handlers (Transaction Bound, Revalidating State)
   */
  private static async executeDomainAction(
    actionType: CanonicalMutationToolName,
    payload: any,
    context: AssistantSecurityContext,
    actionRow: AssistantPendingActionRow
  ): Promise<{ resultReference: any; summary: string }> {
    const crecheId = context.crecheId!;

    return await db.transaction(async (tx) => {
      switch (actionType) {
        case "cancel_my_booking": {
          const bookingId = actionRow.targetId;

          // Revalidate domain state under row-level lock
          const [booking] = await tx
            .select()
            .from(bookingsTable)
            .where(and(
              eq(bookingsTable.id, bookingId),
              eq(bookingsTable.crecheId, crecheId)
            ))
            .limit(1)
            .for("update");

          if (!booking || booking.tutorId !== context.userId) {
            throw Object.assign(new Error("Reserva não encontrada."), { statusCode: 404 });
          }

          if (booking.status === "cancelled") {
            // Already cancelled -> idempotent success
            return {
              resultReference: { bookingId, status: "cancelled", idempotent: true },
              summary: `Reserva #${bookingId} já estava cancelada.`,
            };
          }

          if (!["pending", "confirmed"].includes(booking.status)) {
            throw Object.assign(new Error(`Não é possível cancelar reserva com status "${booking.status}".`), { statusCode: 409 });
          }

          // Revalidate paid invoice items
          const paidItems = await tx
            .select({ itemId: invoiceItemsTable.id })
            .from(invoiceItemsTable)
            .innerJoin(invoicesTable, eq(invoiceItemsTable.invoiceId, invoicesTable.id))
            .where(and(
              eq(invoiceItemsTable.bookingId, bookingId),
              eq(invoicesTable.crecheId, crecheId),
              inArray(invoicesTable.status, ["paid", "refunded"])
            ))
            .limit(1);

          if (paidItems.length > 0) {
            throw Object.assign(new Error("Não é possível cancelar - a reserva possui cobranças com pagamento já processado."), { statusCode: 422 });
          }

          // Restore package credits and add-on services
          await restoreBookingPackageCredits(bookingId, tx, crecheId);
          await restoreBookingServiceCredits(bookingId, tx, crecheId);
          if (booking.tutorId) {
            await restoreAdditionalServices(bookingId, booking.tutorId, crecheId, tx);
          }

          // Update booking status
          await tx
            .update(bookingsTable)
            .set({
              status: "cancelled",
              notes: booking.notes
                ? `${booking.notes}\nCancelado pelo tutor via assistente.`
                : "Cancelado pelo tutor via assistente.",
            })
            .where(eq(bookingsTable.id, bookingId));

          // Release promotional campaigns
          await CrecheCampaignReservationService.releaseBookingCampaigns(
            tx,
            crecheId,
            bookingId,
            "booking_cancelled",
            { userId: context.userId, role: context.role }
          );

          // Log financial audit
          await logFinancialAudit({
            crecheId,
            userId: context.userId,
            action: "credits_deduct",
            referenceId: bookingId,
            referenceType: "bookings",
            details: "Estorno de créditos devido a cancelamento da reserva via assistente.",
          }, tx);

          return {
            resultReference: { bookingId, previousStatus: booking.status, newStatus: "cancelled" },
            summary: `Reserva #${bookingId} foi cancelada com sucesso.`,
          };
        }

        case "check_in_pet": {
          const petId = actionRow.targetId;
          const bookingId = actionRow.previewData.bookingId;

          // Revalidate booking state
          const [booking] = await tx
            .select()
            .from(bookingsTable)
            .where(and(
              eq(bookingsTable.id, bookingId),
              eq(bookingsTable.crecheId, crecheId)
            ))
            .limit(1)
            .for("update");

          if (!booking || booking.petId !== petId) {
            throw Object.assign(new Error("Reserva não encontrada."), { statusCode: 404 });
          }

          if (booking.status === "active") {
            return {
              resultReference: { bookingId, petId, status: "active", idempotent: true },
              summary: `Pet já realizou check-in para esta reserva.`,
            };
          }

          if (booking.status !== "confirmed") {
            throw Object.assign(new Error(`Apenas reservas confirmadas podem realizar check-in (status atual: ${booking.status}).`), { statusCode: 409 });
          }

          const now = new Date();

          // Update booking status -> active
          await tx
            .update(bookingsTable)
            .set({
              status: "active",
              checkInTime: now,
            })
            .where(eq(bookingsTable.id, bookingId));

          // Update pet isCheckedIn -> true
          await tx
            .update(petsTable)
            .set({ isCheckedIn: true })
            .where(eq(petsTable.id, petId));

          return {
            resultReference: { bookingId, petId, checkInTime: now.toISOString(), status: "active" },
            summary: `Check-in do pet #${petId} realizado com sucesso.`,
          };
        }

        case "check_out_pet": {
          const petId = actionRow.targetId;
          const bookingId = actionRow.previewData.bookingId;

          const [booking] = await tx
            .select()
            .from(bookingsTable)
            .where(and(
              eq(bookingsTable.id, bookingId),
              eq(bookingsTable.crecheId, crecheId)
            ))
            .limit(1)
            .for("update");

          if (!booking || booking.petId !== petId) {
            throw Object.assign(new Error("Reserva não encontrada."), { statusCode: 404 });
          }

          if (booking.status === "completed") {
            return {
              resultReference: { bookingId, petId, status: "completed", idempotent: true },
              summary: `Check-out da reserva já havia sido realizado.`,
            };
          }

          if (booking.status !== "active") {
            throw Object.assign(new Error(`Apenas reservas ativas podem realizar check-out (status atual: ${booking.status}).`), { statusCode: 409 });
          }

          const now = new Date();

          await tx
            .update(bookingsTable)
            .set({
              status: "completed",
              checkOutTime: now,
            })
            .where(eq(bookingsTable.id, bookingId));

          // Check if pet has any remaining active booking
          const remainingActive = await tx
            .select({ id: bookingsTable.id })
            .from(bookingsTable)
            .where(and(
              eq(bookingsTable.crecheId, crecheId),
              eq(bookingsTable.petId, petId),
              eq(bookingsTable.status, "active")
            ))
            .limit(1);

          if (remainingActive.length === 0) {
            await tx
              .update(petsTable)
              .set({ isCheckedIn: false })
              .where(eq(petsTable.id, petId));
          }

          return {
            resultReference: { bookingId, petId, checkOutTime: now.toISOString(), status: "completed" },
            summary: `Check-out do pet #${petId} realizado com sucesso.`,
          };
        }

        case "complete_feeding_task":
        case "complete_walk_task":
        case "complete_operational_task": {
          const taskId = actionRow.targetId;

          const [task] = await tx
            .select()
            .from(tasksTable)
            .where(and(
              eq(tasksTable.id, taskId),
              eq(tasksTable.crecheId, crecheId)
            ))
            .limit(1)
            .for("update");

          if (!task) {
            throw Object.assign(new Error("Tarefa não encontrada."), { statusCode: 404 });
          }

          if (task.status === "completed") {
            return {
              resultReference: { taskId, status: "completed", idempotent: true },
              summary: `Tarefa #${taskId} já estava marcada como concluída.`,
            };
          }

          const now = new Date();
          const notes = payload.notes || task.notes;

          await tx
            .update(tasksTable)
            .set({
              status: "completed",
              completedAt: now,
              completedBy: context.name,
              notes,
            })
            .where(eq(tasksTable.id, taskId));

          return {
            resultReference: { taskId, completedAt: now.toISOString(), completedBy: context.name, status: "completed" },
            summary: `Tarefa #${taskId} (${task.title}) marcada como concluída.`,
          };
        }

        case "record_medication_administration": {
          const taskId = actionRow.targetId;

          const [task] = await tx
            .select()
            .from(tasksTable)
            .where(and(
              eq(tasksTable.id, taskId),
              eq(tasksTable.crecheId, crecheId),
              eq(tasksTable.type, "medication")
            ))
            .limit(1)
            .for("update");

          if (!task) {
            throw Object.assign(new Error("Tarefa de medicação não encontrada."), { statusCode: 404 });
          }

          if (task.status === "completed") {
            return {
              resultReference: { taskId, status: "completed", idempotent: true },
              summary: `Administração da medicação #${taskId} já havia sido registrada.`,
            };
          }

          const now = new Date();
          const notes = payload.notes || task.notes;

          await tx
            .update(tasksTable)
            .set({
              status: "completed",
              completedAt: now,
              completedBy: context.name,
              notes,
            })
            .where(eq(tasksTable.id, taskId));

          // Also update medicationsTable lastAdministered if petId exists
          if (task.petId) {
            await tx
              .update(medicationsTable)
              .set({
                lastAdministered: now,
                administeredBy: context.name,
              })
              .where(and(
                eq(medicationsTable.petId, task.petId),
                eq(medicationsTable.crecheId, crecheId),
                eq(medicationsTable.isActive, true)
              ));
          }

          return {
            resultReference: { taskId, completedAt: now.toISOString(), completedBy: context.name, status: "completed" },
            summary: `Administração de ${task.title} para o pet registrada com sucesso.`,
          };
        }

        default:
          throw Object.assign(new Error(`Ação não suportada para execução: ${actionType}`), { statusCode: 400 });
      }
    });
  }
}
