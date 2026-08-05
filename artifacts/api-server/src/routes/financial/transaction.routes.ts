import { Router, type Response, type NextFunction } from "express";
import { authenticate, type AuthRequest } from "../../middlewares/authenticate.js";
import { TransactionRepository } from "../../repositories/transaction.repository.js";
import { logFinancialAudit } from "../../services/audit.js";
import { requireFinancialAccess } from "./middleware.js";

const router = Router({ mergeParams: true });
router.use(authenticate);
router.use(requireFinancialAccess);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

// ── GET /dashboard/cash-flow ──────────────────────────────────────────────────

router.get("/cash-flow", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      res.status(400).json({ error: "startDate e endDate são obrigatórios" });
      return;
    }
    if (!DATE_RE.test(String(startDate)) || !DATE_RE.test(String(endDate))) {
      res.status(400).json({ error: "Formato de data inválido. Use YYYY-MM-DD" });
      return;
    }
    const start = String(startDate);
    const end = String(endDate);
    if (new Date(end).getTime() - new Date(start).getTime() > MAX_RANGE_MS) {
      res.status(400).json({ error: "O intervalo máximo permitido é de 366 dias" });
      return;
    }

    const cashFlow = await TransactionRepository.getCashFlow(crecheId, start, end);
    res.json(cashFlow);
  } catch (err) {
    next(err);
  }
});

// ── GET /dashboard/dre ───────────────────────────────────────────────────────

router.get("/dre", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const { startDate, endDate } = req.query;
    const start = startDate
      ? new Date(String(startDate)).toISOString().split("T")[0]
      : "1970-01-01";
    const end = endDate
      ? new Date(String(endDate)).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0];

    const aggregated = await TransactionRepository.getDRE(crecheId, start, end);

    let receitas = 0;
    let despesas = 0;
    for (const row of aggregated) {
      if (row.type === "income") receitas = Number(row.total);
      if (row.type === "expense") despesas = Number(row.total);
    }

    await logFinancialAudit({
      crecheId,
      userId: req.user!.id,
      action: "sensitive_data_read",
      referenceId: crecheId,
      referenceType: "dashboard",
      details: "DRE acessado.",
    });

    res.json({ receitas, despesas });
  } catch (err) {
    next(err);
  }
});

export default router;
