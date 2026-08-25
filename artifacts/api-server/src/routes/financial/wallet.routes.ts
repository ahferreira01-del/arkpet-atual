import { Router, type Response, type NextFunction } from "express";
import { authenticate, type AuthRequest } from "../../middlewares/authenticate.js";
import { validate } from "../../middlewares/validate.js";
import { z } from "zod";
import { WalletService } from "../../services/wallet.js";
import { BillingService } from "../../services/billing.js";
import { CatalogueRepository } from "../../repositories/catalogue.repository.js";
import { InvoiceRepository } from "../../repositories/invoice.repository.js";
import { logFinancialAudit } from "../../services/audit.js";
import { getUncachableStripeClient } from "../../lib/stripeClient.js";
import { getPaginationParams } from "../../repositories/shared.js";
import { requireFinancialAccess } from "./middleware.js";

const router = Router({ mergeParams: true });
router.use(authenticate);

// ── Schemas ──────────────────────────────────────────────────────────────────

const creditsPackageSchema = z.object({
  tutorId: z.number().int().positive(),
  totalCredits: z.number().int().positive(),
  maxPetsPerDay: z.number().int().min(1).default(1),
  expirationDate: z.string().optional().nullable(),
});

const purchasePackageSchema = z.object({
  packageId: z.number().int().positive(),
  tutorId: z.number().int().positive(),
});

// ── GET /packages/balance ────────────────────────────────────────────────────
// Must be before GET /packages to avoid route ambiguity

router.get("/balance", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    if (req.user!.role !== "tutor" && req.user!.role !== "creche_admin") {
      res.status(403).json({ error: "Acesso não autorizado." });
      return;
    }
    const tutorId = req.user!.role === "tutor" ? req.user!.id : (req.query.tutorId ? Number(req.query.tutorId) : req.user!.id);
    const balance = await WalletService.getBalance(tutorId, crecheId);
    res.json(balance);
  } catch (err) {
    next(err);
  }
});

// ── GET /packages ────────────────────────────────────────────────────────────

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    if (req.user!.role !== "creche_admin" && req.user!.role !== "tutor") {
      res.status(403).json({ error: "Acesso não autorizado." });
      return;
    }
    const { page, pageSize, offset } = getPaginationParams(req.query);
    let tutorId: number | null = null;
    if (req.user!.role === "tutor") {
      tutorId = req.user!.id;
    } else if (req.query.tutorId) {
      tutorId = Number(req.query.tutorId);
    }
    const result = await WalletService.listPackages(crecheId, tutorId, pageSize, offset);
    res.json({ ...result, page, pageSize, totalPages: Math.ceil(result.total / pageSize) });
  } catch (err) {
    next(err);
  }
});

// ── POST /packages ────────────────────────────────────────────────────────────

router.post(
  "/",
  requireFinancialAccess,
  validate(creditsPackageSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const crecheId = Number(req.params.crecheId);
      const { tutorId, totalCredits, expirationDate, maxPetsPerDay } = req.body;
      const credits = await WalletService.createManualPackage(
        crecheId,
        tutorId,
        totalCredits,
        maxPetsPerDay || 1,
        expirationDate,
        req.user!.id
      );
      res.json(credits);
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /packages/purchase ───────────────────────────────────────────────────

router.post(
  "/purchase",
  validate(purchasePackageSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const crecheId = Number(req.params.crecheId);
      if (req.user!.role !== "creche_admin" && req.user!.role !== "tutor") {
        res.status(403).json({ error: "Acesso não autorizado." });
        return;
      }
      const { packageId, tutorId, paymentMethod } = req.body;
      if (req.user!.role === "tutor" && tutorId !== req.user!.id) {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }

      const item = await CatalogueRepository.findPackage(packageId, crecheId);
      if (!item) { res.status(404).json({ error: "Pacote não encontrado" }); return; }
      if (!item.creditsAmount || item.creditsAmount <= 0) {
        res.status(422).json({ error: "Este pacote não possui créditos configurados" }); return;
      }
      if (!item.basePrice || Number(item.basePrice) <= 0) {
        res.status(422).json({ error: "Este pacote não possui preço definido. Configure o preço antes de vender." }); return;
      }

      const { invoiceId } = await BillingService.addCharge({
        crecheId,
        tutorId,
        amount: item.basePrice,
        description: item.name,
        type: "package",
        itemDate: new Date(),
        isAvulso: true,
        userId: req.user!.id,
        catalogueItemId: item.id,
        creditsAmount: item.creditsAmount ?? undefined,
        snapshotMaxPets: item.maxPetsPerDay ?? undefined,
        snapshotExpiration: 365,
      });

      await logFinancialAudit({
        crecheId,
        userId: tutorId,
        action: "credits_purchase",
        referenceId: invoiceId,
        referenceType: "invoices",
        details: `Pacote "${item.name}" solicitado. ${item.creditsAmount} créditos aguardando pagamento. Fatura #${invoiceId}.`,
      });

      let checkoutUrl: string | null = null;
      if (paymentMethod === "stripe") {
        const stripeClient = await getUncachableStripeClient();
        if (stripeClient) {
          const session = await stripeClient.checkout.sessions.create({
            mode: "payment",
            line_items: [{
              price_data: {
                currency: "brl",
                product_data: { name: item.name, description: `${item.creditsAmount} diárias` },
                unit_amount: Math.round(Number(item.basePrice)),
              },
              quantity: 1,
            }],
            metadata: {
              invoiceId: invoiceId.toString(),
              crecheId: crecheId.toString(),
              tutorId: tutorId.toString(),
              creditsAmount: item.creditsAmount.toString(),
              packagePurchase: "true",
            },
            success_url: `${process.env.FRONTEND_URL}/tutor/financial?highlight=invoice-${invoiceId}&purchased=true`,
            cancel_url: `${process.env.FRONTEND_URL}/tutor/store`,
          });

          await InvoiceRepository.setStripePaymentIntent(
            invoiceId,
            session.payment_intent as string
          );
          checkoutUrl = session.url;
        }
      }

      res.status(201).json({
        invoiceId,
        checkoutUrl,
        message:
          paymentMethod === "stripe"
            ? "Redirecionando para pagamento..."
            : `Fatura #${invoiceId} gerada. Realize o pagamento para liberar suas diárias.`,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
