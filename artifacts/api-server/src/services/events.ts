/**
 * Domain event types for the financial module (Phase 15B).
 *
 * Every event carries at minimum: type, crecheId, occurredAt.
 * Events are stored in the financial_outbox table (atomically with the main
 * DB write) and processed by the outbox worker.
 */

export type FinancialEventType =
  | "InvoicePaid"
  | "InvoiceRefunded"
  | "InvoiceVoided"
  | "CreditsReleased"
  | "CreditsConsumed"
  | "CreditsRestored"
  | "OrderPaid"
  | "OrderCancelled";

export interface BaseFinancialEvent {
  type: FinancialEventType;
  crecheId: number;
  occurredAt: string;  // ISO-8601
}

export interface InvoicePaidEvent extends BaseFinancialEvent {
  type: "InvoicePaid";
  invoiceId: number;
  tutorId?: number | null;
  amount: string;
  paymentMethod: string;
}

export interface InvoiceRefundedEvent extends BaseFinancialEvent {
  type: "InvoiceRefunded";
  invoiceId: number;
  tutorId?: number | null;
  amount: string;
}

export interface InvoiceVoidedEvent extends BaseFinancialEvent {
  type: "InvoiceVoided";
  invoiceId: number;
  tutorId?: number | null;
}

export interface CreditsReleasedEvent extends BaseFinancialEvent {
  type: "CreditsReleased";
  invoiceId: number;
  tutorId: number;
}

export interface CreditsConsumedEvent extends BaseFinancialEvent {
  type: "CreditsConsumed";
  bookingId: number;
  tutorId: number;
  creditsConsumed: number;
}

export interface CreditsRestoredEvent extends BaseFinancialEvent {
  type: "CreditsRestored";
  bookingId: number;
}

export interface OrderPaidEvent extends BaseFinancialEvent {
  type: "OrderPaid";
  invoiceId: number;
}

export interface OrderCancelledEvent extends BaseFinancialEvent {
  type: "OrderCancelled";
  invoiceId: number;
}

export type FinancialDomainEvent =
  | InvoicePaidEvent
  | InvoiceRefundedEvent
  | InvoiceVoidedEvent
  | CreditsReleasedEvent
  | CreditsConsumedEvent
  | CreditsRestoredEvent
  | OrderPaidEvent
  | OrderCancelledEvent;

/**
 * Stamps `occurredAt` and returns a typed domain event.
 * Usage: `createEvent<InvoicePaidEvent>({ type: "InvoicePaid", ... })`
 */
export function createEvent<T extends FinancialDomainEvent>(
  event: Omit<T, "occurredAt">
): T {
  return { ...event, occurredAt: new Date().toISOString() } as T;
}
