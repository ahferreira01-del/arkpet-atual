import { Router, type Response } from "express";
import { z } from "zod";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { AssistantService } from "./assistant.service.js";
import { AssistantContextService } from "./assistant-context.service.js";
import { AssistantToolsRegistry } from "./assistant-tools.registry.js";
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
    const status = err.statusCode || (err.message.includes("negado") ? 403 : 500);
    res.status(status).json({
      error: err.message || "Erro ao processar mensagem do assistente",
      code: status === 503 ? "SERVICE_UNAVAILABLE" : "ASSISTANT_ERROR",
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
    res.status(500).json({ error: err.message || "Erro ao obter contexto" });
  }
});

// ── GET /onboarding ───────────────────────────────────────────────────────────
assistantRouter.get("/onboarding", async (req: AuthRequest, res: Response) => {
  try {
    const context = extractSecurityContext(req);
    if (context.role !== "creche_admin" && context.role !== "master_admin") {
      res.status(403).json({ error: "Acesso negado ao onboarding da creche" });
      return;
    }

    const status = await AssistantToolsRegistry.executeTool("get_onboarding_status", {}, context);
    res.json(status);
  } catch (err: any) {
    const status = err.message.includes("negado") ? 403 : 500;
    res.status(status).json({ error: err.message || "Erro ao consultar onboarding" });
  }
});

// ── POST /session ─────────────────────────────────────────────────────────────
assistantRouter.post("/session", assistantRateLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const context = extractSecurityContext(req);
    const session = AssistantService.getOrCreateSession(undefined, context);
    res.json({ sessionId: session.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Erro ao criar sessão" });
  }
});

export default assistantRouter;
