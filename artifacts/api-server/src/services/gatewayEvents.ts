import { db } from "@workspace/db";
import { gatewayEventsTable, type GatewayEventStatus, type GatewayEvent } from "@workspace/db/schema";
import { eq, and, lte, sql } from "drizzle-orm";

export const GATEWAY_LEASE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_GATEWAY_RETRIES = 5;

export interface GatewayClaimResult {
  shouldProcess: boolean;
  status: GatewayEventStatus;
  reason?: string;
  isNew?: boolean;
  isReclaim?: boolean;
  isRetry?: boolean;
  eventRecord?: GatewayEvent;
}

/**
 * Sanitizes external gateway webhook event data to minimize sensitive storage
 * while preserving all identities needed for replay, deduplication, and debugging.
 */
export function sanitizeGatewayPayload(event: any): Record<string, unknown> {
  if (!event || typeof event !== "object") return {};
  const obj = event.data?.object;

  return {
    id: event.id,
    type: event.type,
    created: event.created,
    livemode: event.livemode,
    object: {
      id: obj?.id,
      object: obj?.object,
      customer: typeof obj?.customer === "string" ? obj.customer : obj?.customer?.id,
      subscription:
        typeof obj?.subscription === "string"
          ? obj.subscription
          : obj?.subscription?.id ?? (obj?.object === "subscription" ? obj.id : undefined),
      status: obj?.status,
      billing_reason: obj?.billing_reason,
      metadata: obj?.metadata ?? {},
    },
  };
}

/**
 * Atomically claims a gateway webhook event for processing.
 *
 * Invariants:
 * 1. New event: inserted directly as 'processing' with a 5-minute lease.
 * 2. Already 'processed' or 'ignored': terminal — never reprocessed.
 * 3. Already 'failed_final': terminal — never reprocessed.
 * 4. Active 'processing' lease (leaseExpiresAt > now): concurrent execution blocked.
 * 5. Expired 'processing' lease (leaseExpiresAt <= now): stale lease reclaimed.
 * 6. 'failed_retryable': reclaimed if retryCount < MAX_GATEWAY_RETRIES; else escalated to 'failed_final'.
 */
export async function claimGatewayEvent(
  event: any,
  gateway = "stripe",
  dbOrTx: any = db,
): Promise<GatewayClaimResult> {
  const eventId: string = event?.id;
  const eventType: string = event?.type ?? "unknown";
  if (!eventId) {
    return {
      shouldProcess: false,
      status: "ignored",
      reason: "missing_event_id",
    };
  }

  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + GATEWAY_LEASE_DURATION_MS);
  const eventCreated =
    typeof event.created === "number" ? new Date(event.created * 1000) : null;
  const sanitizedPayload = sanitizeGatewayPayload(event);

  // Check if the event already exists
  const [existing] = await dbOrTx
    .select()
    .from(gatewayEventsTable)
    .where(
      and(
        eq(gatewayEventsTable.gateway, gateway),
        eq(gatewayEventsTable.eventId, eventId),
      ),
    )
    .limit(1);

  if (!existing) {
    // Brand new event — claim lease immediately
    try {
      const [inserted] = await dbOrTx
        .insert(gatewayEventsTable)
        .values({
          gateway,
          eventId,
          eventType,
          eventCreated,
          status: "processing",
          retryCount: 0,
          receivedAt: now,
          processingStartedAt: now,
          leaseExpiresAt,
          payload: sanitizedPayload,
        })
        .returning();

      return {
        shouldProcess: true,
        status: "processing",
        isNew: true,
        eventRecord: inserted,
      };
    } catch (insertErr: any) {
      // In case of concurrent insert race on unique constraint, query the winner
      const [raced] = await dbOrTx
        .select()
        .from(gatewayEventsTable)
        .where(
          and(
            eq(gatewayEventsTable.gateway, gateway),
            eq(gatewayEventsTable.eventId, eventId),
          ),
        )
        .limit(1);

      if (!raced) throw insertErr;
      return evaluateExistingEvent(raced, now, leaseExpiresAt, gateway, eventId, dbOrTx);
    }
  }

  return evaluateExistingEvent(existing, now, leaseExpiresAt, gateway, eventId, dbOrTx);
}

