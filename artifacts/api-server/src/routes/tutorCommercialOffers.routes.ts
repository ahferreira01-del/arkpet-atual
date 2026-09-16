import { Router, Request, Response, NextFunction } from "express";
import { type AuthRequest } from "../middlewares/authenticate.js";
import { TutorCommercialExperienceService } from "../services/tutorCommercialExperience.service.js";
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

export function resolveTargetTutorId(
  user: { id: number; role: string },
  queryTutorId?: unknown
): number {
  if (user.role === "tutor") {
    // IDOR defense: if tutor supplies a query tutorId differing from their own session id, reject with 403
    if (queryTutorId != null && Number(queryTutorId) !== user.id) {
      throw new CrecheCampaignForbiddenError(
        "Acesso negado: não é permitido consultar benefícios comerciais de outro tutor."
      );
    }
    return user.id;
  }
  if (user.role === "creche_admin" || user.role === "staff" || user.role === "master_admin") {
    const qTutorId = queryTutorId ? Number(queryTutorId) : null;
    if (!qTutorId || Number.isNaN(qTutorId) || qTutorId <= 0) {
      throw new CrecheCampaignValidationError("O parâmetro tutorId é obrigatório para visualização administrativa.");
    }
    return qTutorId;
  }
  throw new CrecheCampaignForbiddenError("Perfil não autorizado para consultar benefícios comerciais.");
}

/**
 * GET /api/creches/:crecheId/tutor/commercial-offers
 * Returns authoritative commercial offers and eligible promotional previews for a tutor.
 * IDOR safe: tutors can only access their own offers.
 */
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const crecheId = parseCrecheId(req);
    const user = (req as AuthRequest).user;
    if (!user) {
      throw Object.assign(new Error("Não autenticado."), { status: 401 });
    }

    const targetTutorId = resolveTargetTutorId(user, req.query.tutorId);

    const result = await TutorCommercialExperienceService.getTutorCommercialOffers(
      crecheId,
      targetTutorId
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
