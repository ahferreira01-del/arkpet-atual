import { Router, Request, Response, NextFunction } from "express";
import { type AuthRequest } from "../middlewares/authenticate.js";
import {
  TutorCommercialPricingService,
  TutorCommercialError,
  TutorCommercialForbiddenError,
  type CreateConditionInput,
  type SupersedeConditionInput,
  type PreviewConditionInput,
  type TutorConditionType,
} from "../services/tutorCommercialPricing.js";

const router = Router({ mergeParams: true });

function parseIds(req: Request): { crecheId: number; tutorId: number } {
  const crecheIdParam = Array.isArray(req.params.crecheId) ? req.params.crecheId[0] : req.params.crecheId;
  const tutorIdParam = Array.isArray(req.params.tutorId) ? req.params.tutorId[0] : req.params.tutorId;
  const crecheId = parseInt(String(crecheIdParam), 10);
  const tutorId = parseInt(String(tutorIdParam), 10);

  if (!Number.isInteger(crecheId) || crecheId <= 0) {
    throw Object.assign(new Error("ID da creche inválido."), { status: 400 });
  }
  if (!Number.isInteger(tutorId) || tutorId <= 0) {
    throw Object.assign(new Error("ID do tutor inválido."), { status: 400 });
  }

  return { crecheId, tutorId };
}

function getActor(req: Request) {
  const user = (req as AuthRequest).user;
  if (!user) {
    throw Object.assign(new Error("Não autenticado."), { status: 401 });
  }
  return {
    userId: user.id,
    role: user.role,
    requestId: (req.headers["x-request-id"] as string) || undefined,
  };
}

function getIdempotencyKey(req: Request): string | undefined {
  const headerKey = req.headers["x-idempotency-key"];
  if (typeof headerKey === "string" && headerKey.trim()) {
    return headerKey.trim();
  }
  if (typeof req.body?.idempotencyKey === "string" && req.body.idempotencyKey.trim()) {
    return req.body.idempotencyKey.trim();
  }
  return undefined;
}

