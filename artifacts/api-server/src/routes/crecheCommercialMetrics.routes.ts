import { Router, Request, Response, NextFunction } from "express";
import { type AuthRequest } from "../middlewares/authenticate.js";
import {
  CrecheCommercialMetricsService,
  type MetricsActorContext,
  type MetricsDateFilter,
} from "../services/crecheCommercialMetrics.service.js";
import {
  CrecheCampaignError,
  CrecheCampaignForbiddenError,
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

function getActor(req: Request): MetricsActorContext {
  const user = (req as AuthRequest).user;
  if (!user) {
    throw Object.assign(new Error("Não autenticado."), { status: 401 });
  }
  return {
    userId: user.id,
    role: user.role,
    crecheId: user.crecheId,
    source: "http",
  };
}

function parseFilter(req: Request): MetricsDateFilter {
  const { period, startDate, endDate } = req.query;
  const filter: MetricsDateFilter = {};
  if (typeof period === "string" && ["7d", "30d", "90d", "all", "custom"].includes(period)) {
    filter.period = period as MetricsDateFilter["period"];
  }
  if (typeof startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    filter.startDate = startDate;
  }
  if (typeof endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    filter.endDate = endDate;
  }
  return filter;
}

/**
 * GET /api/creches/:crecheId/marketing/metrics/overview
 * Overview metrics of campaigns, redemptions, and optional financial totals.
 */
router.get("/overview", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const crecheId = parseCrecheId(req);
    const actor = getActor(req);
    const filter = parseFilter(req);

    const result = await CrecheCommercialMetricsService.getCampaignOverviewMetrics(
      crecheId,
      filter,
      actor
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

/**
 * GET /api/creches/:crecheId/marketing/metrics/campaigns/:campaignId
 * Detail metrics for a specific promotional campaign.
 */
router.get("/campaigns/:campaignId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const crecheId = parseCrecheId(req);
    const campaignId = parseCampaignId(req);
    const actor = getActor(req);

    const result = await CrecheCommercialMetricsService.getCampaignDetailMetrics(
      crecheId,
      campaignId,
      actor
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

/**
 * GET /api/creches/:crecheId/marketing/metrics/conditions
 * Metrics for R37.B tutor commercial conditions and their billing applications.
 */
router.get("/conditions", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const crecheId = parseCrecheId(req);
    const actor = getActor(req);
    const filter = parseFilter(req);

    const result = await CrecheCommercialMetricsService.getTutorConditionMetrics(
      crecheId,
      filter,
      actor
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

/**
 * GET /api/creches/:crecheId/marketing/metrics/crm
 * Metrics for campaigns created from CRM opportunities.
 */
router.get("/crm", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const crecheId = parseCrecheId(req);
    const actor = getActor(req);

    const result = await CrecheCommercialMetricsService.getCrmOriginMetrics(
      crecheId,
      actor
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
