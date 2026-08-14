import { Router, type Response, type NextFunction } from "express";
import { authenticate, type AuthRequest } from "../../middlewares/authenticate.js";
import { WalletService } from "../../services/wallet.js";
import { getPaginationParams } from "../../repositories/shared.js";

const router = Router({ mergeParams: true });
router.use(authenticate);

// ── GET /service-credits ─────────────────────────────────────────────────────

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const { page, pageSize, offset } = getPaginationParams(req.query);
    let tutorId: number | null = null;
    if (req.user!.role === "tutor") {
      tutorId = req.user!.id;
    } else if (req.query.tutorId) {
      tutorId = Number(req.query.tutorId);
    } else {
      res.status(400).json({ error: "tutorId é obrigatório." });
      return;
    }
    const result = await WalletService.listServiceCredits(crecheId, tutorId, pageSize, offset);
    res.json({ ...result, page, pageSize, totalPages: Math.ceil(result.total / pageSize) });
  } catch (err) {
    next(err);
  }
});

export default router;
