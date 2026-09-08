import { db } from "@workspace/db";
import {
  platformServiceRequestsTable,
  crechesTable,
  type PlatformServiceRequest,
} from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { logCommercialAudit } from "./commercialAudit.js";
import { enqueueCommercialCommunication } from "./commercialOutbox.js";
import { getUncachableStripeClient } from "../lib/stripeClient.js";

export class PlatformServiceError extends Error {
  public code: string;
  public statusCode: number;

  constructor(code: string, message: string, statusCode: number = 422) {
    super(message);
    this.name = "PlatformServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface QuoteSnapshot {
  quotedPriceCents: number;
  scopeNotes?: string | null;
  adminNotes?: string | null;
  quotedBy: string;
  quotedAt: string;
}

export interface RequestAssistedImplementationParams {
  crecheId: number;
  userId: number;
  userEmail?: string;
  customerNotes?: string | null;
  dbClient?: any;
}

export async function requestAssistedImplementation(
  params: RequestAssistedImplementationParams,
): Promise<PlatformServiceRequest> {
  const dbClient = params.dbClient ?? db;

  if (!params.crecheId || Number.isNaN(params.crecheId)) {
    throw new PlatformServiceError("INVALID_CRECHE_ID", "Creche inválida.", 400);
  }

  const [creche] = await dbClient
    .select()
    .from(crechesTable)
    .where(eq(crechesTable.id, params.crecheId))
    .limit(1);

  if (!creche) {
    throw new PlatformServiceError("CRECHE_NOT_FOUND", "Creche não encontrada.", 404);
  }

  // Enforce single non-terminal request per creche
  const [existingActive] = await dbClient
    .select()
    .from(platformServiceRequestsTable)
    .where(
      and(
        eq(platformServiceRequestsTable.crecheId, params.crecheId),
        eq(platformServiceRequestsTable.serviceType, "ASSISTED_IMPLEMENTATION"),
        sql`${platformServiceRequestsTable.status} NOT IN ('completed', 'declined', 'cancelled')`,
      ),
    )
    .limit(1);

  if (existingActive) {
    throw new PlatformServiceError(
      "ACTIVE_REQUEST_EXISTS",
      "Já existe uma solicitação de implantação assistida em andamento para esta creche.",
      422,
    );
  }

  const [created] = await dbClient
    .insert(platformServiceRequestsTable)
    .values({
      crecheId: params.crecheId,
      serviceType: "ASSISTED_IMPLEMENTATION",
      status: "requested",
      requestedByUserId: params.userId,
      customerNotes: params.customerNotes?.trim() ?? null,
    })
    .returning();

  await logCommercialAudit({
    targetCrecheId: params.crecheId,
    actorType: "user",
    actorId: params.userId,
    actorRole: "creche_admin",
    actorEmail: params.userEmail,
    action: "platform_service_requested",
    reason: "Solicitação de Implantação Assistida pelo cliente",
    executionRequirement: "PAYMENT_REQUIRED",
    executionStatus: "pending",
    afterState: {
      serviceRequestId: created.id,
      status: "requested",
      customerNotes: created.customerNotes,
    },
  }, dbClient);

  await enqueueCommercialCommunication(
    {
      eventType: "IMPLEMENTATION_REQUEST_RECEIVED",
      eventOccurrenceKey: `implementation-request-${created.id}`,
      aggregateType: "platform_service_request",
      aggregateId: created.id,
      crecheId: params.crecheId,
      audienceRole: "master_admin",
      category: "PLATFORM_SERVICE",
      factsSnapshotJson: {
        serviceRequestId: created.id,
        crecheId: params.crecheId,
        customerNotes: created.customerNotes,
      },
      channels: ["in_app", "email", "push"],
    },
    dbClient,
  );

  return created;
}

export interface ReviewImplementationRequestParams {
  id: number;
  crecheId: number;
  adminId?: number;
  adminEmail: string;
  adminNotes?: string | null;
  reason?: string;
  dbClient?: any;
}

export async function reviewImplementationRequest(
  params: ReviewImplementationRequestParams,
): Promise<PlatformServiceRequest> {
  const dbClient = params.dbClient ?? db;

  const [existing] = await dbClient
    .select()
    .from(platformServiceRequestsTable)
    .where(
      and(
        eq(platformServiceRequestsTable.id, params.id),
        eq(platformServiceRequestsTable.crecheId, params.crecheId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new PlatformServiceError("REQUEST_NOT_FOUND", "Solicitação não encontrada.", 404);
  }

  if (existing.status !== "requested") {
    throw new PlatformServiceError(
      "INVALID_STATUS",
      `Apenas solicitações com status 'requested' podem entrar em análise (status atual: '${existing.status}').`,
      422,
    );
  }

  const [updated] = await dbClient
    .update(platformServiceRequestsTable)
    .set({
      status: "under_review",
      adminNotes: params.adminNotes !== undefined ? (params.adminNotes?.trim() ?? null) : existing.adminNotes,
      updatedAt: new Date(),
    })
    .where(eq(platformServiceRequestsTable.id, params.id))
    .returning();

  await logCommercialAudit({
    targetCrecheId: params.crecheId,
    actorType: "user",
    actorId: params.adminId,
    actorRole: "master_admin",
    actorEmail: params.adminEmail,
    action: "platform_service_under_review",
    reason: params.reason ? params.reason.trim() : `Solicitação de implantação #${params.id} colocada em análise`,
    afterState: {
      status: "under_review",
      adminNotes: updated.adminNotes,
    },
  }, dbClient);

  return updated;
}

export interface SendImplementationQuoteParams {
  id: number;
  crecheId: number;
  quotedPriceCents: number;
  scopeNotes?: string | null;
  adminNotes?: string | null;
  adminId?: number;
  adminEmail: string;
  reason: string;
  dbClient?: any;
}

export async function sendImplementationQuote(
  params: SendImplementationQuoteParams,
): Promise<PlatformServiceRequest> {
  const dbClient = params.dbClient ?? db;

  if (!params.reason || typeof params.reason !== "string" || params.reason.trim().length === 0) {
    throw new PlatformServiceError(
      "REASON_REQUIRED",
      "Justificativa obrigatória para envio de orçamento de implantação.",
      400,
    );
  }

  if (typeof params.quotedPriceCents !== "number" || params.quotedPriceCents < 0 || !Number.isInteger(params.quotedPriceCents)) {
    throw new PlatformServiceError(
      "INVALID_PRICE",
      "Preço orçado deve ser um valor inteiro em centavos maior ou igual a zero.",
      400,
    );
  }

  const [existing] = await dbClient
    .select()
    .from(platformServiceRequestsTable)
    .where(
      and(
        eq(platformServiceRequestsTable.id, params.id),
        eq(platformServiceRequestsTable.crecheId, params.crecheId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new PlatformServiceError("REQUEST_NOT_FOUND", "Solicitação não encontrada.", 404);
  }

  if (existing.status !== "requested" && existing.status !== "under_review") {
    throw new PlatformServiceError(
      "INVALID_STATUS",
      `Orçamento só pode ser enviado para solicitações em 'requested' ou 'under_review' (status atual: '${existing.status}').`,
      422,
    );
  }

  const quoteSnapshot: QuoteSnapshot = {
    quotedPriceCents: params.quotedPriceCents,
    scopeNotes: params.scopeNotes?.trim() ?? null,
    adminNotes: params.adminNotes?.trim() ?? null,
    quotedBy: params.adminEmail,
    quotedAt: new Date().toISOString(),
  };

  const [updated] = await dbClient
    .update(platformServiceRequestsTable)
    .set({
      status: "proposal_sent",
      quotedPriceCents: params.quotedPriceCents,
      quoteSnapshotJson: quoteSnapshot,
      scopeNotes: params.scopeNotes?.trim() ?? null,
      adminNotes: params.adminNotes?.trim() ?? null,
      quotedBy: params.adminEmail,
      quotedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(platformServiceRequestsTable.id, params.id),
        sql`${platformServiceRequestsTable.status} IN ('requested', 'under_review')`,
      ),
    )
    .returning();

  if (!updated) {
    throw new PlatformServiceError(
      "REQUEST_STATE_CONFLICT",
      "Conflito de estado: a solicitação foi alterada concorrentemente.",
      409,
    );
  }

  await logCommercialAudit({
    targetCrecheId: params.crecheId,
    actorType: "user",
    actorId: params.adminId,
    actorRole: "master_admin",
    actorEmail: params.adminEmail,
    action: "platform_service_quote_sent",
    reason: params.reason.trim(),
    afterState: {
      status: "proposal_sent",
      quotedPriceCents: params.quotedPriceCents,
      scopeNotes: updated.scopeNotes,
    },
  }, dbClient);

  await enqueueCommercialCommunication(
    {
      eventType: "IMPLEMENTATION_QUOTE_SENT",
      eventOccurrenceKey: `implementation-quote-${updated.id}`,
      aggregateType: "platform_service_request",
      aggregateId: updated.id,
      crecheId: params.crecheId,
      audienceRole: "creche_admin",
      category: "PLATFORM_SERVICE",
      factsSnapshotJson: {
        serviceRequestId: updated.id,
        crecheId: params.crecheId,
        quotedPriceCents: params.quotedPriceCents,
        scopeNotes: updated.scopeNotes,
      },
      channels: ["in_app", "email", "push"],
    },
    dbClient,
  );

  return updated;
}

export interface AcceptImplementationQuoteParams {
  id: number;
  crecheId: number;
  userId: number;
  userEmail?: string;
  dbClient?: any;
}

export async function acceptImplementationQuote(
  params: AcceptImplementationQuoteParams,
): Promise<PlatformServiceRequest> {
  const dbClient = params.dbClient ?? db;

  const [existing] = await dbClient
    .select()
    .from(platformServiceRequestsTable)
    .where(
      and(
        eq(platformServiceRequestsTable.id, params.id),
        eq(platformServiceRequestsTable.crecheId, params.crecheId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new PlatformServiceError("REQUEST_NOT_FOUND", "Solicitação não encontrada.", 404);
  }

  if (existing.status === "accepted" || existing.status === "payment_pending") {
    return existing;
  }

  if (existing.status !== "proposal_sent") {
    throw new PlatformServiceError(
      "REQUEST_STATE_CONFLICT",
      `Orçamento não está disponível para aceite (status atual: '${existing.status}').`,
      409,
    );
  }

  const frozenSnapshot = (existing.quoteSnapshotJson as any) ?? {};
  const priceCents = frozenSnapshot.quotedPriceCents ?? existing.quotedPriceCents ?? 0;

  // Free -> accepted (NOT scheduled yet). Paid -> payment_pending
  const nextStatus = priceCents === 0 ? "accepted" : "payment_pending";
  const now = new Date();

  const [updated] = await dbClient
    .update(platformServiceRequestsTable)
    .set({
      status: nextStatus,
      acceptedAt: now,
      acceptedByUserId: params.userId,
      updatedAt: now,
    })
    .where(
      and(
        eq(platformServiceRequestsTable.id, params.id),
        eq(platformServiceRequestsTable.status, "proposal_sent"),
      ),
    )
    .returning();

  if (!updated) {
    throw new PlatformServiceError(
      "REQUEST_STATE_CONFLICT",
      "Conflito de estado: o orçamento foi alterado ou aceito concorrentemente.",
      409,
    );
  }

  await logCommercialAudit({
    targetCrecheId: params.crecheId,
    actorType: "user",
    actorId: params.userId,
    actorRole: "creche_admin",
    actorEmail: params.userEmail,
    action: "platform_service_quote_accepted",
    reason: `Aceite do orçamento de implantação assistida #${params.id}`,
    afterState: {
      status: nextStatus,
      acceptedAt: now.toISOString(),
      acceptedByUserId: params.userId,
      priceCents,
    },
  }, dbClient);

  await enqueueCommercialCommunication(
    {
      eventType: "IMPLEMENTATION_QUOTE_ACCEPTED",
      eventOccurrenceKey: `implementation-quote-accepted-${updated.id}`,
      aggregateType: "platform_service_request",
      aggregateId: updated.id,
      crecheId: params.crecheId,
      audienceRole: "master_admin",
      category: "PLATFORM_SERVICE",
      factsSnapshotJson: {
        serviceRequestId: updated.id,
        crecheId: params.crecheId,
        quotedPriceCents: updated.quotedPriceCents,
      },
      channels: ["in_app", "email", "push"],
    },
    dbClient,
  );

  return updated;
}

export interface CreateCheckoutSessionParams {
  id: number;
  crecheId: number;
  userId: number;
  successUrl: string;
  cancelUrl: string;
  idempotencyAttemptKey?: string;
  stripeClient?: any;
  dbClient?: any;
}

export async function createImplementationCheckoutSession(
  params: CreateCheckoutSessionParams,
): Promise<{ checkoutUrl: string | null; sessionId: string; status: string }> {
  const dbClient = params.dbClient ?? db;
  const stripe = params.stripeClient ?? (await getUncachableStripeClient());

  const [existing] = await dbClient
    .select()
    .from(platformServiceRequestsTable)
    .where(
      and(
        eq(platformServiceRequestsTable.id, params.id),
        eq(platformServiceRequestsTable.crecheId, params.crecheId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new PlatformServiceError("REQUEST_NOT_FOUND", "Solicitação não encontrada.", 404);
  }

  if (existing.status === "paid") {
    return { checkoutUrl: null, sessionId: existing.stripeCheckoutSessionId ?? "", status: "paid" };
  }

  if (existing.status !== "payment_pending") {
    throw new PlatformServiceError(
      "INVALID_STATUS",
      `Pagamento só pode ser iniciado para solicitações com status 'payment_pending' (status atual: '${existing.status}').`,
      422,
    );
  }

  const frozenSnapshot = (existing.quoteSnapshotJson as any) ?? {};
  const priceCents = frozenSnapshot.quotedPriceCents ?? existing.quotedPriceCents ?? 0;

  if (priceCents <= 0) {
    throw new PlatformServiceError(
      "INVALID_PRICE",
      "Esta proposta é gratuita e não requer pagamento.",
      422,
    );
  }

  // Reconcile existing session if present
  if (existing.stripeCheckoutSessionId) {
    try {
      const currentSession = await stripe.checkout.sessions.retrieve(existing.stripeCheckoutSessionId);
      if (currentSession.status === "open") {
        return {
          checkoutUrl: currentSession.url,
          sessionId: currentSession.id,
          status: "open",
        };
      }
      if (currentSession.payment_status === "paid") {
        await handlePlatformServicePaymentWebhook(currentSession, dbClient);
        return { checkoutUrl: null, sessionId: currentSession.id, status: "paid" };
      }
      // If expired, fall through to create a new session
    } catch (retrieveErr) {
      console.warn("[platformServices] Failed to retrieve existing checkout session:", retrieveErr);
    }
  }

  const stripeIdempotencyKey = `checkout-impl-${existing.id}-${params.idempotencyAttemptKey ?? "default"}`;

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "brl",
            unit_amount: priceCents,
            product_data: {
              name: "ArkPet — Implantação Assistida",
              description: existing.scopeNotes ?? "Serviço de implantação assistida da plataforma ArkPet",
            },
          },
          quantity: 1,
        },
      ],
      client_reference_id: String(existing.id),
      metadata: {
        serviceRequestId: String(existing.id),
        crecheId: String(existing.crecheId),
        serviceType: "ASSISTED_IMPLEMENTATION",
        environment: process.env.NODE_ENV || "development",
      },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    },
    { idempotencyKey: stripeIdempotencyKey },
  );

  await dbClient
    .update(platformServiceRequestsTable)
    .set({
      stripeCheckoutSessionId: session.id,
      updatedAt: new Date(),
    })
    .where(eq(platformServiceRequestsTable.id, existing.id));

  return {
    checkoutUrl: session.url,
    sessionId: session.id,
    status: session.status ?? "open",
  };
}

export async function handlePlatformServicePaymentWebhook(
  session: any,
  dbClient?: any,
): Promise<void> {
  const client = dbClient ?? db;

  if (session.mode !== "payment") {
    throw new PlatformServiceError("INVALID_MODE", "Modo do evento Stripe inválido para serviço da plataforma.", 400);
  }

  if (session.payment_status !== "paid") {
    console.log(`[platformServices] Checkout session ${session.id} not paid yet (status: ${session.payment_status}).`);
    return;
  }

  const serviceRequestId = Number(session.client_reference_id || session.metadata?.serviceRequestId);
  if (!serviceRequestId || Number.isNaN(serviceRequestId)) {
    throw new PlatformServiceError("MISSING_SERVICE_REQUEST_ID", "ID de solicitação de serviço ausente no evento.", 400);
  }

  if (session.client_reference_id && Number(session.client_reference_id) !== serviceRequestId) {
    throw new PlatformServiceError("SERVICE_REQUEST_ID_MISMATCH", "client_reference_id diverge do ID da solicitação.", 422);
  }
  if (session.metadata?.serviceRequestId && Number(session.metadata.serviceRequestId) !== serviceRequestId) {
    throw new PlatformServiceError("SERVICE_REQUEST_ID_MISMATCH", "metadata.serviceRequestId diverge do ID da solicitação.", 422);
  }

  const [request] = await client
    .select()
    .from(platformServiceRequestsTable)
    .where(eq(platformServiceRequestsTable.id, serviceRequestId))
    .limit(1);

  if (!request) {
    throw new PlatformServiceError("REQUEST_NOT_FOUND", `Solicitação de serviço #${serviceRequestId} não encontrada.`, 404);
  }

  // Validate tenant
  if (session.metadata?.crecheId && String(request.crecheId) !== String(session.metadata.crecheId)) {
    throw new PlatformServiceError("TENANT_MISMATCH", "Metadados de creche divergem da solicitação.", 403);
  }

  // Validate serviceType
  if (session.metadata?.serviceType !== "ASSISTED_IMPLEMENTATION") {
    throw new PlatformServiceError("SERVICE_TYPE_MISMATCH", "Tipo de serviço diverge da solicitação.", 422);
  }

  // Validate environment if present
  const expectedEnv = process.env.NODE_ENV || "development";
  if (session.metadata?.environment && session.metadata.environment !== expectedEnv) {
    throw new PlatformServiceError("ENVIRONMENT_MISMATCH", "Ambiente da sessão Stripe diverge do ambiente do servidor.", 422);
  }

  // Validate stored session ID (fail-closed if unknown or stale)
  if (!request.stripeCheckoutSessionId || request.stripeCheckoutSessionId !== session.id) {
    throw new PlatformServiceError("SESSION_ID_MISMATCH", "Sessão Stripe desconhecida ou desatualizada para esta solicitação.", 422);
  }

  // Validate amount & currency against frozen quote
  const frozenSnapshot = (request.quoteSnapshotJson as any) ?? {};
  const expectedAmount = frozenSnapshot.quotedPriceCents ?? request.quotedPriceCents ?? 0;

  if (session.amount_total !== expectedAmount) {
    throw new PlatformServiceError(
      "AMOUNT_MISMATCH",
      `Valor pago (${session.amount_total}) diverge do valor orçado (${expectedAmount}).`,
      422,
    );
  }

  if (session.currency?.toLowerCase() !== "brl") {
    throw new PlatformServiceError(
      "CURRENCY_MISMATCH",
      `Moeda paga (${session.currency}) diverge da moeda esperada (brl).`,
      422,
    );
  }

  // Idempotency: if already paid or in later active state, return cleanly
  if (request.status === "paid" || request.status === "scheduled" || request.status === "in_progress" || request.status === "completed") {
    return;
  }

  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  const now = new Date();

  const [updated] = await client
    .update(platformServiceRequestsTable)
    .set({
      status: "paid",
      paidAt: now,
      stripePaymentIntentId: paymentIntentId,
      amountPaidCents: session.amount_total,
      updatedAt: now,
    })
    .where(
      and(
        eq(platformServiceRequestsTable.id, request.id),
        eq(platformServiceRequestsTable.status, "payment_pending"),
      ),
    )
    .returning();

  if (updated) {
    await logCommercialAudit({
      targetCrecheId: request.crecheId,
      actorType: "gateway",
      action: "platform_service_payment_confirmed",
      reason: "Confirmação de pagamento via webhook Stripe Checkout",
      executionRequirement: "PAYMENT_REQUIRED",
      executionStatus: "success",
      afterState: {
        serviceRequestId: request.id,
        status: "paid",
        paidAt: now.toISOString(),
        stripePaymentIntentId: paymentIntentId,
        amountPaidCents: session.amount_total,
      },
    }, client);

    await enqueueCommercialCommunication(
      {
        eventType: "IMPLEMENTATION_PAYMENT_CONFIRMED",
        eventOccurrenceKey: `implementation-payment-confirmed-${updated.id}-creche`,
        aggregateType: "platform_service_request",
        aggregateId: updated.id,
        crecheId: updated.crecheId,
        audienceRole: "creche_admin",
        category: "PLATFORM_SERVICE",
        factsSnapshotJson: {
          serviceRequestId: updated.id,
          crecheId: updated.crecheId,
          amountPaidCents: updated.amountPaidCents,
        },
        channels: ["in_app", "email", "push"],
      },
      client,
    );

    await enqueueCommercialCommunication(
      {
        eventType: "IMPLEMENTATION_PAYMENT_CONFIRMED",
        eventOccurrenceKey: `implementation-payment-confirmed-${updated.id}-master`,
        aggregateType: "platform_service_request",
        aggregateId: updated.id,
        crecheId: updated.crecheId,
        audienceRole: "master_admin",
        category: "PLATFORM_SERVICE",
        factsSnapshotJson: {
          serviceRequestId: updated.id,
          crecheId: updated.crecheId,
          amountPaidCents: updated.amountPaidCents,
        },
        channels: ["in_app", "email", "push"],
      },
      client,
    );
  } else {
    // CAS did not match payment_pending: check if row was cancelled concurrently
    const [concurrent] = await client
      .select()
      .from(platformServiceRequestsTable)
      .where(eq(platformServiceRequestsTable.id, request.id))
      .limit(1);

    if (concurrent && concurrent.status === "cancelled") {
      // Invariant: paid money can never end as plain cancelled without REFUND_REVIEW_REQUIRED
      await client
        .update(platformServiceRequestsTable)
        .set({
          refundStatus: "REFUND_REVIEW_REQUIRED",
          stripePaymentIntentId: paymentIntentId,
          amountPaidCents: session.amount_total,
          paidAt: concurrent.paidAt ?? now,
          updatedAt: now,
        })
        .where(eq(platformServiceRequestsTable.id, request.id));

      await logCommercialAudit({
        targetCrecheId: request.crecheId,
        actorType: "gateway",
        action: "platform_service_payment_confirmed_after_cancellation",
        reason: "Pagamento confirmado após cancelamento da solicitação; marcado para revisão de reembolso.",
        executionRequirement: "PAYMENT_REQUIRED",
        executionStatus: "warning",
        afterState: {
          serviceRequestId: request.id,
          status: "cancelled",
          refundStatus: "REFUND_REVIEW_REQUIRED",
          stripePaymentIntentId: paymentIntentId,
          amountPaidCents: session.amount_total,
        },
      }, client);

      await enqueueCommercialCommunication(
        {
          eventType: "IMPLEMENTATION_REFUND_REVIEW",
          eventOccurrenceKey: `implementation-refund-review-${request.id}-webhook`,
          aggregateType: "platform_service_request",
          aggregateId: request.id,
          crecheId: request.crecheId,
          audienceRole: "master_admin",
          category: "PLATFORM_SERVICE",
          factsSnapshotJson: {
            serviceRequestId: request.id,
            crecheId: request.crecheId,
            amountPaidCents: session.amount_total,
            reason: "Pagamento recebido após cancelamento da solicitação de serviço",
          },
          channels: ["in_app", "email", "push"],
        },
        client,
      );
    }
  }
}

export interface ScheduleImplementationParams {
  id: number;
  crecheId: number;
  scheduledFor: Date;
  adminNotes?: string | null;
  adminId?: number;
  adminEmail: string;
  reason: string;
  dbClient?: any;
}

export async function scheduleImplementation(
  params: ScheduleImplementationParams,
): Promise<PlatformServiceRequest> {
  const dbClient = params.dbClient ?? db;

  if (!params.reason || typeof params.reason !== "string" || params.reason.trim().length === 0) {
    throw new PlatformServiceError("REASON_REQUIRED", "Justificativa obrigatória para agendamento.", 400);
  }

  const [existing] = await dbClient
    .select()
    .from(platformServiceRequestsTable)
    .where(
      and(
        eq(platformServiceRequestsTable.id, params.id),
        eq(platformServiceRequestsTable.crecheId, params.crecheId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new PlatformServiceError("REQUEST_NOT_FOUND", "Solicitação não encontrada.", 404);
  }

  // Free offers are in 'accepted'; paid offers are in 'paid'
  if (existing.status !== "accepted" && existing.status !== "paid" && existing.status !== "scheduled") {
    throw new PlatformServiceError(
      "INVALID_STATUS",
      `Agendamento só pode ser definido para serviços aceitos ou pagos (status atual: '${existing.status}').`,
      422,
    );
  }

  const [updated] = await dbClient
    .update(platformServiceRequestsTable)
    .set({
      status: "scheduled",
      scheduledFor: params.scheduledFor,
      adminNotes: params.adminNotes !== undefined ? (params.adminNotes?.trim() ?? null) : existing.adminNotes,
      updatedAt: new Date(),
    })
    .where(eq(platformServiceRequestsTable.id, params.id))
    .returning();

  await logCommercialAudit({
    targetCrecheId: params.crecheId,
    actorType: "user",
    actorId: params.adminId,
    actorRole: "master_admin",
    actorEmail: params.adminEmail,
    action: "platform_service_scheduled",
    reason: params.reason.trim(),
    afterState: {
      status: "scheduled",
      scheduledFor: params.scheduledFor.toISOString(),
      adminNotes: updated.adminNotes,
    },
  }, dbClient);

  await enqueueCommercialCommunication(
    {
      eventType: "IMPLEMENTATION_SCHEDULED",
      eventOccurrenceKey: `implementation-scheduled-${updated.id}`,
      aggregateType: "platform_service_request",
      aggregateId: updated.id,
      crecheId: updated.crecheId,
      audienceRole: "creche_admin",
      category: "PLATFORM_SERVICE",
      factsSnapshotJson: {
        serviceRequestId: updated.id,
        crecheId: updated.crecheId,
        scheduledFor: params.scheduledFor.toISOString(),
      },
      channels: ["in_app", "email", "push"],
    },
    dbClient,
  );

  return updated;
}

export interface StartImplementationParams {
  id: number;
  crecheId: number;
  adminId?: number;
  adminEmail: string;
  reason: string;
  dbClient?: any;
}

export async function startImplementation(
  params: StartImplementationParams,
): Promise<PlatformServiceRequest> {
  const dbClient = params.dbClient ?? db;

  if (!params.reason || typeof params.reason !== "string" || params.reason.trim().length === 0) {
    throw new PlatformServiceError("REASON_REQUIRED", "Justificativa obrigatória para iniciar implantação.", 400);
  }

  const [existing] = await dbClient
    .select()
    .from(platformServiceRequestsTable)
    .where(
      and(
        eq(platformServiceRequestsTable.id, params.id),
        eq(platformServiceRequestsTable.crecheId, params.crecheId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new PlatformServiceError("REQUEST_NOT_FOUND", "Solicitação não encontrada.", 404);
  }

  if (existing.status !== "scheduled") {
    throw new PlatformServiceError(
      "INVALID_STATUS",
      `Apenas solicitações agendadas podem ser iniciadas (status atual: '${existing.status}').`,
      422,
    );
  }

  const now = new Date();
  const [updated] = await dbClient
    .update(platformServiceRequestsTable)
    .set({
      status: "in_progress",
      startedAt: now,
      updatedAt: now,
    })
    .where(eq(platformServiceRequestsTable.id, params.id))
    .returning();

  await logCommercialAudit({
    targetCrecheId: params.crecheId,
    actorType: "user",
    actorId: params.adminId,
    actorRole: "master_admin",
    actorEmail: params.adminEmail,
    action: "platform_service_started",
    reason: params.reason.trim(),
    afterState: {
      status: "in_progress",
      startedAt: now.toISOString(),
    },
  }, dbClient);

  await enqueueCommercialCommunication(
    {
      eventType: "IMPLEMENTATION_STARTED",
      eventOccurrenceKey: `implementation-started-${updated.id}`,
      aggregateType: "platform_service_request",
      aggregateId: updated.id,
      crecheId: updated.crecheId,
      audienceRole: "creche_admin",
      category: "PLATFORM_SERVICE",
      factsSnapshotJson: {
        serviceRequestId: updated.id,
        crecheId: updated.crecheId,
      },
      channels: ["in_app", "email", "push"],
    },
    dbClient,
  );

  return updated;
}

export interface CompleteImplementationParams {
  id: number;
  crecheId: number;
  completionNotes: string;
  adminId?: number;
  adminEmail: string;
  reason: string;
  dbClient?: any;
}

export async function completeImplementation(
  params: CompleteImplementationParams,
): Promise<PlatformServiceRequest> {
  const dbClient = params.dbClient ?? db;

  if (!params.reason || typeof params.reason !== "string" || params.reason.trim().length === 0) {
    throw new PlatformServiceError("REASON_REQUIRED", "Justificativa obrigatória para conclusão de implantação.", 400);
  }
  if (!params.completionNotes || typeof params.completionNotes !== "string" || params.completionNotes.trim().length === 0) {
    throw new PlatformServiceError("COMPLETION_NOTES_REQUIRED", "Notas de conclusão são obrigatórias.", 400);
  }

  const [existing] = await dbClient
    .select()
    .from(platformServiceRequestsTable)
    .where(
      and(
        eq(platformServiceRequestsTable.id, params.id),
        eq(platformServiceRequestsTable.crecheId, params.crecheId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new PlatformServiceError("REQUEST_NOT_FOUND", "Solicitação não encontrada.", 404);
  }

  if (existing.status !== "in_progress") {
    throw new PlatformServiceError(
      "INVALID_STATUS",
      `Apenas solicitações em andamento podem ser concluídas (status atual: '${existing.status}').`,
      422,
    );
  }

  const now = new Date();
  const [updated] = await dbClient
    .update(platformServiceRequestsTable)
    .set({
      status: "completed",
      completedAt: now,
      completedBy: params.adminEmail,
      completionNotes: params.completionNotes.trim(),
      updatedAt: now,
    })
    .where(eq(platformServiceRequestsTable.id, params.id))
    .returning();

  await logCommercialAudit({
    targetCrecheId: params.crecheId,
    actorType: "user",
    actorId: params.adminId,
    actorRole: "master_admin",
    actorEmail: params.adminEmail,
    action: "platform_service_completed",
    reason: params.reason.trim(),
    afterState: {
      status: "completed",
      completedAt: now.toISOString(),
      completedBy: params.adminEmail,
      completionNotes: updated.completionNotes,
    },
  }, dbClient);

  await enqueueCommercialCommunication(
    {
      eventType: "IMPLEMENTATION_COMPLETED",
      eventOccurrenceKey: `implementation-completed-${updated.id}`,
      aggregateType: "platform_service_request",
      aggregateId: updated.id,
      crecheId: updated.crecheId,
      audienceRole: "creche_admin",
      category: "PLATFORM_SERVICE",
      factsSnapshotJson: {
        serviceRequestId: updated.id,
        crecheId: updated.crecheId,
      },
      channels: ["in_app", "email", "push"],
    },
    dbClient,
  );

  return updated;
}

export interface CancelImplementationParams {
  id: number;
  crecheId: number;
  actorRole: "master_admin" | "creche_admin";
  actorId?: number;
  actorEmail?: string;
  reason: string;
  stripeClient?: any;
  dbClient?: any;
}

export async function cancelImplementation(
  params: CancelImplementationParams,
): Promise<PlatformServiceRequest> {
  const dbClient = params.dbClient ?? db;

  if (!params.reason || typeof params.reason !== "string" || params.reason.trim().length === 0) {
    throw new PlatformServiceError("REASON_REQUIRED", "Justificativa obrigatória para cancelamento.", 400);
  }

  const [existing] = await dbClient
    .select()
    .from(platformServiceRequestsTable)
    .where(
      and(
        eq(platformServiceRequestsTable.id, params.id),
        eq(platformServiceRequestsTable.crecheId, params.crecheId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new PlatformServiceError("REQUEST_NOT_FOUND", "Solicitação não encontrada.", 404);
  }

  if (existing.status === "completed" || existing.status === "cancelled" || existing.status === "declined") {
    throw new PlatformServiceError(
      "INVALID_STATUS",
      `Solicitação já está em estado terminal ('${existing.status}') e não pode ser cancelada.`,
      422,
    );
  }

  // Customer boundary check (Correction 21)
  if (params.actorRole === "creche_admin") {
    const customerCancellable = ["requested", "under_review", "proposal_sent", "accepted", "payment_pending"];
    if (!customerCancellable.includes(existing.status)) {
      throw new PlatformServiceError(
        "CUSTOMER_CANCELLATION_NOT_ALLOWED",
        "Serviços pagos, agendados ou em andamento só podem ser cancelados através do suporte da plataforma com análise de reembolso.",
        403,
      );
    }
  }

  let refundStatus: string | null = null;

  // If in payment_pending with checkout session, expire it or check if paid concurrently (Correction 20)
  if (existing.status === "payment_pending" && existing.stripeCheckoutSessionId) {
    try {
      const stripe = params.stripeClient ?? (await getUncachableStripeClient());
      const session = await stripe.checkout.sessions.retrieve(existing.stripeCheckoutSessionId);
      if (session.payment_status === "paid") {
        refundStatus = "REFUND_REVIEW_REQUIRED";
      } else if (session.status === "open") {
        await stripe.checkout.sessions.expire(existing.stripeCheckoutSessionId);
      }
    } catch (sessionErr) {
      console.warn("[platformServices] Error expiring checkout session on cancellation:", sessionErr);
    }
  }

  // If already paid, scheduled, or in_progress, requires refund review
  if (existing.status === "paid" || existing.status === "scheduled" || existing.status === "in_progress") {
    refundStatus = "REFUND_REVIEW_REQUIRED";
  }

  const now = new Date();
  let finalUpdated: PlatformServiceRequest;

  // CAS concurrency protection (R36.G1 Section 8 & 9)
  const [updated] = await dbClient
    .update(platformServiceRequestsTable)
    .set({
      status: "cancelled",
      cancelledAt: now,
      cancelledBy: params.actorEmail ?? `user_${params.actorId}`,
      cancellationReason: params.reason.trim(),
      refundStatus: refundStatus ?? existing.refundStatus,
      updatedAt: now,
    })
    .where(
      and(
        eq(platformServiceRequestsTable.id, existing.id),
        eq(platformServiceRequestsTable.status, existing.status),
      ),
    )
    .returning();

  if (updated) {
    finalUpdated = updated;
  } else {
    // CAS failed: concurrent transaction altered state (e.g. payment webhook won the race)
    const [concurrent] = await dbClient
      .select()
      .from(platformServiceRequestsTable)
      .where(eq(platformServiceRequestsTable.id, existing.id))
      .limit(1);

    if (!concurrent) {
      throw new PlatformServiceError("REQUEST_NOT_FOUND", "Solicitação não encontrada.", 404);
    }

    if (concurrent.status === "cancelled" || concurrent.status === "completed" || concurrent.status === "declined") {
      throw new PlatformServiceError(
        "INVALID_STATUS",
        `Solicitação já está em estado terminal ('${concurrent.status}').`,
        422,
      );
    }

    if (concurrent.status === "paid" || concurrent.status === "scheduled" || concurrent.status === "in_progress") {
      if (params.actorRole === "creche_admin") {
        throw new PlatformServiceError(
          "CUSTOMER_CANCELLATION_NOT_ALLOWED",
          "O pagamento foi confirmado concorrentemente. Serviços pagos só podem ser cancelados através do suporte da plataforma com análise de reembolso.",
          403,
        );
      }

      refundStatus = "REFUND_REVIEW_REQUIRED";
      const [reCancelled] = await dbClient
        .update(platformServiceRequestsTable)
        .set({
          status: "cancelled",
          cancelledAt: now,
          cancelledBy: params.actorEmail ?? `user_${params.actorId}`,
          cancellationReason: params.reason.trim(),
          refundStatus: "REFUND_REVIEW_REQUIRED",
          updatedAt: now,
        })
        .where(
          and(
            eq(platformServiceRequestsTable.id, concurrent.id),
            eq(platformServiceRequestsTable.status, concurrent.status),
          ),
        )
        .returning();

      finalUpdated = reCancelled ?? concurrent;
    } else {
      const [reCancelled] = await dbClient
        .update(platformServiceRequestsTable)
        .set({
          status: "cancelled",
          cancelledAt: now,
          cancelledBy: params.actorEmail ?? `user_${params.actorId}`,
          cancellationReason: params.reason.trim(),
          refundStatus: refundStatus ?? concurrent.refundStatus,
          updatedAt: now,
        })
        .where(
          and(
            eq(platformServiceRequestsTable.id, concurrent.id),
            eq(platformServiceRequestsTable.status, concurrent.status),
          ),
        )
        .returning();

      finalUpdated = reCancelled ?? concurrent;
    }
  }

  await logCommercialAudit({
    targetCrecheId: params.crecheId,
    actorType: "user",
    actorId: params.actorId,
    actorRole: params.actorRole,
    actorEmail: params.actorEmail,
    action: "platform_service_cancelled",
    reason: params.reason.trim(),
    afterState: {
      status: "cancelled",
      cancelledAt: now.toISOString(),
      cancelledBy: params.actorEmail,
      refundStatus: finalUpdated.refundStatus,
    },
  }, dbClient);

  await enqueueCommercialCommunication(
    {
      eventType: "IMPLEMENTATION_CANCELLED",
      eventOccurrenceKey: `implementation-cancelled-${finalUpdated.id}`,
      aggregateType: "platform_service_request",
      aggregateId: finalUpdated.id,
      crecheId: finalUpdated.crecheId,
      audienceRole: "creche_admin",
      category: "PLATFORM_SERVICE",
      factsSnapshotJson: {
        serviceRequestId: finalUpdated.id,
        crecheId: finalUpdated.crecheId,
        reason: params.reason.trim(),
      },
      channels: ["in_app", "email", "push"],
    },
    dbClient,
  );

  if (finalUpdated.refundStatus === "REFUND_REVIEW_REQUIRED") {
    await enqueueCommercialCommunication(
      {
        eventType: "IMPLEMENTATION_REFUND_REVIEW",
        eventOccurrenceKey: `implementation-refund-review-${finalUpdated.id}-cancel`,
        aggregateType: "platform_service_request",
        aggregateId: finalUpdated.id,
        crecheId: finalUpdated.crecheId,
        audienceRole: "master_admin",
        category: "PLATFORM_SERVICE",
        factsSnapshotJson: {
          serviceRequestId: finalUpdated.id,
          crecheId: finalUpdated.crecheId,
          amountPaidCents: finalUpdated.amountPaidCents,
          reason: params.reason.trim(),
        },
        channels: ["in_app", "email", "push"],
      },
      dbClient,
    );
  }

  return finalUpdated;
}
