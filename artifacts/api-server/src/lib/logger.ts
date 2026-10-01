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
  errorName?: string;
  errorCode?: string;
  messageSafe?: string;
  reason?: string;
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
 * Defensive string sanitization for common credentials, tokens, connection URIs, and sensitive fields.
 * Masks:
 * - Connection strings: postgres://user:password@host:port/db
 * - Bearer tokens: Bearer <token>
 * - Basic auth: Basic <base64>
 * - Stripe secret keys: sk_live_..., sk_test_..., rk_live_..., rk_test_...
 * - JWT tokens: eyJ...
 * - Key-value sensitive parameters: password=..., token=..., secret=...
 */
export function sanitizeString(input: string): string {
  if (!input || typeof input !== "string") return input;

  let sanitized = input;

  // 1. Database URLs / Connection URIs with credentials
  sanitized = sanitized.replace(
    /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:\s\/@]+):([^@\s\/]+)@/g,
    "$1[REDACTED_USER]:[REDACTED_SECRET]@"
  );

  // Standalone connection strings
  sanitized = sanitized.replace(
    /(postgres(?:ql)?|mysql|mongodb|redis):\/\/[^\s"'`]+/gi,
    (match) => match.replace(/:([^\/@\s]+)@/, ":[REDACTED_SECRET]@")
  );

  // 2. Bearer tokens
  sanitized = sanitized.replace(/Bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]");

  // 3. Basic auth
  sanitized = sanitized.replace(/Basic\s+[a-zA-Z0-9+/=]+/gi, "Basic [REDACTED]");

  // 4. Stripe API keys (sk_live_..., sk_test_..., rk_live_..., rk_test_...)
  sanitized = sanitized.replace(/(?:sk|rk)_(?:live|test)_[a-zA-Z0-9]+/g, "[REDACTED_STRIPE_KEY]");

  // 5. JWT tokens (header.payload.signature)
  sanitized = sanitized.replace(/eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+/g, "[REDACTED_JWT]");

  // 6. Sensitive key-value / query string parameters
  sanitized = sanitized.replace(
    /(password|passwordhash|token|secret|jwt|cvv|cpf|authorization|cookie|session)=([^&\s,;]+)/gi,
    "$1=[REDACTED]"
  );

  // 7. Driver password auth errors (e.g. password authentication failed for postgres: pass, or for user postgres: pass)
  sanitized = sanitized.replace(
    /(password(?: authentication failed)?(?: for (?:user )?[^:]+)?:?)\s*\S+/gi,
    "$1: [REDACTED]"
  );

  // 8. General password pattern in error messages e.g. "password: secret" or "password is secret"
  sanitized = sanitized.replace(
    /(password|passwd|pwd)\s*(?:is\s*|:\s*|=\s*|\s+)(\S+)/gi,
    "$1: [REDACTED]"
  );

  return sanitized;
}

/**
 * Recursively redacts sensitive keys from objects and arrays with circular-reference protection
 * and deep string sanitization against embedded secret values.
 */
export function redact(value: unknown, seen = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return sanitizeString(value);
  }
  if (typeof value !== "object") return value;

  if (seen.has(value as object)) {
    return "[CIRCULAR]";
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }

  if (value instanceof Error) {
    const isProd = process.env.NODE_ENV === "production";
    const res: Record<string, unknown> = {
      name: value.name,
      code: (value as any).code || "INTERNAL_ERROR",
      statusCode: (value as any).statusCode || (value as any).status,
    };
    if (!isProd) {
      res.message = sanitizeString(value.message);
    }
    return res;
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
    const isProd = process.env.NODE_ENV === "production";

    if (errOrContext instanceof Error) {
      finalContext.errorName = errOrContext.name;
      finalContext.errorCode = (errOrContext as any).code || "INTERNAL_ERROR";
      if (!isProd) {
        finalContext.messageSafe = sanitizeString(finalContext.messageSafe || errOrContext.message);
        if (errOrContext.stack) {
          finalContext.stack = sanitizeString(errOrContext.stack);
        }
      } else {
        // In production: NEVER assign arbitrary err.message to messageSafe!
        // RAW_ERROR_MESSAGE_PRODUCTION_LOGGING = 0
        finalContext.messageSafe = finalContext.messageSafe
          ? sanitizeString(finalContext.messageSafe)
          : "An internal server error occurred";
      }
    } else if (typeof errOrContext === "object" && errOrContext !== null) {
      finalContext = { ...(errOrContext as LogContext), ...finalContext };
      if (finalContext.messageSafe) {
        finalContext.messageSafe = sanitizeString(finalContext.messageSafe);
      }
    } else if (typeof errOrContext === "string") {
      finalContext.messageSafe = sanitizeString(errOrContext);
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
