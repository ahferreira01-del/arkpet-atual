import { Router, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { authenticate, type AuthRequest } from "../../middlewares/authenticate.js";
import { validate } from "../../middlewares/validate.js";
import { z } from "zod";
import { CatalogueRepository } from "../../repositories/catalogue.repository.js";
import { getPaginationParams, getCrecheAdminEmail } from "../../repositories/shared.js";
import { logFinancialAudit } from "../../services/audit.js";
import { sendLowStockAlertEmail } from "../../services/email.js";
import { requireFinancialAccess } from "./middleware.js";
import { financialLog } from "../../lib/logger.js";

const router = Router({ mergeParams: true });
router.use(authenticate);

// ── Validation schemas ───────────────────────────────────────────────────────

const catalogueItemSchema = z.object({
  name: z.string().min(1).max(255).trim(),
  type: z.string().min(1),
  description: z.string().optional().nullable(),
  price: z.number().nonnegative(),
  pricingBySize: z.object({
    small: z.number().nonnegative(),
    medium: z.number().nonnegative(),
    large: z.number().nonnegative(),
  }).optional().nullable(),
  stockQuantity: z.number().int().nonnegative().optional().nullable(),
  reorderThreshold: z.number().int().nonnegative().optional().nullable(),
  creditsAmount: z.number().int().positive().optional().nullable(),
  category: z.string().max(100).optional().nullable(),
  sku: z.string().max(50).optional().nullable(),
  barcode: z.string().max(255).optional().nullable(),
  mediaUrls: z.array(
    z.string().refine(
      (v) =>
        v.startsWith("/objects/") ||
        v.startsWith("/api/") ||
        z.string().url().safeParse(v).success,
      { message: "Cada URL deve ser uma URL válida ou um caminho de objeto (/objects/...)" }
    )
  ).optional().nullable(),
  costPrice: z.number().nonnegative().optional().nullable(),
  maxPetsPerDay: z.number().int().positive().optional().nullable(),
}).refine(
  (data) => data.type !== "package" || (data.creditsAmount && data.creditsAmount > 0),
  { message: "A quantidade de diárias (créditos) é obrigatória para pacotes", path: ["creditsAmount"] }
);

const stockAdjustmentSchema = z.object({
  delta: z.number().int().refine((v) => v !== 0, { message: "delta não pode ser zero" }),
  reason: z.string().min(1).max(255),
});

// ── GET /catalogue ───────────────────────────────────────────────────────────

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const includeInactive =
      req.query.includeInactive === "true" && req.user!.role === "creche_admin";
    const items = await CatalogueRepository.list(crecheId, includeInactive);
    const mapped = (items as any[]).map((item: any) => ({
      ...item,
      price: item.basePrice,
      reorderThreshold: item.minStockAlert,
      pricingBySize: { small: item.priceSmall, medium: item.priceMedium, large: item.priceLarge },
    }));
    res.json(mapped);
  } catch (err) {
    next(err);
  }
});

// ── POST /catalogue ──────────────────────────────────────────────────────────

