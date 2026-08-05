import { Router, type Response, type NextFunction } from "express";
import { authenticate, type AuthRequest } from "../../middlewares/authenticate.js";
import { validate } from "../../middlewares/validate.js";
import { z } from "zod";
import { PosService } from "../../services/pos.js";
import { requireFinancialAccess } from "./middleware.js";

const router = Router({ mergeParams: true });
router.use(authenticate);

const posSaleSchema = z.object({
  items: z.array(
    z.object({
      catalogueItemId: z.number(),
      quantity: z.number().int().positive(),
    })
  ).min(1),
  paymentMethod: z.string().optional(),
  tutorId: z.number().optional().nullable(),
});

// ── POST /pos-sale ────────────────────────────────────────────────────────────

router.post(
  "/",
  requireFinancialAccess,
  validate(posSaleSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const crecheId = Number(req.params.crecheId);
      const { items, paymentMethod, tutorId } = req.body;
      const result = await PosService.processSale({
        crecheId,
        items,
        paymentMethod,
        tutorId,
        userId: req.user!.id,
      });
      res.status(201).json(result);
    } catch (err: any) {
      if (err.message && err.message.includes("Estoque")) {
        res.status(400).json({ error: err.message });
      } else if (err.status === 422) {
        res.status(422).json({ error: err.message });
      } else {
        next(err);
      }
    }
  }
);

export default router;
