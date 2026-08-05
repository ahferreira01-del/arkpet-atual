/**
 * Structured financial logger (Phase 15B).
 *
 * Writes newline-delimited JSON to stdout.
 * All financial operations should use this instead of console.log/warn/error.
 *
 * Fields:
 *   - ts:         ISO-8601 timestamp
 *   - logger:     always "financial"
 *   - operation:  the operation name (e.g. "billing_addCharge", "credits_release")
 *   - tenantId:   crecheId (maps to tenant)
 *   - invoiceId:  (optional)
 *   - orderId:    (optional)
 *   - bookingId:  (optional)
 *   - userId:     (optional)
 *   - elapsedMs:  (optional)
 *   - result:     "ok" | "error" | custom
 *   - error:      error message (only on errors)
 *   - [rest]:     any extra context fields
 */

export interface FinancialLogParams {
  operation: string;
  tenantId?: number;
  invoiceId?: number;
  orderId?: number;
  bookingId?: number;
  userId?: number;
  elapsedMs?: number;
  result?: string;
  error?: string;
  level?: "info" | "warn" | "error";
  [key: string]: unknown;
}

export function financialLog(params: FinancialLogParams): void {
  const { level = "info", ...rest } = params;
  const entry = {
    ts: new Date().toISOString(),
    logger: "financial",
    level,
    ...rest,
  };
  try {
    process.stdout.write(JSON.stringify(entry) + "\n");
  } catch {
    // stdout write failure must never throw
  }
}
