import { Router, type Response, type NextFunction } from "express";
import { authenticate, type AuthRequest } from "../../middlewares/authenticate.js";
import { validate } from "../../middlewares/validate.js";
import { z } from "zod";
import { InvoiceRepository } from "../../repositories/invoice.repository.js";
import { financialLog } from "../../lib/logger.js";
import { getPaginationParams } from "../../repositories/shared.js";
import {
  processManualPayment,
  approveReceipt,
  voidInvoice,
  refundInvoice,
  BillingService,
} from "../../services/billing.js";
import { logFinancialAudit } from "../../services/audit.js";
import { getUncachableStripeClient } from "../../lib/stripeClient.js";
import { ObjectStorageService } from "../../lib/objectStorage.js";
import { decrypt } from "../../lib/crypto.js";
import { db } from "@workspace/db";
import { crechesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireFinancialAccess } from "./middleware.js";
import { sendPushToUser, sendPushToRole } from "../../lib/push.js";

const router = Router({ mergeParams: true });
router.use(authenticate);

const objectStorageService = new ObjectStorageService();

// ── Schemas ──────────────────────────────────────────────────────────────────

const payManualSchema = z.object({
  paymentMethod: z.enum(["cash", "pix", "credit_card", "bank_slip"]),
});

const uploadReceiptSchema = z.object({
  receiptPhotoPath: z.string().min(1),
});

// ── GET /invoices ────────────────────────────────────────────────────────────

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const { page, pageSize, offset } = getPaginationParams(req.query);
    const tutorId = req.user!.role === "tutor" ? req.user!.id : null;
    const result = await InvoiceRepository.listByCreche(crecheId, tutorId, pageSize, offset);
    res.json({ ...result, page, pageSize, totalPages: Math.ceil(result.total / pageSize) });
  } catch (err) {
    next(err);
  }
});

// ── GET /invoices/awaiting-count ─────────────────────────────────────────────
// Must be declared before /:invoiceId routes so Express does not match it as an ID.

