import { Router, type Response, type NextFunction } from "express";
import { authenticate, type AuthRequest } from "../../middlewares/authenticate.js";
import { validate } from "../../middlewares/validate.js";
import { z } from "zod";
import { BillingService } from "../../services/billing.js";
import { requireFinancialAccess } from "./middleware.js";

const router = Router({ mergeParams: true });
router.use(authenticate);
router.use(requireFinancialAccess);

const refundItemSchema = z.object({
  invoiceItemId: z.number(),
  quantity: z.number().int().positive(),
});

// ── POST /invoices/:invoiceId/refund-item ─────────────────────────────────────

router.post(
  "/:invoiceId/refund-item",
  validate(refundItemSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const crecheId = Number(req.params.crecheId);
      const invoiceId = Number(req.params.invoiceId);
      const { invoiceItemId, quantity } = req.body;

      await BillingService.refundItem({
        invoiceId,
        crecheId,
        invoiceItemId,
        quantity,
        userId: req.user!.id,
      });

      res.status(200).json({ ok: true });
    } catch (err: any) {
      if (err.status === 404) {
        res.status(404).json({ error: err.message });
      } else if (err.status === 400 || (err.message && err.message.includes("Estoque"))) {
        res.status(400).json({ error: err.message });
      } else {
        next(err);
      }
    }
  }
);

export default router;