router.post(
  "/",
  requireFinancialAccess,
  validate(catalogueItemSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const crecheId = Number(req.params.crecheId);
      const {
        name, type, description, price, pricingBySize, stockQuantity,
        reorderThreshold, creditsAmount, category, sku, barcode, costPrice, mediaUrls,
      } = req.body;

      const existing = await CatalogueRepository.findActiveByName(crecheId, name);
      if (existing) {
        res.status(409).json({ error: `Já existe um item ativo com o nome "${name}" no catálogo.` });
        return;
      }

      const newItem = await CatalogueRepository.create({
        crecheId,
        name,
        type,
        description,
        category,
        sku,
        barcode,
        costPrice,
        mediaUrls: mediaUrls ?? [],
        basePrice: price,
        priceSmall: pricingBySize?.small ?? price,
        priceMedium: pricingBySize?.medium ?? price,
        priceLarge: pricingBySize?.large ?? price,
        stockQuantity: stockQuantity ?? 0,
        minStockAlert: reorderThreshold ?? 5,
        creditsAmount: type === "package" ? creditsAmount : null,
      });

      if (stockQuantity && stockQuantity > 0) {
        await CatalogueRepository.createStockTransaction({
          crecheId,
          itemId: newItem.id,
          quantity: stockQuantity,
          type: "in",
          reason: "Estoque inicial",
          userId: req.user!.id,
        });
      }

      await logFinancialAudit({
        crecheId,
        userId: req.user!.id,
        action: "stock_adjustment",
        referenceId: newItem.id,
        referenceType: "catalogue_items",
        details: `Criou item de catálogo: ${newItem.name}`,
      });

      res.json(newItem);
    } catch (err) {
      next(err);
    }
  }
);

// ── PUT /catalogue/:itemId ───────────────────────────────────────────────────

