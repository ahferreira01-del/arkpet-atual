/**
 * OutboxRepository — Phase 15B.
 *
 * Inserts and processes events in the financial_outbox table.
 * Inserts MUST be called with the active transaction (tx) so the event is
 * committed atomically with the main DB write.
 */

import { db, financialOutboxTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { c } from "./shared.js";
import type { FinancialDomainEvent } from "../services/events.js";

export class OutboxRepository {
  /**
   * Inserts a domain event into the outbox (must be called inside a tx).
   */
  static async insert(event: FinancialDomainEvent, tx: any): Promise<void> {
    await c(tx).insert(financialOutboxTable).values({
      eventType: event.type,
      payload: event as any,
    });
  }

  /**
   * Fetches up to `limit` pending events for the worker to process.
   */
  static async fetchPending(limit: number) {
    return db
      .select()
      .from(financialOutboxTable)
      .where(eq(financialOutboxTable.status, "pending"))
      .limit(limit);
  }

  /**
   * Marks an event as successfully processed.
   */
  static async markProcessed(id: number, tx?: any): Promise<void> {
    await c(tx)
      .update(financialOutboxTable)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(financialOutboxTable.id, id));
  }

  /**
   * Marks an event as failed and increments the retry counter.
   */
  static async markFailed(id: number, _error: string, tx?: any): Promise<void> {
    await c(tx)
      .update(financialOutboxTable)
      .set({
        status: "failed",
        retryCount: sql`${financialOutboxTable.retryCount} + 1`,
      })
      .where(eq(financialOutboxTable.id, id));
  }
}
