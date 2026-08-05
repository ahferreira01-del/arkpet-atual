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
  | "OrderCancelled"
  | "AdditionalServicesConfirmed"
  | "AdditionalServiceCreditConsumed"
  | "AdditionalServiceCreditRestored"
  | "AdditionalServiceCharged"
  | "AdditionalServicesCancelled";

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

export interface AdditionalServicesConfirmedEvent extends BaseFinancialEvent {
  type: "AdditionalServicesConfirmed";
  bookingId: number;
  tutorId: number;
  count: number;       // number of add-ons confirmed
}

export interface AdditionalServiceCreditConsumedEvent extends BaseFinancialEvent {
  type: "AdditionalServiceCreditConsumed";
  bookingId: number;
  tutorId: number;
  bookingServiceId: number;
  catalogueItemId: number;
}

export interface AdditionalServiceCreditRestoredEvent extends BaseFinancialEvent {
  type: "AdditionalServiceCreditRestored";
  bookingId: number;
  bookingServiceId: number;
  catalogueItemId: number;
}

export interface AdditionalServiceChargedEvent extends BaseFinancialEvent {
  type: "AdditionalServiceCharged";
  bookingId: number;
  tutorId: number;
  bookingServiceId: number;
  catalogueItemId: number;
  amount: number;
}

export interface AdditionalServicesCancelledEvent extends BaseFinancialEvent {
  type: "AdditionalServicesCancelled";
  bookingId: number;
}

export type FinancialDomainEvent =
  | InvoicePaidEvent
  | InvoiceRefundedEvent
  | InvoiceVoidedEvent
  | CreditsReleasedEvent
  | CreditsConsumedEvent
  | CreditsRestoredEvent
  | OrderPaidEvent
  | OrderCancelledEvent
  | AdditionalServicesConfirmedEvent
  | AdditionalServiceCreditConsumedEvent
  | AdditionalServiceCreditRestoredEvent
  | AdditionalServiceChargedEvent
  | AdditionalServicesCancelledEvent;

/**
 * Stamps `occurredAt` and returns a typed domain event.
 * Usage: `createEvent<InvoicePaidEvent>({ type: "InvoicePaid", ... })`
 */
export function createEvent<T extends FinancialDomainEvent>(
  event: Omit<T, "occurredAt">
): T {
  return { ...event, occurredAt: new Date().toISOString() } as T;
}
