import { Router, type Response, type NextFunction } from "express";
import { authenticate, type AuthRequest } from "../../middlewares/authenticate.js";
import { validate } from "../../middlewares/validate.js";
import { z } from "zod";
import { ExpenseRepository } from "../../repositories/expense.repository.js";
import { ExpenseService } from "../../services/expense.js";
import { logFinancialAudit } from "../../services/audit.js";
import { requireFinancialAccess } from "./middleware.js";

const router = Router({ mergeParams: true });
router.use(authenticate);
router.use(requireFinancialAccess);

const expenseSchema = z.object({
  description: z.string().min(1),
  category: z.string().min(1),
  amount: z.number().int().positive(),
  dueDate: z.string().min(1),
  supplier: z.string().optional(),
  notes: z.string().optional(),
});

// ── GET /expenses ─────────────────────────────────────────────────────────────

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const expenses = await ExpenseRepository.list(Number(req.params.crecheId));
    res.json(expenses);
  } catch (err) {
    next(err);
  }
});

// ── POST /expenses ────────────────────────────────────────────────────────────

router.post(
  "/",
  validate(expenseSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const crecheId = Number(req.params.crecheId);
      const data = req.body;
      const expense = await ExpenseRepository.create({
        crecheId,
        description: data.description,
        category: data.category,
        amount: data.amount.toString(),
        dueDate: new Date(data.dueDate).toISOString().split("T")[0],
        supplier: data.supplier,
        notes: data.notes,
      });

      await logFinancialAudit({
        crecheId,
        userId: req.user!.id,
        action: "manual_payment_register",
        referenceId: expense.id,
        referenceType: "expenses",
        details: `Despesa criada: ${data.description}`,
      });

      res.status(201).json(expense);
    } catch (err) {
      next(err);
    }
  }
);

// ── PUT /expenses/:id ─────────────────────────────────────────────────────────

router.put(
  "/:id",
  validate(expenseSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const crecheId = Number(req.params.crecheId);
      const id = Number(req.params.id);
      const data = req.body;

      const expense = await ExpenseRepository.update(id, crecheId, {
        description: data.description,
        category: data.category,
        amount: data.amount.toString(),
        dueDate: new Date(data.dueDate).toISOString().split("T")[0],
        supplier: data.supplier,
        notes: data.notes,
      });

      if (!expense) {
        const existing = await ExpenseRepository.findByIdAndCreche(id, crecheId);
        if (!existing) {
          res.status(404).json({ error: "Despesa não encontrada" });
          return;
        }
        if (existing.isPaid) {
          res.status(409).json({ error: "Não é possível editar uma despesa que já foi paga." });
          return;
        }
        res.status(400).json({ error: "Não foi possível atualizar a despesa." });
        return;
      }

      res.json(expense);
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /expenses/:id/pay ────────────────────────────────────────────────────

router.post("/:id/pay", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const id = Number(req.params.id);

    const existing = await ExpenseRepository.findByIdAndCreche(id, crecheId);
    if (!existing) { res.status(404).json({ error: "Despesa não encontrada" }); return; }
    if (existing.isPaid) { res.status(400).json({ error: "Despesa já está paga" }); return; }

    await ExpenseService.pay(id, crecheId, req.user!.id, req.body?.paymentMethod || "cash");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /expenses/:id ──────────────────────────────────────────────────────

router.delete("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const id = Number(req.params.id);

    const deleted = await ExpenseRepository.delete(id, crecheId);

    if (!deleted) {
      const existing = await ExpenseRepository.findByIdAndCreche(id, crecheId);
      if (!existing) {
        res.status(404).json({ error: "Despesa não encontrada" });
        return;
      }
      if (existing.isPaid) {
        res.status(409).json({ error: "Não é possível excluir uma despesa que já foi paga." });
        return;
      }
      res.status(400).json({ error: "Não foi possível excluir a despesa." });
      return;
    }

    await logFinancialAudit({
      crecheId,
      userId: req.user!.id,
      action: "invoice_void",
      referenceId: id,
      referenceType: "expenses",
      details: "Despesa excluída.",
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
