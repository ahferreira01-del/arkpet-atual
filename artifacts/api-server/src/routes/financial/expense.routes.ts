import { Router, type Response, type NextFunction } from "express";
import { authenticate, type AuthRequest } from "../../middlewares/authenticate.js";
import { validate } from "../../middlewares/validate.js";
import { z } from "zod";
import { db } from "@workspace/db";
import { ExpenseRepository } from "../../repositories/expense.repository.js";
import { ExpenseService } from "../../services/expense.js";
import { logFinancialAudit } from "../../services/audit.js";
import { requireFinancialAccess } from "./middleware.js";
import { acquireTenantOperationalLock, TenantArchivedError } from "../../services/tenantLifecycleLock.js";

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

      const expense = await db.transaction(async (tx) => {
        await acquireTenantOperationalLock(crecheId, tx);

        const created = await ExpenseRepository.create({
          crecheId,
          description: data.description,
          category: data.category,
          amount: data.amount.toString(),
          dueDate: new Date(data.dueDate).toISOString().split("T")[0],
          supplier: data.supplier,
          notes: data.notes,
        }, tx);

        await logFinancialAudit({
          crecheId,
          userId: req.user!.id,
          action: "manual_payment_register",
          referenceId: created.id,
          referenceType: "expenses",
          details: `Despesa criada: ${data.description}`,
        }, tx);

        return created;
      });

      res.status(201).json(expense);
    } catch (err: any) {
      if (err instanceof TenantArchivedError || err?.code === "tenant_archived" || err?.message === "tenant_archived") {
        res.status(403).json({ error: "tenant_archived", code: "tenant_archived", message: "Esta creche foi arquivada. Operações desabilitadas." });
        return;
      }
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

      const expense = await db.transaction(async (tx) => {
        await acquireTenantOperationalLock(crecheId, tx);

        return ExpenseRepository.update(id, crecheId, {
          description: data.description,
          category: data.category,
          amount: data.amount.toString(),
          dueDate: new Date(data.dueDate).toISOString().split("T")[0],
          supplier: data.supplier,
          notes: data.notes,
        }, tx);
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
    } catch (err: any) {
      if (err instanceof TenantArchivedError || err?.code === "tenant_archived" || err?.message === "tenant_archived") {
        res.status(403).json({ error: "tenant_archived", code: "tenant_archived", message: "Esta creche foi arquivada. Operações desabilitadas." });
        return;
      }
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
  } catch (err: any) {
    if (err instanceof TenantArchivedError || err?.code === "tenant_archived" || err?.message === "tenant_archived") {
      res.status(403).json({ error: "tenant_archived", code: "tenant_archived", message: "Esta creche foi arquivada. Operações desabilitadas." });
      return;
    }
    next(err);
  }
});

// ── DELETE /expenses/:id ──────────────────────────────────────────────────────

router.delete("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const id = Number(req.params.id);

    const deleted = await db.transaction(async (tx) => {
      await acquireTenantOperationalLock(crecheId, tx);

      const del = await ExpenseRepository.delete(id, crecheId, tx);
      if (del) {
        await logFinancialAudit({
          crecheId,
          userId: req.user!.id,
          action: "invoice_void",
          referenceId: id,
          referenceType: "expenses",
          details: "Despesa excluída.",
        }, tx);
      }
      return del;
    });

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

    res.json({ ok: true });
  } catch (err: any) {
    if (err instanceof TenantArchivedError || err?.code === "tenant_archived" || err?.message === "tenant_archived") {
      res.status(403).json({ error: "tenant_archived", code: "tenant_archived", message: "Esta creche foi arquivada. Operações desabilitadas." });
      return;
    }
    next(err);
  }
});

export default router;
