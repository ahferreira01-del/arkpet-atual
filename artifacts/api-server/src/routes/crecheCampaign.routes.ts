import { Router, Request, Response, NextFunction } from "express";
import { type AuthRequest } from "../middlewares/authenticate.js";
import {
  CrecheCampaignService,
  type ActorContext,
  type CreateCampaignInput,
  type UpdateDraftCampaignInput,
} from "../services/crecheCampaign.service.js";
import {
  CrecheCampaignError,
  CrecheCampaignForbiddenError,
  assertCanManageCampaign,
} from "../services/crecheCampaignPricing.js";

const router = Router({ mergeParams: true });

function parseCrecheId(req: Request): number {
  const param = Array.isArray(req.params.crecheId) ? req.params.crecheId[0] : req.params.crecheId;
  const crecheId = parseInt(String(param), 10);
  if (!Number.isInteger(crecheId) || crecheId <= 0) {
    throw Object.assign(new Error("ID da creche inválido."), { status: 400 });
  }
  return crecheId;
}

function parseCampaignId(req: Request): number {
  const param = Array.isArray(req.params.campaignId) ? req.params.campaignId[0] : req.params.campaignId;
  const campaignId = parseInt(String(param), 10);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    throw Object.assign(new Error("ID da campanha inválido."), { status: 400 });
  }
  return campaignId;
}

