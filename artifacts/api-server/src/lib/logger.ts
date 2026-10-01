import crypto from "crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  userId?: number;
  role?: string;
  crecheId?: number;
  entityType?: string;
  entityId?: string | number;
  errorCode?: string;
  messageSafe?: string;
  [key: string]: unknown;
}

export interface StructuredLogRecord extends LogContext {
  timestamp: string;
  level: LogLevel;
  event: string;
}

// ── Financial Logger Compatibility (Phase 15B / R36) ─────────────────────────
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

// Keys that must NEVER appear unredacted in log output
const FORBIDDEN_KEY_PATTERNS = [
  /password/i,
  /passwordhash/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /secret/i,
  /jwt/i,
  /vapidprivatekey/i,
  /stripesecretkey/i,
  /stripewebhooksecret/i,
  /uploadproof/i,
  /mediauploadproof/i,
  /ownershipproof/i,
  /cpf/i,
  /card/i,
  /cvv/i,
  /messagebody/i,
  /content/i,
  /filecontent/i,
  /filedata/i,
];

export function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Recursively redacts sensitive keys from objects and arrays with circular-reference protection.
 */
export function redact(value: unknown, seen = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  if (seen.has(value as object)) {
    return "[CIRCULAR]";
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      code: (value as any).code,
      statusCode: (value as any).statusCode || (value as any).status,
    };
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (isForbiddenKey(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = redact(val, seen);
    }
  }
  return result;
}

/**
 * Truncates and fingerprints push notification endpoints to avoid logging private subscriber tokens.
 * Example: https://fcm.googleapis.com/...[a1b2c3d4]
 */
export function sanitizePushEndpoint(endpoint?: string): string {
  if (!endpoint) return "none";
  try {
    const url = new URL(endpoint);
    const hash = crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 8);
    return `${url.origin}/...[${hash}]`;
  } catch {
    return "[invalid-endpoint]";
  }
}

/**
 * Masks user email addresses for privacy (e.g. u***@arkpet.test).
 */
export function maskEmail(email?: string): string {
  if (!email || typeof email !== "string" || !email.includes("@")) return "unknown";
  const [local, domain] = email.split("@");
  if (local.length <= 2) {
    return `${local[0]}***@${domain}`;
  }
  return `${local.slice(0, 2)}***@${domain}`;
}

export type LogWriter = (line: string, level: LogLevel) => void;

let defaultWriter: LogWriter = (line, level) => {
  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
};

/**
 * Allows test suites to intercept log lines without polluting stdout.
 */
export function setLogWriter(writer: LogWriter): void {
  defaultWriter = writer;
}

export function resetLogWriter(): void {
  defaultWriter = (line, level) => {
    if (level === "error") {
      process.stderr.write(line + "\n");
    } else {
      process.stdout.write(line + "\n");
    }
  };
}

function formatAndEmit(level: LogLevel, event: string, context?: LogContext): void {
  try {
    const redactedContext = (context ? redact(context) : {}) as LogContext;
    const record: StructuredLogRecord = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...redactedContext,
    };

    // Serialize to single-line JSON to prevent multiline log injection
    const line = JSON.stringify(record);
    defaultWriter(line, level);
  } catch (err) {
    // Failsafe: logger must NEVER throw and break incoming HTTP requests
    try {
      const fallback = JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "logger_failure",
        messageSafe: "Failed to format log entry",
      });
      defaultWriter(fallback, "error");
    } catch {
      // In extremis: completely silent to protect the request lifecycle
    }
  }
}

export const logger = {
  debug(event: string, context?: LogContext): void {
    if (process.env.LOG_LEVEL === "debug" || process.env.NODE_ENV === "development") {
      formatAndEmit("debug", event, context);
    }
  },

  info(event: string, context?: LogContext): void {
    formatAndEmit("info", event, context);
  },

  warn(event: string, context?: LogContext): void {
    formatAndEmit("warn", event, context);
  },

  error(event: string, errOrContext?: unknown, context?: LogContext): void {
    let finalContext: LogContext = context ? { ...context } : {};

    if (errOrContext instanceof Error) {
      finalContext.messageSafe = errOrContext.message;
      finalContext.errorCode = (errOrContext as any).code || "INTERNAL_ERROR";
      // Only include stack internally on server-side logs, sanitized
      if (process.env.NODE_ENV !== "production") {
        finalContext.stack = errOrContext.stack;
      }
    } else if (typeof errOrContext === "object" && errOrContext !== null) {
      finalContext = { ...(errOrContext as LogContext), ...finalContext };
    } else if (typeof errOrContext === "string") {
      finalContext.messageSafe = errOrContext;
    }

    formatAndEmit("error", event, finalContext);
  },
};

/**
 * Preserved historical financial logger with central redaction protection.
 */
export function financialLog(params: FinancialLogParams): void {
  const { level = "info", ...rest } = params;
  const redactedRest = redact(rest) as Record<string, unknown>;
  const entry = {
    ts: new Date().toISOString(),
    logger: "financial",
    level,
    ...redactedRest,
  };
  try {
    defaultWriter(JSON.stringify(entry), level);
  } catch {
    // stdout write failure must never throw
  }
}
