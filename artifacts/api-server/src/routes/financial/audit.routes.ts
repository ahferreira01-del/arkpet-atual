import { Router, type Response, type NextFunction } from "express";
import { authenticate, type AuthRequest } from "../../middlewares/authenticate.js";
import { logFinancialAudit, listAuditLogs } from "../../services/audit.js";
import { requireFinancialAccess } from "./middleware.js";

const router = Router({ mergeParams: true });
router.use(authenticate);

// ── GET /audit ────────────────────────────────────────────────────────────────

router.get(
  "/",
  requireFinancialAccess,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const crecheId = Number(req.params.crecheId);
      if (req.user?.role !== "creche_admin") {
        res.status(403).json({
          error: "Acesso negado. Apenas gestores podem visualizar trilhas de auditoria.",
        });
        return;
      }

      // Log the access to sensitive data itself
      await logFinancialAudit({
        crecheId,
        userId: req.user.id,
        action: "sensitive_data_read",
        referenceId: 0,
        referenceType: "financial_audit_logs",
        details: "Gestor acessou a trilha de auditoria financeira.",
      });

      const logs = await listAuditLogs(crecheId);
      res.json(logs);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