function getActor(req: Request): ActorContext {
  const user = (req as AuthRequest).user;
  if (!user) {
    throw Object.assign(new Error("Não autenticado."), { status: 401 });
  }
  return {
    userId: user.id,
    role: user.role,
    source: "http", // Enforces Adjustment 6: HTTP requests can never claim role='system'
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
 * GET /api/creches/:crecheId/campaigns
 * Lists all promotional campaigns for this creche.
 * Staff and creche_admin can read. Tutor gets 403.
 */
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const crecheId = parseCrecheId(req);
    const actor = getActor(req);

    if (actor.role === "tutor") {
      throw new CrecheCampaignForbiddenError("Tutores não têm acesso às campanhas da creche.");
    }

    const { status, search } = req.query;
    const result = await CrecheCampaignService.listCampaigns(crecheId, {
      status: status ? String(status) as any : undefined,
      search: search ? String(search) : undefined,
    });

    res.json(result);
  } catch (err: any) {
    if (err instanceof CrecheCampaignError || err.status) {
      res.status(err.status || 400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * POST /api/creches/:crecheId/campaigns/preview
 * Dry-run simulation of campaign pricing and eligible audience count.
 * Staff and creche_admin can preview.
 */
router.post("/preview", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const crecheId = parseCrecheId(req);
    const actor = getActor(req);

    if (actor.role === "tutor") {
      throw new CrecheCampaignForbiddenError("Tutores não podem gerar preview de campanhas.");
    }

    const body = req.body || {};
    const input: CreateCampaignInput = {
      name: body.name || "Preview",
      description: body.description,
      benefitType: body.benefitType,
      percentageBps: body.percentageBps != null ? Number(body.percentageBps) : null,
      fixedDiscountCents: body.fixedDiscountCents != null ? Number(body.fixedDiscountCents) : null,
      fixedPromotionalPriceCents:
        body.fixedPromotionalPriceCents != null ? Number(body.fixedPromotionalPriceCents) : null,
      audienceType: body.audienceType || "ALL_ACTIVE_TUTORS",
      selectedTutorIds: Array.isArray(body.selectedTutorIds)
        ? body.selectedTutorIds.map((id: any) => Number(id))
        : [],
      itemIds: Array.isArray(body.itemIds) ? body.itemIds.map((id: any) => Number(id)) : [],
      conditionInteractionPolicy: body.conditionInteractionPolicy || "EXCLUDE_IF_TUTOR_CONDITION",
      validFrom: body.validFrom,
      validUntil: body.validUntil,
    };

    const preview = await CrecheCampaignService.preview(crecheId, input);
    res.json(preview);
  } catch (err: any) {
    if (err instanceof CrecheCampaignError || err.status) {
      res.status(err.status || 400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * POST /api/creches/:crecheId/campaigns
 * Creates a new promotional campaign in DRAFT status.
 * Only creche_admin can create.
 */
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const crecheId = parseCrecheId(req);
    const actor = getActor(req);
    assertCanManageCampaign(actor);

    const idempotencyKey = getIdempotencyKey(req);
    const body = req.body || {};
    const input: CreateCampaignInput = {
      name: body.name,
      description: body.description,
      benefitType: body.benefitType,
      percentageBps: body.percentageBps != null ? Number(body.percentageBps) : null,
      fixedDiscountCents: body.fixedDiscountCents != null ? Number(body.fixedDiscountCents) : null,
      fixedPromotionalPriceCents:
        body.fixedPromotionalPriceCents != null ? Number(body.fixedPromotionalPriceCents) : null,
      audienceType: body.audienceType,
      selectedTutorIds: Array.isArray(body.selectedTutorIds)
        ? body.selectedTutorIds.map((id: any) => Number(id))
        : [],
      itemIds: Array.isArray(body.itemIds) ? body.itemIds.map((id: any) => Number(id)) : [],
      conditionInteractionPolicy: body.conditionInteractionPolicy,
      usageLimitType: body.usageLimitType,
      usageLimitPerTutor: body.usageLimitPerTutor != null ? Number(body.usageLimitPerTutor) : null,
      priority: body.priority != null ? Number(body.priority) : undefined,
      validFrom: body.validFrom,
      validUntil: body.validUntil,
      reason: body.reason,
    };

    const result = await CrecheCampaignService.createDraft(crecheId, actor, input, idempotencyKey);
    res.status(201).json(result);
  } catch (err: any) {
    if (err instanceof CrecheCampaignError || err.status) {
      res.status(err.status || 400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * GET /api/creches/:crecheId/campaigns/:campaignId
 * Retrieves detailed campaign info.
 */
router.get("/:campaignId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const crecheId = parseCrecheId(req);
    const campaignId = parseCampaignId(req);
    const actor = getActor(req);

    if (actor.role === "tutor") {
      throw new CrecheCampaignForbiddenError("Tutores não têm acesso aos detalhes da campanha.");
    }

    const campaign = await CrecheCampaignService.getCampaignById(crecheId, campaignId);
    res.json(campaign);
  } catch (err: any) {
    if (err instanceof CrecheCampaignError || err.status) {
      res.status(err.status || 400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * PUT /api/creches/:crecheId/campaigns/:campaignId
 * Updates a campaign in DRAFT or SCHEDULED (prior to validFrom).
 */
router.put("/:campaignId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const crecheId = parseCrecheId(req);
    const campaignId = parseCampaignId(req);
    const actor = getActor(req);
    assertCanManageCampaign(actor);

    const idempotencyKey = getIdempotencyKey(req);
    const body = req.body || {};
    const input: UpdateDraftCampaignInput = {
      name: body.name,
      description: body.description,
      benefitType: body.benefitType,
      percentageBps: body.percentageBps != null ? Number(body.percentageBps) : undefined,
      fixedDiscountCents: body.fixedDiscountCents != null ? Number(body.fixedDiscountCents) : undefined,
      fixedPromotionalPriceCents:
        body.fixedPromotionalPriceCents != null ? Number(body.fixedPromotionalPriceCents) : undefined,
      audienceType: body.audienceType,
      selectedTutorIds: Array.isArray(body.selectedTutorIds)
        ? body.selectedTutorIds.map((id: any) => Number(id))
        : undefined,
      itemIds: Array.isArray(body.itemIds) ? body.itemIds.map((id: any) => Number(id)) : undefined,
      conditionInteractionPolicy: body.conditionInteractionPolicy,
      usageLimitType: body.usageLimitType,
      usageLimitPerTutor: body.usageLimitPerTutor != null ? Number(body.usageLimitPerTutor) : undefined,
      priority: body.priority != null ? Number(body.priority) : undefined,
      validFrom: body.validFrom,
      validUntil: body.validUntil,
      reason: body.reason,
    };

    const result = await CrecheCampaignService.updateDraft(crecheId, campaignId, actor, input, idempotencyKey);
    res.json(result);
  } catch (err: any) {
    if (err instanceof CrecheCampaignError || err.status) {
      res.status(err.status || 400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * POST /api/creches/:crecheId/campaigns/:campaignId/publish
 * Publishes a draft/scheduled campaign.
 */
router.post("/:campaignId/publish", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const crecheId = parseCrecheId(req);
    const campaignId = parseCampaignId(req);
    const actor = getActor(req);
    assertCanManageCampaign(actor);

    const idempotencyKey = getIdempotencyKey(req);
    const reason = req.body?.reason;

    const result = await CrecheCampaignService.publish(crecheId, campaignId, actor, reason, idempotencyKey);
    res.json(result);
  } catch (err: any) {
    if (err instanceof CrecheCampaignError || err.status) {
      res.status(err.status || 400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * POST /api/creches/:crecheId/campaigns/:campaignId/pause
 * Pauses an active campaign.
 */
router.post("/:campaignId/pause", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const crecheId = parseCrecheId(req);
    const campaignId = parseCampaignId(req);
    const actor = getActor(req);
    assertCanManageCampaign(actor);

    const idempotencyKey = getIdempotencyKey(req);
    const reason = req.body?.reason;

    const result = await CrecheCampaignService.pause(crecheId, campaignId, actor, reason, idempotencyKey);
    res.json(result);
  } catch (err: any) {
    if (err instanceof CrecheCampaignError || err.status) {
      res.status(err.status || 400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * POST /api/creches/:crecheId/campaigns/:campaignId/resume
 * Resumes a paused campaign.
 */
router.post("/:campaignId/resume", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const crecheId = parseCrecheId(req);
    const campaignId = parseCampaignId(req);
    const actor = getActor(req);
    assertCanManageCampaign(actor);

    const idempotencyKey = getIdempotencyKey(req);
    const reason = req.body?.reason;

    const result = await CrecheCampaignService.resume(crecheId, campaignId, actor, reason, idempotencyKey);
    res.json(result);
  } catch (err: any) {
    if (err instanceof CrecheCampaignError || err.status) {
      res.status(err.status || 400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * POST /api/creches/:crecheId/campaigns/:campaignId/revoke
 * Permanently revokes a campaign.
 */
router.post("/:campaignId/revoke", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const crecheId = parseCrecheId(req);
    const campaignId = parseCampaignId(req);
    const actor = getActor(req);
    assertCanManageCampaign(actor);

    const idempotencyKey = getIdempotencyKey(req);
    const reason = req.body?.reason;

    const result = await CrecheCampaignService.revoke(crecheId, campaignId, actor, reason, idempotencyKey);
    res.json(result);
  } catch (err: any) {
    if (err instanceof CrecheCampaignError || err.status) {
      res.status(err.status || 400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * POST /api/creches/:crecheId/campaigns/:campaignId/supersede
 * Supersedes a campaign with a new version.
 */
router.post("/:campaignId/supersede", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const crecheId = parseCrecheId(req);
    const campaignId = parseCampaignId(req);
    const actor = getActor(req);
    assertCanManageCampaign(actor);

    const idempotencyKey = getIdempotencyKey(req);
    const { reason, newCampaign } = req.body || {};

    const result = await CrecheCampaignService.supersede(
      crecheId,
      campaignId,
      actor,
      reason,
      newCampaign,
      idempotencyKey
    );
    res.json(result);
  } catch (err: any) {
    if (err instanceof CrecheCampaignError || err.status) {
      res.status(err.status || 400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

export default router;