router.put(
  "/:itemId",
  requireFinancialAccess,
  validate(catalogueItemSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const crecheId = Number(req.params.crecheId);
      const itemId = Number(req.params.itemId);
      const {
        name, type, description, price, pricingBySize, stockQuantity,
        reorderThreshold, creditsAmount, maxPetsPerDay, category, sku, barcode,
        costPrice, mediaUrls,
      } = req.body;

      const oldItem = await CatalogueRepository.findByIdAndCreche(itemId, crecheId);
      if (!oldItem) {
        res.status(404).json({ error: "Item não encontrado." });
        return;
      }

      const duplicate = await CatalogueRepository.findActiveByName(crecheId, name, itemId);
      if (duplicate) {
        res.status(409).json({ error: `Já existe outro item ativo com o nome "${name}" no catálogo.` });
        return;
      }

      let updated: any;

      await db.transaction(async (tx) => {
        updated = await CatalogueRepository.update(itemId, crecheId, {
          name,
          type,
          description,
          category,
          sku,
          ...(barcode !== undefined ? { barcode } : {}),
          ...(costPrice !== undefined
            ? { costPrice: costPrice !== null ? costPrice.toString() : null }
            : {}),
          mediaUrls: mediaUrls ?? oldItem.mediaUrls,
          basePrice: price,
          priceSmall: pricingBySize?.small ?? price,
          priceMedium: pricingBySize?.medium ?? price,
          priceLarge: pricingBySize?.large ?? price,
          creditsAmount: type === "package" ? creditsAmount : null,
          maxPetsPerDay:
            type === "package" && maxPetsPerDay ? maxPetsPerDay : oldItem.maxPetsPerDay,
          ...(reorderThreshold !== undefined && reorderThreshold !== null
            ? { minStockAlert: reorderThreshold }
            : {}),
        }, tx);

        // Apply stock quantity adjustment when the value changed
        if (stockQuantity !== undefined && stockQuantity !== null && type === "product") {
          const currentQty = oldItem.stockQuantity ?? 0;
          const delta = stockQuantity - currentQty;
          if (delta !== 0) {
            const newQty = currentQty + delta;
            if (newQty < 0) {
              throw Object.assign(
                new Error(`Estoque insuficiente. Saldo atual: ${currentQty}, valor solicitado: ${stockQuantity}.`),
                { status: 400 }
              );
            }
            updated = await CatalogueRepository.applyDeltaStock(itemId, crecheId, delta, tx);
            await CatalogueRepository.createStockTransaction({
              crecheId,
              itemId,
              quantity: Math.abs(delta),
              type: delta > 0 ? "in" : "out",
              reason: "Ajuste via edição de produto",
              userId: req.user!.id,
            }, tx);
          }
        }

        await logFinancialAudit({
          crecheId,
          userId: req.user!.id,
          action: "stock_adjustment",
          referenceId: itemId,
          referenceType: "catalogue_items",
          details: `Atualizou item de catálogo: ${updated?.name}`,
        }, tx);
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /catalogue/:itemId/stock-adjustment ─────────────────────────────────

router.post(
  "/:itemId/stock-adjustment",
  requireFinancialAccess,
  validate(stockAdjustmentSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const crecheId = Number(req.params.crecheId);
      const itemId = Number(req.params.itemId);
      const { delta, reason } = req.body as { delta: number; reason: string };

      let updatedItem: any;

      await db.transaction(async (tx) => {
        const lockedItem = await CatalogueRepository.findByIdAndCrecheForUpdate(itemId, crecheId, tx);
        if (!lockedItem) {
          throw Object.assign(new Error("Item não encontrado."), { status: 404 });
        }

        const newQuantity = lockedItem.stockQuantity + delta;
        if (newQuantity < 0) {
          throw Object.assign(
            new Error(
              `Estoque insuficiente. Saldo atual: ${lockedItem.stockQuantity}, ajuste solicitado: ${delta}.`
            ),
            { status: 400 }
          );
        }

        updatedItem = await CatalogueRepository.applyDeltaStock(itemId, crecheId, delta, tx);

        await CatalogueRepository.createStockTransaction({
          crecheId,
          itemId,
          quantity: Math.abs(delta),
          type: delta > 0 ? "in" : "out",
          reason,
          userId: req.user!.id,
        }, tx);

        await logFinancialAudit({
          crecheId,
          userId: req.user!.id,
          action: "stock_adjustment",
          referenceId: itemId,
          referenceType: "catalogue_items",
          details: `Ajuste de estoque: ${delta > 0 ? "+" : ""}${delta} unidade(s). Motivo: ${reason}. Novo saldo: ${newQuantity}.`,
        }, tx);
      });

      res.json(updatedItem!);

      // Fire low-stock alert asynchronously — does not block the response
      if (delta < 0 && updatedItem!.stockQuantity <= updatedItem!.minStockAlert) {
        (async () => {
          try {
            const info = await getCrecheAdminEmail(crecheId);
            if (info) {
              await sendLowStockAlertEmail({
                adminEmail: info.email,
                adminName: info.name,
                crecheName: info.crecheName,
                itemName: updatedItem!.name,
                currentStock: updatedItem!.stockQuantity,
                reorderThreshold: updatedItem!.minStockAlert,
              });
            }
          } catch (alertErr) {
            financialLog({ operation: "low_stock_alert_failed", level: "error", error: String(alertErr), itemId });
          }
        })();
      }
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

// ── GET /catalogue/:itemId/stock-transactions ────────────────────────────────

router.get(
  "/:itemId/stock-transactions",
  requireFinancialAccess,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const crecheId = Number(req.params.crecheId);
      const itemId = Number(req.params.itemId);
      const { page, pageSize, offset } = getPaginationParams(req.query);

      const item = await CatalogueRepository.findByIdAndCreche(itemId, crecheId);
      if (!item) {
        res.status(404).json({ error: "Item não encontrado." });
        return;
      }

      let data: any[] = [];
      let total = 0;
      try {
        const result = await CatalogueRepository.listStockTransactions(
          itemId, crecheId, pageSize, offset
        );
        data = result.data;
        total = result.total;
      } catch (queryErr: any) {
        const msg: string = queryErr?.message ?? "";
        if (!msg.includes("does not exist") && !msg.includes("relation")) throw queryErr;
        financialLog({ operation: "stock_tx_table_missing", level: "warn", itemId, details: msg });
      }

      res.json({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
    } catch (err) {
      next(err);
    }
  }
);

// ── DELETE /catalogue/:itemId ────────────────────────────────────────────────

router.delete(
  "/:itemId",
  requireFinancialAccess,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const crecheId = Number(req.params.crecheId);
      const itemId = Number(req.params.itemId);
      await CatalogueRepository.delete(itemId, crecheId);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