router.get(
  "/awaiting-count",
  requireFinancialAccess,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const count = await InvoiceRepository.countAwaitingConfirmation(Number(req.params.crecheId));
      res.json({ count });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /invoices/:invoiceId/items ───────────────────────────────────────────

router.get(
  "/:invoiceId/items",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const crecheId = Number(req.params.crecheId);
      const invoiceId = Number(req.params.invoiceId);

      const invoice = req.user!.role === "tutor"
        ? await InvoiceRepository.findByIdAndCreche(invoiceId, crecheId)
        : await InvoiceRepository.findByIdAndCreche(invoiceId, crecheId);

      if (!invoice) { res.status(404).json({ error: "Fatura não encontrada" }); return; }
      if (req.user!.role === "tutor" && invoice.tutorId !== req.user!.id) {
        res.status(403).json({ error: "Acesso negado" }); return;
      }

      const items = await InvoiceRepository.findItemsWithPetNames(invoiceId);
      res.json(items);
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /invoices/:invoiceId/receipt-url ─────────────────────────────────────

router.get(
  "/:invoiceId/receipt-url",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const crecheId = Number(req.params.crecheId);
      const invoiceId = Number(req.params.invoiceId);

      if (req.user!.role === "tutor") {
        const owned = await InvoiceRepository.findById(invoiceId);
        if (!owned || owned.tutorId !== req.user!.id) {
          res.status(403).json({ error: "Não autorizado" }); return;
        }
      } else if (req.user!.role !== "master_admin" && req.user!.crecheId !== crecheId) {
        res.status(403).json({ error: "Não autorizado" }); return;
      }

      const invoice = await InvoiceRepository.findByIdAndCreche(invoiceId, crecheId);
      if (!invoice || !invoice.receiptPhotoPath) {
        res.status(404).json({ error: "Comprovante não encontrado" }); return;
      }

      if (invoice.receiptPhotoPath.startsWith("data:")) {
        res.json({ url: invoice.receiptPhotoPath }); return;
      }

      const url = await objectStorageService.getSignedReadURL(invoice.receiptPhotoPath, 300);

      await logFinancialAudit({
        crecheId,
        userId: req.user!.id,
        action: "sensitive_data_read",
        referenceId: invoice.id,
        referenceType: "invoices",
        details: `Gerou URL temporária para comprovante da fatura #${invoice.id}`,
      });

      res.json({ url });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /invoices/:invoiceId/receipt-data ────────────────────────────────────

router.get(
  "/:invoiceId/receipt-data",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const crecheId = Number(req.params.crecheId);
      const invoiceId = Number(req.params.invoiceId);

      // Auth check
      if (req.user!.role === "tutor") {
        const inv = await InvoiceRepository.findByIdAndCreche(invoiceId, crecheId);
        if (!inv || inv.tutorId !== req.user!.id) {
          res.status(403).json({ error: "Não autorizado" }); return;
        }
      } else if (req.user!.crecheId !== crecheId && req.user!.role !== "master_admin") {
        res.status(403).json({ error: "Não autorizado" }); return;
      }

      const invoiceData = await InvoiceRepository.findReceiptData(invoiceId, crecheId);
      if (!invoiceData) { res.status(404).json({ error: "Fatura não encontrada" }); return; }

      const items = await InvoiceRepository.findItemsByInvoiceId(invoiceId);

      const [creche] = await db
        .select({ name: crechesTable.name, address: crechesTable.address, phone: crechesTable.phone })
        .from(crechesTable)
        .where(eq(crechesTable.id, crecheId));

      let decryptedCpf: string | null = null;
      if (invoiceData.tutorCpf) {
        try { decryptedCpf = decrypt(invoiceData.tutorCpf); } catch {}
      }

      res.json({
        invoice: invoiceData.invoice,
        tutor: { name: invoiceData.tutorName, cpf: decryptedCpf },
        items,
        creche,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /invoices/:invoiceId/stripe-checkout ─────────────────────────────────

router.post(
  "/:invoiceId/stripe-checkout",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const crecheId = Number(req.params.crecheId);
      const invoiceId = Number(req.params.invoiceId);

      const invoice = await InvoiceRepository.findByIdAndCreche(invoiceId, crecheId);
      if (!invoice) { res.status(404).json({ error: "Fatura não encontrada" }); return; }
      if (req.user!.role === "tutor" && invoice.tutorId !== req.user!.id) {
        res.status(403).json({ error: "Acesso negado" }); return;
      }

      const stripe = await getUncachableStripeClient();
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card", "pix"],
        line_items: [{
          price_data: {
            currency: "brl",
            product_data: { name: `Fatura #${invoiceId}` },
            unit_amount: Math.round(Number(invoice.amount) * 100),
          },
          quantity: 1,
        }],
        mode: "payment",
        success_url: `${req.headers.origin}/tutor/financial?success=true&invoiceId=${invoiceId}`,
        cancel_url: `${req.headers.origin}/tutor/financial?canceled=true`,
        metadata: { invoiceId: String(invoiceId), crecheId: String(crecheId) },
      });

      res.json({ checkoutUrl: session.url });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /invoices/:invoiceId/upload-receipt ─────────────────────────────────

router.post(
  "/:invoiceId/upload-receipt",
  validate(uploadReceiptSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const crecheId = Number(req.params.crecheId);
      const invoiceId = Number(req.params.invoiceId);
      const { receiptPhotoPath } = req.body;

      const invoice = await InvoiceRepository.findByIdAndCreche(invoiceId, crecheId);
      if (!invoice) { res.status(404).json({ error: "Fatura não encontrada" }); return; }
      if (req.user!.role === "tutor" && invoice.tutorId !== req.user!.id) {
        res.status(403).json({ error: "Acesso negado" }); return;
      }

      await InvoiceRepository.markAwaitingConfirmation(invoiceId, receiptPhotoPath);

      logFinancialAudit({
        crecheId,
        userId: req.user!.id,
        action: "payment_receipt_upload",
        referenceId: invoiceId,
        referenceType: "invoices",
        details: "Tutor enviou comprovante de pagamento.",
      }).catch((err: unknown) => financialLog({ operation: "audit_log_failed", level: "error", invoiceId, error: String(err) }));

      // Notify creche admins that a receipt is waiting for confirmation.
      sendPushToRole(crecheId, "creche_admin", {
        title: "📎 Comprovante recebido",
        body: `Um tutor enviou um comprovante para a Fatura #${invoiceId}. Confirme o pagamento no Financeiro.`,
        tag: `invoice-receipt-${invoiceId}`,
        data: { type: "invoice_receipt", invoiceId },
      }).catch(() => {});

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /invoices/:invoiceId/pay-manual ─────────────────────────────────────

router.post(
  "/:invoiceId/pay-manual",
  requireFinancialAccess,
  validate(payManualSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const paid = await processManualPayment(
        Number(req.params.invoiceId),
        Number(req.params.crecheId),
        req.user!.id,
        req.body.paymentMethod
      );
      // Notify the tutor that their invoice was settled manually.
      if (paid.tutorId) {
        const fmtAmt = (Number(paid.amount) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        sendPushToUser(paid.tutorId, {
          title: "✅ Fatura paga",
          body: `Sua fatura de ${fmtAmt} foi confirmada pela creche.`,
          tag: `invoice-paid-${paid.id}`,
          data: { type: "invoice_paid", invoiceId: paid.id },
        }).catch(() => {});
      }
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }
);

// ── POST /invoices/:invoiceId/approve-receipt ────────────────────────────────

router.post(
  "/:invoiceId/approve-receipt",
  requireFinancialAccess,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const approved = await approveReceipt(
        Number(req.params.invoiceId),
        Number(req.params.crecheId),
        req.user!.id
      );
      // Notify the tutor that their receipt was accepted.
      if (approved.tutorId) {
        const fmtAmt = (Number(approved.amount) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        sendPushToUser(approved.tutorId, {
          title: "✅ Comprovante aprovado",
          body: `Seu comprovante da fatura de ${fmtAmt} foi aceito. Pagamento confirmado!`,
          tag: `invoice-paid-${approved.id}`,
          data: { type: "invoice_paid", invoiceId: approved.id },
        }).catch(() => {});
      }
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }
);

// ── POST /invoices/:invoiceId/void ───────────────────────────────────────────

router.post(
  "/:invoiceId/void",
  requireFinancialAccess,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const voided = await voidInvoice(
        Number(req.params.invoiceId),
        Number(req.params.crecheId),
        req.user!.id
      );
      // Notify the tutor that their invoice was cancelled.
      if (voided.tutorId) {
        sendPushToUser(voided.tutorId, {
          title: "❌ Fatura cancelada",
          body: `Sua Fatura #${voided.id} foi cancelada pela creche.`,
          tag: `invoice-voided-${voided.id}`,
          data: { type: "invoice_voided", invoiceId: voided.id },
        }).catch(() => {});
      }
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }
);

// ── POST /invoices/:invoiceId/refund ─────────────────────────────────────────

router.post(
  "/:invoiceId/refund",
  requireFinancialAccess,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const refunded = await refundInvoice(
        Number(req.params.invoiceId),
        Number(req.params.crecheId),
        req.user!.id
      );
      // Notify the tutor that their invoice was refunded.
      if (refunded.tutorId) {
        const fmtAmt = (Number(refunded.amount) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        sendPushToUser(refunded.tutorId, {
          title: "↩️ Pagamento estornado",
          body: `Sua fatura de ${fmtAmt} foi estornada pela creche.`,
          tag: `invoice-refunded-${refunded.id}`,
          data: { type: "invoice_refunded", invoiceId: refunded.id },
        }).catch(() => {});
      }
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }
);

export default router;