async function evaluateExistingEvent(
  existing: GatewayEvent,
  now: Date,
  leaseExpiresAt: Date,
  gateway: string,
  eventId: string,
  dbOrTx: any,
): Promise<GatewayClaimResult> {
  const currentStatus = existing.status as GatewayEventStatus;

  // Terminal states: never reprocess
  if (currentStatus === "processed") {
    return {
      shouldProcess: false,
      status: "processed",
      reason: "already_processed",
      eventRecord: existing,
    };
  }

  if (currentStatus === "ignored") {
    return {
      shouldProcess: false,
      status: "ignored",
      reason: "event_ignored",
      eventRecord: existing,
    };
  }

  if (currentStatus === "failed_final") {
    return {
      shouldProcess: false,
      status: "failed_final",
      reason: "failed_final_terminal",
      eventRecord: existing,
    };
  }

  // Active in-flight processing with valid lease
  if (currentStatus === "processing") {
    if (existing.leaseExpiresAt && existing.leaseExpiresAt > now) {
      return {
        shouldProcess: false,
        status: "processing",
        reason: "in_flight",
        eventRecord: existing,
      };
    }

    // Stale processing lease — reclaim
    const [reclaimed] = await dbOrTx
      .update(gatewayEventsTable)
      .set({
        status: "processing",
        processingStartedAt: now,
        leaseExpiresAt,
        retryCount: sql`${gatewayEventsTable.retryCount} + 1`,
      })
      .where(
        and(
          eq(gatewayEventsTable.gateway, gateway),
          eq(gatewayEventsTable.eventId, eventId),
        ),
      )
      .returning();

    return {
      shouldProcess: true,
      status: "processing",
      isReclaim: true,
      eventRecord: reclaimed,
    };
  }

  // Retryable failure
  if (currentStatus === "failed_retryable") {
    if (existing.retryCount >= MAX_GATEWAY_RETRIES) {
      const [finalized] = await dbOrTx
        .update(gatewayEventsTable)
        .set({
          status: "failed_final",
          errorMessage: "Maximum gateway retries exceeded",
        })
        .where(
          and(
            eq(gatewayEventsTable.gateway, gateway),
            eq(gatewayEventsTable.eventId, eventId),
          ),
        )
        .returning();

      return {
        shouldProcess: false,
        status: "failed_final",
        reason: "max_retries_exceeded",
        eventRecord: finalized,
      };
    }

    // Allow retry with fresh lease
    const [retried] = await dbOrTx
      .update(gatewayEventsTable)
      .set({
        status: "processing",
        processingStartedAt: now,
        leaseExpiresAt,
        retryCount: sql`${gatewayEventsTable.retryCount} + 1`,
      })
      .where(
        and(
          eq(gatewayEventsTable.gateway, gateway),
          eq(gatewayEventsTable.eventId, eventId),
        ),
      )
      .returning();

    return {
      shouldProcess: true,
      status: "processing",
      isRetry: true,
      eventRecord: retried,
    };
  }

  // If received without active lease
  const [claimed] = await dbOrTx
    .update(gatewayEventsTable)
    .set({
      status: "processing",
      processingStartedAt: now,
      leaseExpiresAt,
    })
    .where(
      and(
        eq(gatewayEventsTable.gateway, gateway),
        eq(gatewayEventsTable.eventId, eventId),
      ),
    )
    .returning();

  return {
    shouldProcess: true,
    status: "processing",
    eventRecord: claimed,
  };
}

/**
 * Updates the final or failure state of a gateway event.
 */
export async function finalizeGatewayEvent(
  eventId: string,
  status: "processed" | "failed_retryable" | "failed_final" | "ignored",
  errorMessage?: string,
  gateway = "stripe",
  dbOrTx: any = db,
): Promise<GatewayEvent | null> {
  const now = new Date();
  const updates: Record<string, unknown> = {
    status,
  };

  if (status === "processed") {
    updates.processedAt = now;
    updates.errorMessage = null;
  } else if (errorMessage) {
    updates.errorMessage = errorMessage.slice(0, 1000);
  }

  const [updated] = await dbOrTx
    .update(gatewayEventsTable)
    .set(updates)
    .where(
      and(
        eq(gatewayEventsTable.gateway, gateway),
        eq(gatewayEventsTable.eventId, eventId),
      ),
    )
    .returning();

  return updated ?? null;
}

/**
 * Sweeper job to recover events stuck in 'processing' whose lease has expired.
 * Resets them to 'failed_retryable' so they can be reclaimed on next webhook delivery
 * or background recovery worker.
 */
export async function recoverStaleGatewayEvents(
  gateway = "stripe",
  dbOrTx: any = db,
): Promise<number> {
  const now = new Date();

  const recovered = await dbOrTx
    .update(gatewayEventsTable)
    .set({
      status: "failed_retryable",
      errorMessage: "Processing lease expired — recovered by background sweeper",
    })
    .where(
      and(
        eq(gatewayEventsTable.gateway, gateway),
        eq(gatewayEventsTable.status, "processing"),
        lte(gatewayEventsTable.leaseExpiresAt, now),
      ),
    )
    .returning();

  return recovered.length;
}
