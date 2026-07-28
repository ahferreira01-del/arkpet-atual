/**
 * logs.ts
 *
 * POST /api/logs/client  — recebe relatórios de erro do frontend e grava em
 * artifacts/api-server/logs/client-errors.log (JSON-lines).
 *
 * Não requer autenticação: erros de boundary acontecem antes/durante o login.
 * Rate-limit simples por IP: máximo 20 entradas por minuto para evitar abuso.
 */

import { Router, type Request, type Response } from "express";
import { appendFile, mkdir } from "fs/promises";
import path from "path";

const router = Router();

// ── Rate limiter simples em memória ─────────────────────────────────────────
const ipCounters = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20;       // max requests per window
const WINDOW_MS = 60_000;    // 1 minute window

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipCounters.get(ip);
  if (!entry || now > entry.resetAt) {
    ipCounters.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

// ── Log file path ────────────────────────────────────────────────────────────
// Use process.cwd() — works in both ESM and CJS bundles (import.meta.url is
// undefined in the CJS build output and would throw at module load time).
const LOG_DIR  = path.resolve(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "client-errors.log");

let dirReady = false;
async function ensureDir(): Promise<void> {
  if (dirReady) return;
  await mkdir(LOG_DIR, { recursive: true });
  dirReady = true;
}

// ── Route ────────────────────────────────────────────────────────────────────

router.post("/logs/client", async (req: Request, res: Response): Promise<void> => {
  const ip = (req.ip ?? "unknown").replace(/^::ffff:/, "");

  if (isRateLimited(ip)) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  const body = req.body as Record<string, unknown>;

  // Basic validation — just needs a message string
  if (!body || typeof body.message !== "string") {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const entry = {
    ts:         typeof body.ts === "string" ? body.ts : new Date().toISOString(),
    type:       typeof body.type === "string" ? body.type : "unknown",
    message:    String(body.message).slice(0, 2000),
    stack:      typeof body.stack === "string" ? body.stack.slice(0, 3000) : undefined,
    url:        typeof body.url === "string" ? body.url : undefined,
    ua:         typeof body.ua === "string" ? body.ua : undefined,
    appVersion: typeof body.appVersion === "string" ? body.appVersion : undefined,
    ip,
  };

  // Always emit to server console so it shows in workflow logs
  console.error("[client-error]", JSON.stringify({
    type: entry.type,
    message: entry.message,
    url: entry.url,
    appVersion: entry.appVersion,
    ip,
  }));

  // Append to log file (JSON-lines format)
  try {
    await ensureDir();
    await appendFile(LOG_FILE, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    console.error("[logs] Falha ao gravar client-errors.log:", err);
  }

  res.status(204).end();
});

export default router;
