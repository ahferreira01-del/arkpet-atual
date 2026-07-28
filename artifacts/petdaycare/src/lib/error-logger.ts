/**
 * error-logger.ts
 *
 * Captura erros globais (JS não tratado + promises rejeitadas) e erros
 * reportados pelo React Error Boundary.
 *
 * - Persiste até MAX_ENTRIES entradas no localStorage (ring-buffer).
 * - Envia cada entrada ao endpoint da API em background (fire-and-forget).
 * - Nunca lança exceções próprias para não causar loop infinito.
 *
 * Uso:
 *   import { initErrorLogger, logError, getLocalErrorLog } from "@/lib/error-logger";
 *   initErrorLogger();   // chame uma vez em main.tsx
 */

export interface ErrorEntry {
  ts: string;          // ISO timestamp
  type: "uncaught" | "unhandledrejection" | "boundary" | "manual" | "console_error" | "console_warn";
  message: string;
  stack?: string;
  url?: string;
  ua: string;
  appVersion: string;
}

const STORAGE_KEY = "arkpet:errorlog";
const MAX_ENTRIES = 50;
const APP_VERSION =
  (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "dev";

// ── helpers ──────────────────────────────────────────────────────────────────

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function readLog(): ErrorEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ErrorEntry[]) : [];
  } catch {
    return [];
  }
}

function writeLog(entries: ErrorEntry[]): void {
  try {
    // Keep only the latest MAX_ENTRIES
    const trimmed = entries.slice(-MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

function buildEntry(
  type: ErrorEntry["type"],
  message: string,
  stack?: string,
): ErrorEntry {
  return {
    ts: new Date().toISOString(),
    type,
    message: message.slice(0, 2000),
    stack: stack?.slice(0, 3000),
    url: window.location.href,
    ua: navigator.userAgent,
    appVersion: APP_VERSION,
  };
}

async function sendToApi(entry: ErrorEntry): Promise<void> {
  try {
    const base = (import.meta.env.BASE_URL as string | undefined) ?? "/";
    const url = `${base.replace(/\/$/, "")}/api/logs/client`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
      // Short timeout so a broken API doesn't block anything
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Intentionally swallowed — logger must never throw
  }
}

// ── public API ────────────────────────────────────────────────────────────────

/** Add a single error entry to the local log and send to the API. */
export function logError(
  type: ErrorEntry["type"],
  message: string,
  stack?: string,
): void {
  try {
    const entry = buildEntry(type, message, stack);
    const log = readLog();
    log.push(entry);
    writeLog(log);
    sendToApi(entry); // fire-and-forget
    // Always surface in the browser console too
    console.error(`[ErrorLogger][${type}]`, message, stack ?? "");
  } catch {
    // Never throw
  }
}

/**
 * Returns all stored error entries (newest last).
 * Useful for showing to support staff or copying to a bug report.
 */
export function getLocalErrorLog(): ErrorEntry[] {
  return readLog();
}

/** Clear all stored entries. */
export function clearLocalErrorLog(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ── Dedup guard — avoid flooding the server with the same error ───────────────
const recentMessages = new Map<string, number>(); // message → last sent ts
const DEDUP_MS = 10_000; // suppress same message within 10 s

function isDuplicate(message: string): boolean {
  const now = Date.now();
  const last = recentMessages.get(message);
  if (last && now - last < DEDUP_MS) return true;
  recentMessages.set(message, now);
  // Prevent unbounded growth
  if (recentMessages.size > 200) {
    const oldest = recentMessages.keys().next().value;
    if (oldest) recentMessages.delete(oldest);
  }
  return false;
}

/**
 * Register global window error handlers AND patch console.error / console.warn
 * so every error that appears in DevTools is also forwarded to the API.
 * Call once at app startup (main.tsx).
 */
export function initErrorLogger(): void {
  // ── 1. Uncaught JS errors ──────────────────────────────────────────────────
  window.addEventListener("error", (event) => {
    const message = event.message || "Unknown error";
    const stack = event.error?.stack;
    logError("uncaught", message, stack);
  });

  // ── 2. Unhandled promise rejections ───────────────────────────────────────
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = safeStringify(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    logError("unhandledrejection", message, stack);
  });

  // ── 3. console.error / console.warn patch ─────────────────────────────────
  // Save originals BEFORE overriding so we don't recurse.
  const _origError = console.error.bind(console);
  const _origWarn  = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    _origError(...args); // always show in DevTools
    try {
      // Skip our own logger messages to prevent recursion
      const first = String(args[0] ?? "");
      if (first.startsWith("[ErrorLogger]")) return;
      const message = args.map(safeStringify).join(" ").slice(0, 2000);
      if (!isDuplicate(message)) {
        const entry = buildEntry("console_error", message);
        const log = readLog();
        log.push(entry);
        writeLog(log);
        sendToApi(entry);
      }
    } catch {
      // Never throw inside a console patch
    }
  };

  console.warn = (...args: unknown[]) => {
    _origWarn(...args); // always show in DevTools
    try {
      const first = String(args[0] ?? "");
      if (first.startsWith("[ErrorLogger]")) return;
      const message = args.map(safeStringify).join(" ").slice(0, 2000);
      if (!isDuplicate(message)) {
        const entry = buildEntry("console_warn", message);
        const log = readLog();
        log.push(entry);
        writeLog(log);
        sendToApi(entry);
      }
    } catch {
      // Never throw
    }
  };
}
