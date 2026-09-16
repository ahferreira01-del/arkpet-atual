import { Router, Request, Response, NextFunction } from "express";
import { type AuthRequest } from "../middlewares/authenticate.js";
import { CrecheMarketingOpportunityService } from "../services/crecheMarketingOpportunity.service.js";
import {
  CrecheCampaignError,
  CrecheCampaignForbiddenError,
  CrecheCampaignValidationError,
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

function getActor(req: Request) {
  const user = (req as AuthRequest).user;
  if (!user) {
    throw Object.assign(new Error("Não autenticado."), { status: 401 });
  }
  return {
    userId: user.id,
    role: user.role,
    source: "http" as const,
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
 * Common RBAC check for CRM opportunity read endpoints:
 * creche_admin and staff can view opportunities. Tutors get 403.
 */
function assertCanReadOpportunities(actor: { role: string }) {
  if (actor.role === "tutor") {
    throw new CrecheCampaignForbiddenError("Tutores não possuem acesso ao CRM de oportunidades.");
  }
  if (actor.role !== "creche_admin" && actor.role !== "staff" && actor.role !== "master_admin") {
    throw new CrecheCampaignForbiddenError("Acesso restrito à gestão da creche.");
  }
}

/**
 * GET /api/creches/:crecheId/marketing/opportunities/inactive
 * Query params: days (default 60), page (default 1), pageSize (default 20)
 */
router.get("/inactive", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const crecheId = parseCrecheId(req);
    const actor = getActor(req);
    assertCanReadOpportunities(actor);

    const days = req.query.days ? Number(req.query.days) : 60;
    const page = req.query.page ? Number(req.query.page) : 1;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 20;

    const result = await CrecheMarketingOpportunityService.getInactiveTutors({
      crecheId,
      days,
      page,
      pageSize,
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
 * GET /api/creches/:crecheId/marketing/opportunities/new
 * Query params: days (default 30), page (default 1), pageSize (default 20)
 */
router.get("/new", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const crecheId = parseCrecheId(req);
    const actor = getActor(req);
    assertCanReadOpportunities(actor);

    const days = req.query.days ? Number(req.query.days) : 30;
    const page = req.query.page ? Number(req.query.page) : 1;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 20;

    const result = await CrecheMarketingOpportunityService.getNewTutors({
      crecheId,
      days,
      page,
      pageSize,
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
 * GET /api/creches/:crecheId/marketing/opportunities/never-used
 * Query params: catalogueItemId (required), page (default 1), pageSize (default 20)
 */
router.get("/never-used", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const crecheId = parseCrecheId(req);
    const actor = getActor(req);
    assertCanReadOpportunities(actor);

    const catalogueItemId = req.query.catalogueItemId ? Number(req.query.catalogueItemId) : null;
    if (!catalogueItemId || Number.isNaN(catalogueItemId) || catalogueItemId <= 0) {
      throw new CrecheCampaignValidationError("catalogueItemId é obrigatório e deve ser um número positivo.");
    }

    const page = req.query.page ? Number(req.query.page) : 1;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 20;

    const result = await CrecheMarketingOpportunityService.getTutorsWhoNeverUsedService({
      crecheId,
      catalogueItemId,
      page,
      pageSize,
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
 * POST /api/creches/:crecheId/marketing/opportunities/create-draft
 * Creates a DRAFT campaign with SELECTED_TUTORS materialized from an opportunity.
 * Strictly creche_admin only (staff and tutor get 403).
 */
router.post("/create-draft", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const crecheId = parseCrecheId(req);
    const actor = getActor(req);

    if (actor.role === "tutor") {
      throw new CrecheCampaignForbiddenError("Tutores não possuem acesso à criação de campanhas.");
    }
    if (actor.role === "staff") {
      throw new CrecheCampaignForbiddenError("Funcionários não possuem permissão para criar campanhas a partir de oportunidades.");
    }
    if (actor.role !== "creche_admin") {
      throw new CrecheCampaignForbiddenError("Apenas o administrador da creche pode criar campanhas a partir de oportunidades.");
    }

    const { opportunityType, days, catalogueItemId, campaignName } = req.body || {};
    if (!opportunityType || !["INACTIVE_TUTORS", "NEW_TUTORS", "NEVER_USED_SERVICE"].includes(opportunityType)) {
      throw new CrecheCampaignValidationError(
        "opportunityType deve ser 'INACTIVE_TUTORS', 'NEW_TUTORS' ou 'NEVER_USED_SERVICE'."
      );
    }

    if (opportunityType === "NEVER_USED_SERVICE" && (!catalogueItemId || Number.isNaN(Number(catalogueItemId)))) {
      throw new CrecheCampaignValidationError("catalogueItemId é obrigatório para a oportunidade NEVER_USED_SERVICE.");
    }

    const idempotencyKey = getIdempotencyKey(req);

    const campaign = await CrecheMarketingOpportunityService.createCampaignDraftFromOpportunity({
      crecheId,
      opportunityType,
      days: days ? Number(days) : undefined,
      catalogueItemId: catalogueItemId ? Number(catalogueItemId) : undefined,
      campaignName,
      actor,
      idempotencyKey,
    });

    res.status(201).json({
      success: true,
      message: "Rascunho de campanha criado com sucesso a partir da oportunidade.",
      campaign,
    });
  } catch (err: any) {
    if (err instanceof CrecheCampaignError || err.status) {
      res.status(err.status || 400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

export default router;
