import { Router, type Response } from "express";
import { z } from "zod";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { AssistantService } from "./assistant.service.js";
import { AssistantContextService } from "./assistant-context.service.js";
import { AssistantToolsRegistry } from "./assistant-tools.registry.js";
import { AssistantAuditService } from "./assistant-audit.service.js";
import { ASSISTANT_CONFIG } from "./assistant.config.js";
import type { AssistantSecurityContext, AssistantRole } from "./assistant.types.js";

const assistantRouter = Router();

// Rate limiting state per user ID (in-memory)
const rateLimitMap = new Map<number, { count: number; windowStart: number }>();

function assistantRateLimiter(req: AuthRequest, res: Response, next: () => void) {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }

  const now = Date.now();
  const windowMs = 60 * 1000;
  const entry = rateLimitMap.get(userId) || { count: 0, windowStart: now };

  if (now - entry.windowStart > windowMs) {
    entry.count = 1;
    entry.windowStart = now;
  } else {
    entry.count++;
  }

  rateLimitMap.set(userId, entry);

  if (entry.count > ASSISTANT_CONFIG.rateLimitPerMinute) {
    res.status(429).json({
      error: "Muitas requisições ao assistente. Por favor, aguarde um momento.",
      code: "RATE_LIMIT_EXCEEDED",
    });
    return;
  }

  next();
}

function extractSecurityContext(req: AuthRequest): AssistantSecurityContext {
  if (!req.user) {
    throw new Error("Usuário não autenticado");
  }

  return {
    userId: req.user.id,
    role: req.user.role as AssistantRole,
    crecheId: req.user.crecheId,
    name: req.user.name,
    email: req.user.email,
    requestId: (req as any).id,
  };
}

// All assistant routes require authentication
assistantRouter.use(authenticate);

// ── POST /message ─────────────────────────────────────────────────────────────
const messageBodySchema = z.object({
  message: z.string().min(1, "A mensagem não pode ser vazia").max(2000, "A mensagem é muito longa"),
  sessionId: z.string().optional(),
  screen: z
    .object({
      route: z.string().default("/"),
      feature: z.string().optional(),
    })
    .optional(),
});

assistantRouter.post("/message", assistantRateLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const parseResult = messageBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "Parâmetros inválidos",
        details: parseResult.error.errors,
      });
      return;
    }

    const context = extractSecurityContext(req);
    const { message, sessionId, screen } = parseResult.data;

    const result = await AssistantService.processMessage(message, sessionId, context, screen);

    res.json(result);
  } catch (err: any) {
    const requestId = (req as any).id || (typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : undefined);
    let context: AssistantSecurityContext | undefined;
    try {
      context = extractSecurityContext(req);
    } catch {
      // Unauthenticated or context error
    }

    AssistantAuditService.logError(context, err, "assistant_message_error");

    const status = err.statusCode || (err.message && err.message.includes("negado") ? 403 : 500);
    if (status === 400 || status === 403 || status === 429 || status === 503) {
      res.status(status).json({
        error: err.message || "Solicitação não autorizada ou temporariamente indisponível.",
        code: status === 503 ? "SERVICE_UNAVAILABLE" : err.code || "ASSISTANT_ERROR",
        requestId,
      });
      return;
    }

    // Safe generic contract for unexpected 500 errors (ASSISTANT_MESSAGE_INTERNAL_ERROR_LEAK = 0)
    res.status(500).json({
      error: "Não foi possível processar a solicitação do assistente.",
      code: "ASSISTANT_ERROR",
      requestId,
    });
  }
});

// ── GET /context ──────────────────────────────────────────────────────────────
assistantRouter.get("/context", async (req: AuthRequest, res: Response) => {
  try {
    const context = extractSecurityContext(req);
    const route = typeof req.query.route === "string" ? req.query.route : "/";

    const resolved = await AssistantContextService.resolveContext(context, { route });
    res.json(resolved);
  } catch (err: any) {
    const requestId = (req as any).id || (typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : undefined);
    AssistantAuditService.logError(undefined, err, "assistant_context_error");
    // ASSISTANT_CONTEXT_INTERNAL_ERROR_LEAK = 0
    res.status(500).json({
      error: "Não foi possível obter o contexto da tela.",
      code: "CONTEXT_ERROR",
      requestId,
    });
  }
});

// ── GET /onboarding ───────────────────────────────────────────────────────────
assistantRouter.get("/onboarding", async (req: AuthRequest, res: Response) => {
  try {
    const context = extractSecurityContext(req);
    if (context.role !== "creche_admin" && context.role !== "master_admin") {
      res.status(403).json({ error: "Acesso negado ao onboarding da creche.", code: "FORBIDDEN" });
      return;
    }

    const status = await AssistantToolsRegistry.executeTool("get_onboarding_status", {}, context);
    res.json(status);
  } catch (err: any) {
    const requestId = (req as any).id || (typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : undefined);
    AssistantAuditService.logError(undefined, err, "assistant_onboarding_error");
    const status = err.statusCode || (err.message && err.message.includes("negado") ? 403 : 500);
    if (status === 403) {
      res.status(403).json({
        error: "Acesso negado ao onboarding da creche.",
        code: "FORBIDDEN",
        requestId,
      });
      return;
    }
    // ASSISTANT_ONBOARDING_INTERNAL_ERROR_LEAK = 0
    res.status(500).json({
      error: "Não foi possível consultar o status do onboarding.",
      code: "ONBOARDING_ERROR",
      requestId,
    });
  }
});

// ── POST /session ─────────────────────────────────────────────────────────────
assistantRouter.post("/session", assistantRateLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const context = extractSecurityContext(req);
    const session = AssistantService.getOrCreateSession(undefined, context);
    res.json({ sessionId: session.id });
  } catch (err: any) {
    const requestId = (req as any).id || (typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : undefined);
    AssistantAuditService.logError(undefined, err, "assistant_session_error");
    // ASSISTANT_SESSION_INTERNAL_ERROR_LEAK = 0
    res.status(500).json({
      error: "Não foi possível inicializar a sessão do assistente.",
      code: "SESSION_ERROR",
      requestId,
    });
  }
});

export default assistantRouter;