/**
 * GET /creches/:crecheId/tutors/:tutorId/commercial-conditions
 * Lists all commercial conditions for a tutor.
 */
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { crecheId, tutorId } = parseIds(req);
    const actor = getActor(req);

    // Tutor can only view their own conditions
    if (actor.role === "tutor" && actor.userId !== tutorId) {
      throw new TutorCommercialForbiddenError("Acesso negado.");
    }

    const conditions = await TutorCommercialPricingService.listConditions(crecheId, tutorId);
    res.json(conditions);
  } catch (err: any) {
    if (err instanceof TutorCommercialError || err.status) {
      res.status(err.status || 400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * POST /creches/:crecheId/tutors/:tutorId/commercial-conditions/preview
 * Dry-run simulation of a condition price without mutating state.
 */
router.post("/preview", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { crecheId, tutorId } = parseIds(req);
    const actor = getActor(req);

    if (actor.role === "tutor") {
      throw new TutorCommercialForbiddenError("Tutores não podem simular criação de condições.");
    }

    const body = req.body || {};
    const input: PreviewConditionInput = {
      catalogueItemId: parseInt(body.catalogueItemId, 10),
      conditionType: body.conditionType as TutorConditionType,
      customPriceCents: body.customPriceCents != null ? Number(body.customPriceCents) : null,
      percentageBps: body.percentageBps != null ? Number(body.percentageBps) : null,
      fixedDiscountCents: body.fixedDiscountCents != null ? Number(body.fixedDiscountCents) : null,
      petSize: body.petSize || null,
      quantity: body.quantity ? Number(body.quantity) : 1,
    };

    if (!Number.isInteger(input.catalogueItemId) || input.catalogueItemId <= 0) {
      throw Object.assign(new Error("ID do item do catálogo inválido."), { status: 400 });
    }

    const preview = await TutorCommercialPricingService.previewCondition(
      crecheId,
      tutorId,
      input
    );

    res.json(preview);
  } catch (err: any) {
    if (err instanceof TutorCommercialError || err.status) {
      res.status(err.status || 400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * POST /creches/:crecheId/tutors/:tutorId/commercial-conditions
 * Creates a new condition for the tutor.
 */
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { crecheId, tutorId } = parseIds(req);
    const actor = getActor(req);

    const body = req.body || {};
    const idempotencyKey = getIdempotencyKey(req);

    const input: CreateConditionInput = {
      catalogueItemId: parseInt(body.catalogueItemId, 10),
      conditionType: body.conditionType as TutorConditionType,
      customPriceCents: body.customPriceCents != null ? Number(body.customPriceCents) : null,
      percentageBps: body.percentageBps != null ? Number(body.percentageBps) : null,
      fixedDiscountCents: body.fixedDiscountCents != null ? Number(body.fixedDiscountCents) : null,
      validFrom: body.validFrom,
      validUntil: body.validUntil,
      reason: body.reason,
      idempotencyKey,
    };

    if (!Number.isInteger(input.catalogueItemId) || input.catalogueItemId <= 0) {
      throw Object.assign(new Error("ID do item do catálogo inválido."), { status: 400 });
    }

    const condition = await TutorCommercialPricingService.createCondition(
      crecheId,
      tutorId,
      input,
      actor
    );

    res.status(201).json(condition);
  } catch (err: any) {
    if (err instanceof TutorCommercialError || err.status) {
      res.status(err.status || 400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * POST /creches/:crecheId/tutors/:tutorId/commercial-conditions/:conditionId/supersede
 * Supersedes an active or scheduled condition with a new condition.
 */
router.post("/:conditionId/supersede", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { crecheId, tutorId } = parseIds(req);
    const actor = getActor(req);
    const conditionIdParam = Array.isArray(req.params.conditionId) ? req.params.conditionId[0] : req.params.conditionId;
    const conditionId = parseInt(String(conditionIdParam), 10);

    if (!Number.isInteger(conditionId) || conditionId <= 0) {
      throw Object.assign(new Error("ID da condição comercial inválido."), { status: 400 });
    }

    const body = req.body || {};
    const idempotencyKey = getIdempotencyKey(req);

    const input: SupersedeConditionInput = {
      conditionType: body.conditionType as TutorConditionType,
      customPriceCents: body.customPriceCents != null ? Number(body.customPriceCents) : null,
      percentageBps: body.percentageBps != null ? Number(body.percentageBps) : null,
      fixedDiscountCents: body.fixedDiscountCents != null ? Number(body.fixedDiscountCents) : null,
      validFrom: body.validFrom,
      validUntil: body.validUntil,
      reason: body.reason,
      idempotencyKey,
    };

    const condition = await TutorCommercialPricingService.supersedeCondition(
      crecheId,
      tutorId,
      conditionId,
      input,
      actor
    );

    res.json(condition);
  } catch (err: any) {
    if (err instanceof TutorCommercialError || err.status) {
      res.status(err.status || 400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * POST /creches/:crecheId/tutors/:tutorId/commercial-conditions/:conditionId/revoke
 * Revokes an active or scheduled condition.
 */
router.post("/:conditionId/revoke", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { crecheId, tutorId } = parseIds(req);
    const actor = getActor(req);
    const conditionIdParam = Array.isArray(req.params.conditionId) ? req.params.conditionId[0] : req.params.conditionId;
    const conditionId = parseInt(String(conditionIdParam), 10);

    if (!Number.isInteger(conditionId) || conditionId <= 0) {
      throw Object.assign(new Error("ID da condição comercial inválido."), { status: 400 });
    }

    const reason = req.body?.reason;
    const idempotencyKey = getIdempotencyKey(req);

    const condition = await TutorCommercialPricingService.revokeCondition(
      crecheId,
      tutorId,
      conditionId,
      reason,
      actor,
      idempotencyKey
    );

    res.json(condition);
  } catch (err: any) {
    if (err instanceof TutorCommercialError || err.status) {
      res.status(err.status || 400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * GET /creches/:crecheId/tutors/:tutorId/commercial-conditions/:conditionId
 * Fetches a single condition by ID.
 */
router.get("/:conditionId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { crecheId, tutorId } = parseIds(req);
    const actor = getActor(req);
    const conditionIdParam = Array.isArray(req.params.conditionId) ? req.params.conditionId[0] : req.params.conditionId;
    const conditionId = parseInt(String(conditionIdParam), 10);

    if (!Number.isInteger(conditionId) || conditionId <= 0) {
      throw Object.assign(new Error("ID da condição comercial inválido."), { status: 400 });
    }

    if (actor.role === "tutor" && actor.userId !== tutorId) {
      throw new TutorCommercialForbiddenError("Acesso negado.");
    }

    const condition = await TutorCommercialPricingService.getConditionById(
      crecheId,
      tutorId,
      conditionId
    );

    if (!condition) {
      res.status(404).json({ error: "Condição comercial não encontrada." });
      return;
    }

    res.json(condition);
  } catch (err: any) {
    if (err instanceof TutorCommercialError || err.status) {
      res.status(err.status || 400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

export default router;
