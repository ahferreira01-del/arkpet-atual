import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { 
  catalogueItemsTable, 
  invoicesTable, 
  tutorCreditsTable, 
  tutorServiceCreditsTable,
  transactionsTable,
  financialAuditLogsTable,
  expensesTable,
  usersTable,
  invoiceItemsTable,
  catalogueStockTransactionsTable,
  ordersTable,
  orderItemsTable,
  crechesTable,
  petsTable,
} from "@workspace/db/schema";
import { getUncachableStripeClient } from "../lib/stripeClient.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
const objectStorageService = new ObjectStorageService();
import { eq, and, desc, asc, sql, gte, lte, count, lt, or, isNull, ne } from "drizzle-orm";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate.js";
import { processManualPayment, approveReceipt, voidInvoice, refundInvoice, calculateDueDate, hasOverdueInvoices, BillingService } from "../services/billing.js";
import { validate } from "../middlewares/validate.js";
import { z } from "zod";
import { logFinancialAudit } from "../services/audit.js";
import { sendLowStockAlertEmail } from "../services/email.js";
import { decrypt } from "../lib/crypto.js";

const router = Router({ mergeParams: true });
router.use(authenticate);

function requireFinancialAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user || (user.role !== "creche_admin" && user.role !== "staff")) {
    res.status(403).json({ error: "Acesso não autorizado para tutores." });
    return;
  }
  next();
}

// Pagination Helper
function getPaginationParams(query: Record<string, any>) {
  const page = Math.max(1, parseInt(query.page as string || "1"));
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize as string || "20")));
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

// Validation schemas
const payManualSchema = z.object({
  paymentMethod: z.enum(["cash", "pix", "credit_card", "bank_slip"]),
});

const uploadReceiptSchema = z.object({
  receiptPhotoPath: z.string().min(1),
});

const catalogueItemSchema = z.object({
  name: z.string().min(1).max(255).trim(),
  type: z.string().min(1),
  description: z.string().optional().nullable(),
  price: z.number().nonnegative(),
  pricingBySize: z.object({
    small: z.number().nonnegative(),
    medium: z.number().nonnegative(),
    large: z.number().nonnegative()
  }).optional().nullable(),
  // stockQuantity é intencionalmente OMITIDO do schema de PUT.
  // Estoque deve ser ajustado via POST /catalogue/:itemId/stock-adjustment (com auditoria).
  // Aceitar stockQuantity via PUT pularia a auditoria e permitiria estoque negativo silencioso.
  reorderThreshold: z.number().int().nonnegative().optional().nullable(),
  creditsAmount: z.number().int().positive().optional().nullable(),
  category: z.string().max(100).optional().nullable(),
  sku: z.string().max(50).optional().nullable(),
  barcode: z.string().max(255).optional().nullable(),
  mediaUrls: z.array(
    z.string().refine(
      (v) => v.startsWith("/objects/") || v.startsWith("/api/") || z.string().url().safeParse(v).success,
      { message: "Cada URL deve ser uma URL válida ou um caminho de objeto (/objects/...)" }
    )
  ).optional().nullable(),
  costPrice: z.number().nonnegative().optional().nullable(),
  maxPetsPerDay: z.number().int().positive().optional().nullable(),
}).refine(
  (data) => data.type !== 'package' || (data.creditsAmount && data.creditsAmount > 0),
  { message: 'A quantidade de diárias (créditos) é obrigatória para pacotes', path: ['creditsAmount'] }
);

const creditsPackageSchema = z.object({
  tutorId: z.number().int().positive(),
  totalCredits: z.number().int().positive(),
  maxPetsPerDay: z.number().int().min(1).default(1),
  expirationDate: z.string().optional().nullable(),
});

const purchasePackageSchema = z.object({
  packageId: z.number().int().positive(), // Updated from catalogueItemId as frontend sends packageId
  tutorId: z.number().int().positive(),
});

// ==========================================
// 0. RELATÓRIOS
// ==========================================

// Note: Relatórios agora estão separados em src/routes/financial-reports.ts


// ==========================================
// 1. CATÁLOGO DE SERVIÇOS E PRODUTOS
// ==========================================

router.get("/catalogue", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const includeInactive = req.query.includeInactive === "true" && req.user!.role === "creche_admin";
    const items = await db
      .select()
      .from(catalogueItemsTable)
      .where(
        and(
          eq(catalogueItemsTable.crecheId, crecheId),
          includeInactive ? undefined : eq(catalogueItemsTable.isActive, true)
        )
      );
    const mapped = items.map(item => ({
      ...item,
      price: item.basePrice,
      reorderThreshold: item.minStockAlert,
      pricingBySize: {
        small: item.priceSmall,
        medium: item.priceMedium,
        large: item.priceLarge,
      }
    }));
    res.json(mapped);
  } catch (err) {
    next(err);
  }
});

router.post("/catalogue", requireFinancialAccess, validate(catalogueItemSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const { name, type, description, price, pricingBySize, stockQuantity, reorderThreshold, creditsAmount, category, sku, barcode, costPrice, mediaUrls } = req.body;

    // Prevent creating a duplicate active item with the same name
    const [existing] = await db
      .select({ id: catalogueItemsTable.id })
      .from(catalogueItemsTable)
      .where(
        and(
          eq(catalogueItemsTable.crecheId, crecheId),
          eq(catalogueItemsTable.name, name),
          eq(catalogueItemsTable.isActive, true)
        )
      )
      .limit(1);
    if (existing) {
      res.status(409).json({ error: `Já existe um item ativo com o nome "${name}" no catálogo.` });
      return;
    }

    const [newItem] = await db.insert(catalogueItemsTable).values({
      crecheId: Number(crecheId),
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
      creditsAmount: type === 'package' ? creditsAmount : null,
    }).returning();
    
    if (stockQuantity && stockQuantity > 0) {
      await db.insert(catalogueStockTransactionsTable).values({
        crecheId,
        itemId: newItem.id,
        quantity: stockQuantity,
        type: 'in',
        reason: 'Estoque inicial',
        userId: req.user!.id
      });
    }
    
    await logFinancialAudit({
      crecheId,
      userId: req.user!.id,
      action: "stock_adjustment",
      referenceId: newItem.id,
      referenceType: "catalogue_items",
      details: `Criou item de catálogo: ${newItem.name}`
    }, db);

    res.json(newItem);
  } catch (err) {
    next(err);
  }
});

router.put("/catalogue/:itemId", requireFinancialAccess, validate(catalogueItemSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const itemId = Number(req.params.itemId);
    const { name, type, description, price, pricingBySize, reorderThreshold, creditsAmount, maxPetsPerDay, category, sku, barcode, costPrice, mediaUrls } = req.body;
    
    const [oldItem] = await db.select().from(catalogueItemsTable).where(and(eq(catalogueItemsTable.id, itemId), eq(catalogueItemsTable.crecheId, crecheId)));
    
    if (!oldItem) {
      res.status(404).json({ error: "Item não encontrado." });
      return;
    }

    // Prevent renaming to a name already used by another active item
    const [duplicate] = await db
      .select({ id: catalogueItemsTable.id })
      .from(catalogueItemsTable)
      .where(
        and(
          eq(catalogueItemsTable.crecheId, crecheId),
          eq(catalogueItemsTable.name, name),
          eq(catalogueItemsTable.isActive, true),
          ne(catalogueItemsTable.id, itemId)
        )
      )
      .limit(1);
    if (duplicate) {
      res.status(409).json({ error: `Já existe outro item ativo com o nome "${name}" no catálogo.` });
      return;
    }
    
    const [updated] = await db.update(catalogueItemsTable)
      .set({
        name,
        type,
        description,
        category,
        sku,
        // barcode e costPrice agora são persistidos (antes eram silenciosamente ignorados)
        ...(barcode !== undefined ? { barcode } : {}),
        ...(costPrice !== undefined ? { costPrice: costPrice !== null ? costPrice.toString() : null } : {}),
        mediaUrls: mediaUrls ?? oldItem.mediaUrls,
        basePrice: price,
        priceSmall: pricingBySize?.small ?? price,
        priceMedium: pricingBySize?.medium ?? price,
        priceLarge: pricingBySize?.large ?? price,
        creditsAmount: type === 'package' ? creditsAmount : null,
        maxPetsPerDay: type === 'package' && maxPetsPerDay ? maxPetsPerDay : oldItem.maxPetsPerDay,
        ...(reorderThreshold !== undefined && reorderThreshold !== null
          ? { minStockAlert: reorderThreshold }
          : {}),
      })
      .where(and(eq(catalogueItemsTable.id, itemId), eq(catalogueItemsTable.crecheId, crecheId)))
      .returning();
      
    await logFinancialAudit({
      crecheId,
      userId: req.user!.id,
      action: "stock_adjustment",
      referenceId: itemId,
      referenceType: "catalogue_items",
      details: `Atualizou item de catálogo: ${updated.name}`
    }, db);

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post("/invoices/:invoiceId/stripe-checkout", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const invoiceId = Number(req.params.invoiceId);
    
    const [invoice] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.crecheId, crecheId)));
    if (!invoice) { res.status(404).json({ error: "Fatura não encontrada" }); return; }
    if (req.user!.role === "tutor" && invoice.tutorId !== req.user!.id) { res.status(403).json({ error: "Acesso negado" }); return; }

    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card", "pix"],
      line_items: [
        {
          price_data: {
            currency: "brl",
            product_data: { name: `Fatura #${invoiceId}` },
            unit_amount: Math.round(Number(invoice.amount) * 100),
          },
          quantity: 1,
        }
      ],
      mode: "payment",
      success_url: `${req.headers.origin}/tutor/financial?success=true&invoiceId=${invoiceId}`,
      cancel_url: `${req.headers.origin}/tutor/financial?canceled=true`,
      metadata: { invoiceId: String(invoiceId), crecheId: String(crecheId) }
    });

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    next(err);
  }
});

router.get("/invoices/:invoiceId/receipt-url", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const invoiceId = Number(req.params.invoiceId);

    // Tutors may only view their own invoices; admins/staff see any invoice in their creche.
    if (req.user!.role === "tutor") {
      const [owned] = await db.select({ id: invoicesTable.id }).from(invoicesTable)
        .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.tutorId, req.user!.id)));
      if (!owned) { res.status(403).json({ error: "Não autorizado" }); return; }
    } else if (req.user!.role !== "master_admin" && req.user!.crecheId !== crecheId) {
      res.status(403).json({ error: "Não autorizado" }); return;
    }

    const [invoice] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.crecheId, crecheId)));
    
    if (!invoice || !invoice.receiptPhotoPath) {
      res.status(404).json({ error: "Comprovante não encontrado" }); return;
    }

    // data: URIs are stored directly in the DB (base64 upload path) — return as-is
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
      details: `Gerou URL temporária para comprovante da fatura #${invoice.id}`
    }, db);

    res.json({ url });
  } catch(err) { next(err); }
});

router.get("/invoices/:invoiceId/receipt-data", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const invoiceId = Number(req.params.invoiceId);
    
    // Auth check: Admin or the Tutor who owns the invoice
    if (req.user!.role === "tutor") {
      const [inv] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.tutorId, req.user!.id)));
      if (!inv) { res.status(403).json({ error: "Não autorizado" }); return; }
    } else {
      if (req.user!.crecheId !== crecheId && req.user!.role !== "master_admin") {
        res.status(403).json({ error: "Não autorizado" }); return;
      }
    }

    // 1. Get Invoice & Tutor
    const [invoiceData] = await db.select({
      invoice: invoicesTable,
      tutorName: usersTable.name,
      tutorCpf: usersTable.cpf,
    })
    .from(invoicesTable)
    .leftJoin(usersTable, eq(invoicesTable.tutorId, usersTable.id))
    .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.crecheId, crecheId)));

    if (!invoiceData) { res.status(404).json({ error: "Fatura não encontrada" }); return; }

    // 2. Get Invoice Items
    const items = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, invoiceId));

    // 3. Get Creche Info
    const [creche] = await db.select({
      name: crechesTable.name,
      address: crechesTable.address,
      phone: crechesTable.phone
    }).from(crechesTable).where(eq(crechesTable.id, crecheId));

    // Decrypt CPF if exists
    let decryptedCpf = null;
    if (invoiceData.tutorCpf) {
      try { decryptedCpf = decrypt(invoiceData.tutorCpf); } catch(e) {}
    }

    res.json({
      invoice: invoiceData.invoice,
      tutor: { name: invoiceData.tutorName, cpf: decryptedCpf },
      items,
      creche
    });

  } catch(err) { next(err); }
});

const stockAdjustmentSchema = z.object({
  delta: z.number().int().refine(v => v !== 0, { message: "delta não pode ser zero" }),
  reason: z.string().min(1).max(255),
});

router.post("/catalogue/:itemId/stock-adjustment", requireFinancialAccess, validate(stockAdjustmentSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const itemId = Number(req.params.itemId);
    const { delta, reason } = req.body as { delta: number; reason: string };

    let updatedItem: typeof catalogueItemsTable.$inferSelect;

    await db.transaction(async (tx) => {
      // Acquire row lock to prevent concurrent overwrites
      const [lockedItem] = await tx
        .select()
        .from(catalogueItemsTable)
        .where(and(eq(catalogueItemsTable.id, itemId), eq(catalogueItemsTable.crecheId, crecheId)))
        .for("update");

      if (!lockedItem) {
        throw Object.assign(new Error("Item não encontrado."), { status: 404 });
      }

      const newQuantity = lockedItem.stockQuantity + delta;
      if (newQuantity < 0) {
        throw Object.assign(
          new Error(`Estoque insuficiente. Saldo atual: ${lockedItem.stockQuantity}, ajuste solicitado: ${delta}.`),
          { status: 400 }
        );
      }

      // Apply relative delta — safe under concurrent access
      const [updated] = await tx
        .update(catalogueItemsTable)
        .set({ stockQuantity: sql`${catalogueItemsTable.stockQuantity} + ${delta}` })
        .where(and(eq(catalogueItemsTable.id, itemId), eq(catalogueItemsTable.crecheId, crecheId)))
        .returning();

      updatedItem = updated;

      await tx.insert(catalogueStockTransactionsTable).values({
        crecheId,
        itemId,
        quantity: Math.abs(delta),
        type: delta > 0 ? "in" : "out",
        reason,
        userId: req.user!.id,
      });

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
          const [admin] = await db
            .select({ email: usersTable.email, name: usersTable.name })
            .from(usersTable)
            .where(and(eq(usersTable.crecheId, crecheId), eq(usersTable.role, "creche_admin")))
            .limit(1);
          const [creche] = await db
            .select({ name: crechesTable.name })
            .from(crechesTable)
            .where(eq(crechesTable.id, crecheId))
            .limit(1);
          if (admin && creche) {
            await sendLowStockAlertEmail({
              adminEmail: admin.email,
              adminName: admin.name,
              crecheName: creche.name,
              itemName: updatedItem!.name,
              currentStock: updatedItem!.stockQuantity,
              reorderThreshold: updatedItem!.minStockAlert,
            });
          }
        } catch (alertErr) {
          console.error("[low-stock-alert] Failed to send alert after stock adjustment:", alertErr);
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
});

router.get("/catalogue/:itemId/stock-transactions", requireFinancialAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const itemId = Number(req.params.itemId);
    const { page, pageSize, offset } = getPaginationParams(req.query);

    // Verify item belongs to this creche
    const [item] = await db
      .select({ id: catalogueItemsTable.id })
      .from(catalogueItemsTable)
      .where(and(eq(catalogueItemsTable.id, itemId), eq(catalogueItemsTable.crecheId, crecheId)));

    if (!item) {
      res.status(404).json({ error: "Item não encontrado." });
      return;
    }

    let data: any[] = [];
    let total = 0;
    try {
      const [rows, [{ count: cnt }]] = await Promise.all([
        db
          .select({
            id: catalogueStockTransactionsTable.id,
            type: catalogueStockTransactionsTable.type,
            quantity: catalogueStockTransactionsTable.quantity,
            reason: catalogueStockTransactionsTable.reason,
            createdAt: catalogueStockTransactionsTable.createdAt,
            userName: usersTable.name,
          })
          .from(catalogueStockTransactionsTable)
          .leftJoin(usersTable, eq(catalogueStockTransactionsTable.userId, usersTable.id))
          .where(
            and(
              eq(catalogueStockTransactionsTable.itemId, itemId),
              eq(catalogueStockTransactionsTable.crecheId, crecheId)
            )
          )
          .orderBy(desc(catalogueStockTransactionsTable.createdAt))
          .limit(pageSize)
          .offset(offset),
        db
          .select({ count: count() })
          .from(catalogueStockTransactionsTable)
          .where(
            and(
              eq(catalogueStockTransactionsTable.itemId, itemId),
              eq(catalogueStockTransactionsTable.crecheId, crecheId)
            )
          ),
      ]);
      data = rows;
      total = Number(cnt);
    } catch (queryErr: any) {
      // Tabela pode não existir em ambientes sem migração aplicada → retorna vazio
      const msg: string = queryErr?.message ?? "";
      if (!msg.includes("does not exist") && !msg.includes("relation")) {
        throw queryErr;
      }
      console.warn("[stock-transactions] Tabela não encontrada, retornando vazio:", msg);
    }

    res.json({
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/catalogue/:itemId", requireFinancialAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const itemId = Number(req.params.itemId);
    await db.delete(catalogueItemsTable).where(and(eq(catalogueItemsTable.id, itemId), eq(catalogueItemsTable.crecheId, crecheId)));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// ==========================================
// 2. FATURAS
// ==========================================

router.get("/invoices", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const { page, pageSize, offset } = getPaginationParams(req.query);
    
    let baseConditions = eq(invoicesTable.crecheId, crecheId);
    if (req.user!.role === "tutor") {
      baseConditions = and(eq(invoicesTable.crecheId, crecheId), eq(invoicesTable.tutorId, req.user!.id)) as typeof baseConditions;
    }
    
    const [data, [{ total }]] = await Promise.all([
      db.select({
        id: invoicesTable.id,
        amount: invoicesTable.amount,
        status: invoicesTable.status,
        dueDate: invoicesTable.dueDate,
        tutorId: invoicesTable.tutorId,
        tutorName: usersTable.name,
        createdAt: invoicesTable.createdAt,
        paymentMethod: invoicesTable.paymentMethod,
        receiptPhotoPath: invoicesTable.receiptPhotoPath,
      })
        .from(invoicesTable)
        .leftJoin(usersTable, eq(invoicesTable.tutorId, usersTable.id))
        .where(baseConditions)
        .orderBy(desc(invoicesTable.createdAt))
        .limit(pageSize)
        .offset(offset),
      db.select({ total: count() })
        .from(invoicesTable)
        .where(baseConditions)
    ]);
    
    res.json({
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/invoices/:invoiceId/items", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const invoiceId = Number(req.params.invoiceId);
    
    // Validate if the invoice belongs to the creche and to the tutor (if tutor)
    let baseConditions = and(eq(invoicesTable.crecheId, crecheId), eq(invoicesTable.id, invoiceId));
    if (req.user!.role === "tutor") {
      baseConditions = and(baseConditions, eq(invoicesTable.tutorId, req.user!.id));
    }
    
    const [invoice] = await db.select().from(invoicesTable).where(baseConditions);
    
    if (!invoice) {
      res.status(404).json({ error: "Fatura não encontrada" });
      return;
    }
    
    const items = await db
      .select({
        id: invoiceItemsTable.id,
        description: invoiceItemsTable.description,
        quantity: invoiceItemsTable.quantity,
        amount: invoiceItemsTable.amount,
        itemDate: invoiceItemsTable.itemDate,
        itemType: invoiceItemsTable.itemType,
        petId: invoiceItemsTable.petId,
        petName: petsTable.name,
      })
      .from(invoiceItemsTable)
      .leftJoin(petsTable, eq(invoiceItemsTable.petId, petsTable.id))
      .where(eq(invoiceItemsTable.invoiceId, invoiceId))
      .orderBy(asc(invoiceItemsTable.itemDate), asc(invoiceItemsTable.id));
      
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.post("/invoices/:invoiceId/upload-receipt", validate(uploadReceiptSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const invoiceId = Number(req.params.invoiceId);
    const { receiptPhotoPath } = req.body;
    
    const [invoice] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.crecheId, crecheId)));
    if (!invoice) {
      res.status(404).json({ error: "Fatura não encontrada" });
      return;
    }
    
    if (req.user!.role === "tutor" && invoice.tutorId !== req.user!.id) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }

    await db.update(invoicesTable)
      .set({ receiptPhotoPath, status: "awaiting_confirmation", updatedAt: new Date() })
      .where(eq(invoicesTable.id, invoiceId));

    // Non-fatal: audit log must not block the receipt upload response
    logFinancialAudit({
      crecheId,
      userId: req.user!.id,
      action: "payment_receipt_upload",
      referenceId: invoiceId,
      referenceType: "invoices",
      details: "Tutor enviou comprovante de pagamento."
    }, db).catch((err: unknown) => console.error("[audit] upload-receipt log failed:", err));

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/invoices/:invoiceId/pay-manual", requireFinancialAccess, validate(payManualSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const invoiceId = Number(req.params.invoiceId);
    const { paymentMethod } = req.body;
    
    await processManualPayment(invoiceId, crecheId, req.user!.id, paymentMethod);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/invoices/:invoiceId/approve-receipt", requireFinancialAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const invoiceId = Number(req.params.invoiceId);
    
    await approveReceipt(invoiceId, crecheId, req.user!.id);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/invoices/:invoiceId/void", requireFinancialAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const invoiceId = Number(req.params.invoiceId);
    
    await voidInvoice(invoiceId, crecheId, req.user!.id);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/invoices/:invoiceId/refund", requireFinancialAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const invoiceId = Number(req.params.invoiceId);
    
    await refundInvoice(invoiceId, crecheId, req.user!.id);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ==========================================
// 3. PACOTES DE CRÉDITOS
// ==========================================

router.get("/service-credits", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const { page, pageSize, offset } = getPaginationParams(req.query);
    
    let baseConditions: ReturnType<typeof sql> = sql`${tutorServiceCreditsTable.crecheId} = ${crecheId}`;
    if (req.user!.role === "tutor") {
      baseConditions = (and(baseConditions, eq(tutorServiceCreditsTable.tutorId, req.user!.id)) ?? baseConditions) as ReturnType<typeof sql>;
    }
    
    // Only return credits that haven't been fully used
    baseConditions = (and(baseConditions, sql`${tutorServiceCreditsTable.usedCredits} < ${tutorServiceCreditsTable.totalCredits}`) ?? baseConditions) as ReturnType<typeof sql>;

    const [data, [{ total }]] = await Promise.all([
      db
        .select({
          id: tutorServiceCreditsTable.id,
          tutorId: tutorServiceCreditsTable.tutorId,
          catalogueItemId: tutorServiceCreditsTable.catalogueItemId,
          totalCredits: tutorServiceCreditsTable.totalCredits,
          usedCredits: tutorServiceCreditsTable.usedCredits,
          createdAt: tutorServiceCreditsTable.createdAt,
          itemName: catalogueItemsTable.name,
          itemType: catalogueItemsTable.type,
        })
        .from(tutorServiceCreditsTable)
        .leftJoin(catalogueItemsTable, eq(tutorServiceCreditsTable.catalogueItemId, catalogueItemsTable.id))
        .where(baseConditions)
        .orderBy(desc(tutorServiceCreditsTable.createdAt))
        .limit(pageSize)
        .offset(offset),
      db.select({ total: count() }).from(tutorServiceCreditsTable).where(baseConditions)
    ]);
    
    res.json({
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/packages", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const { page, pageSize, offset } = getPaginationParams(req.query);
    
    let baseConditions = eq(tutorCreditsTable.crecheId, crecheId);
    if (req.user!.role === "tutor") {
      baseConditions = and(eq(tutorCreditsTable.crecheId, crecheId), eq(tutorCreditsTable.tutorId, req.user!.id)) as typeof baseConditions;
    }
    
    const [data, [{ total }]] = await Promise.all([
      db.select().from(tutorCreditsTable).where(baseConditions).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(tutorCreditsTable).where(baseConditions)
    ]);
    
    res.json({
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/packages", requireFinancialAccess, validate(creditsPackageSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const { tutorId, totalCredits, expirationDate, maxPetsPerDay } = req.body;
    
    const [credits] = await db.insert(tutorCreditsTable).values({
      crecheId,
      tutorId,
      totalCredits,
      maxPetsPerDay: maxPetsPerDay || 1,
      expirationDate: expirationDate ? new Date(expirationDate).toISOString().split("T")[0] : null,
    }).returning();
    
    await logFinancialAudit({
      crecheId,
      userId: req.user!.id,
      action: "credits_purchase",
      referenceId: credits.id,
      referenceType: "tutor_credits",
      details: `Pacote de ${totalCredits} créditos adquirido pelo tutor ${tutorId}.`
    }, db);

    res.json(credits);
  } catch (err) {
    next(err);
  }
});

router.post("/packages/purchase", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const { packageId, tutorId, paymentMethod } = req.body;
    
    // 1. Buscar o item do catálogo
    const [item] = await db
      .select()
      .from(catalogueItemsTable)
      .where(
        and(
          eq(catalogueItemsTable.id, packageId),
          eq(catalogueItemsTable.crecheId, crecheId),
          eq(catalogueItemsTable.type, 'package'),
          eq(catalogueItemsTable.isActive, true)
        )
      );

    if (!item) {
      res.status(404).json({ error: 'Pacote não encontrado' });
      return;
    }

    if (!item.creditsAmount || item.creditsAmount <= 0) {
      res.status(422).json({ error: 'Este pacote não possui créditos configurados' });
      return;
    }

    // 2. Pacotes sempre geram fatura avulsa própria — nunca reabrem a fatura mensal já paga
    const invoiceId = await BillingService.addCharge({
      crecheId,
      tutorId,
      amount: item.basePrice,
      description: item.name, // Name already contains the credit count (e.g. "Pacote 10 diárias")
      type: "package",
      itemDate: new Date(),
      isAvulso: true,
      userId: req.user!.id,
      // Fase 14: snapshot histórico — permite releasePurchasedCredits sem consultar Catalogue
      catalogueItemId: item.id,
      creditsAmount: item.creditsAmount ?? undefined,
      snapshotMaxPets: item.maxPetsPerDay ?? undefined,
      snapshotExpiration: 365,
    });

    // 4. Log de auditoria
    await logFinancialAudit({
      crecheId,
      userId: tutorId,
      action: 'credits_purchase',
      referenceId: invoiceId,
      referenceType: 'invoices',
      details: `Pacote "${item.name}" solicitado. ${item.creditsAmount} créditos aguardando pagamento. Adicionado à fatura consolidada #${invoiceId}.`,
    }, db);

    let checkoutUrl: string | null = null;
    if (paymentMethod === 'stripe') {
      const stripeClient = await getUncachableStripeClient();
      if (stripeClient) {
        const session = await stripeClient.checkout.sessions.create({
          mode: 'payment',
          line_items: [{
            price_data: {
              currency: 'brl',
              product_data: {
                name: item.name,
                description: `${item.creditsAmount} diárias`,
              },
              unit_amount: Math.round(Number(item.basePrice)),
            },
            quantity: 1,
          }],
          metadata: {
            invoiceId: invoiceId.toString(),
            crecheId: crecheId.toString(),
            tutorId: tutorId.toString(),
            creditsAmount: item.creditsAmount.toString(),
            packagePurchase: 'true',
          },
          success_url: `${process.env.FRONTEND_URL}/tutor/financial?highlight=invoice-${invoiceId}&purchased=true`,
          cancel_url: `${process.env.FRONTEND_URL}/tutor/store`,
        });

        await db.update(invoicesTable)
          .set({ stripePaymentIntentId: session.payment_intent as string })
          .where(eq(invoicesTable.id, invoiceId));

        checkoutUrl = session.url;
      }
    }

    res.status(201).json({
      invoiceId,
      checkoutUrl,
      message: paymentMethod === 'stripe'
        ? 'Redirecionando para pagamento...'
        : `Fatura #${invoiceId} gerada. Realize o pagamento para liberar suas diárias.`,
    });

  } catch (err) {
    next(err);
  }
});


router.get("/packages/balance", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const tutorId = req.user!.id;
    const today = new Date().toISOString().split('T')[0];

    // Buscar TODOS os pacotes válidos do tutor (usedCredits < totalCredits E não expirado)
    const packages = await db
      .select()
      .from(tutorCreditsTable)
      .where(
        and(
          eq(tutorCreditsTable.tutorId, tutorId),
          eq(tutorCreditsTable.crecheId, crecheId),
          lt(tutorCreditsTable.usedCredits, tutorCreditsTable.totalCredits),
          or(
            isNull(tutorCreditsTable.expirationDate),
            gte(tutorCreditsTable.expirationDate, today)
          )
        )
      )
      .orderBy(tutorCreditsTable.expirationDate);

    const totalAvailable = packages.reduce(
      (sum, pkg) => sum + (pkg.totalCredits - pkg.usedCredits),
      0
    );

    const nearestExpiration = packages.find(p => p.expirationDate);

    res.json({
      totalCredits: packages.reduce((sum, p) => sum + p.totalCredits, 0),
      usedCredits: packages.reduce((sum, p) => sum + p.usedCredits, 0),
      availableCredits: totalAvailable,
      packages,
      nearestExpiration: nearestExpiration?.expirationDate ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 4. DASHBOARD (CASH FLOW & DRE)
// ==========================================

router.get("/dashboard/cash-flow", requireFinancialAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      res.status(400).json({ error: "startDate e endDate são obrigatórios" });
      return;
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(String(startDate)) || !dateRegex.test(String(endDate))) {
      res.status(400).json({ error: "Formato de data inválido. Use YYYY-MM-DD" });
      return;
    }

    const start = String(startDate);
    const end = String(endDate);

    const startData = new Date(start);
    const endData = new Date(end);
    if (endData.getTime() - startData.getTime() > 366 * 24 * 60 * 60 * 1000) {
      res.status(400).json({ error: "O intervalo máximo permitido é de 366 dias" });
      return;
    }
    
    const cashFlow = await db
      .select({
        date: transactionsTable.transactionDate,
        type: transactionsTable.type,
        total: sql<number>`SUM(${transactionsTable.amount})::numeric`,
      })
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.crecheId, crecheId),
          gte(transactionsTable.transactionDate, start),
          lte(transactionsTable.transactionDate, end)
        )
      )
      .groupBy(transactionsTable.transactionDate, transactionsTable.type)
      .orderBy(transactionsTable.transactionDate);
      
    res.json(cashFlow);
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/dre", requireFinancialAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate as string).toISOString().split("T")[0] : "1970-01-01";
    const end = endDate ? new Date(endDate as string).toISOString().split("T")[0] : new Date().toISOString().split("T")[0];
    
    const aggregated = await db
      .select({
        type: transactionsTable.type,
        total: sql<number>`SUM(${transactionsTable.amount})::numeric`,
      })
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.crecheId, crecheId),
          gte(transactionsTable.transactionDate, start),
          lte(transactionsTable.transactionDate, end)
        )
      )
      .groupBy(transactionsTable.type);
      
    let receitas = 0;
    let despesas = 0;
    for (const row of aggregated) {
      if (row.type === 'income') receitas = Number(row.total);
      if (row.type === 'expense') despesas = Number(row.total);
    }
    
    const dre = { receitas, despesas };
    
    await logFinancialAudit({
      crecheId,
      userId: req.user!.id,
      action: "sensitive_data_read",
      referenceId: crecheId,
      referenceType: "dashboard",
      details: "DRE acessado."
    }, db);

    res.json(dre);
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 5. DESPESAS OPERACIONAIS
// ==========================================

const expenseSchema = z.object({
  description: z.string().min(1),
  category: z.string().min(1),
  amount: z.number().positive(),
  dueDate: z.string().min(1),
  supplier: z.string().optional(),
  notes: z.string().optional(),
});

router.get("/expenses", requireFinancialAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const expenses = await db.select().from(expensesTable)
      .where(eq(expensesTable.crecheId, crecheId))
      .orderBy(desc(expensesTable.dueDate));
    res.json(expenses);
  } catch (err) { next(err); }
});

router.post("/expenses", requireFinancialAccess, validate(expenseSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const data = req.body;
    
    const [expense] = await db.insert(expensesTable).values({
      crecheId,
      description: data.description,
      category: data.category,
      amount: data.amount.toString(),
      dueDate: new Date(data.dueDate).toISOString().split("T")[0],
      supplier: data.supplier,
      notes: data.notes
    }).returning();
    
    await logFinancialAudit({
      crecheId, userId: req.user!.id, action: "manual_payment_register",
      referenceId: expense.id, referenceType: "expenses",
      details: `Despesa criada: ${data.description}`
    }, db);

    res.status(201).json(expense);
  } catch (err) { next(err); }
});

router.put("/expenses/:id", requireFinancialAccess, validate(expenseSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const id = Number(req.params.id);
    const data = req.body;
    
    const [expense] = await db.update(expensesTable).set({
      description: data.description,
      category: data.category,
      amount: data.amount.toString(),
      dueDate: new Date(data.dueDate).toISOString().split("T")[0],
      supplier: data.supplier,
      notes: data.notes
    }).where(and(eq(expensesTable.id, id), eq(expensesTable.crecheId, crecheId))).returning();
    
    res.json(expense);
  } catch (err) { next(err); }
});

router.post("/expenses/:id/pay", requireFinancialAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const id = Number(req.params.id);
    const [existing] = await db.select().from(expensesTable).where(and(eq(expensesTable.id, id), eq(expensesTable.crecheId, crecheId)));
    if (!existing) { res.status(404).json({ error: "Despesa não encontrada" }); return; }
    if (existing.isPaid) { res.status(400).json({ error: "Despesa já está paga" }); return; }
    
    await db.transaction(async (tx) => {
      const [expense] = await tx.update(expensesTable)
        .set({ isPaid: true, paidDate: new Date().toISOString().split("T")[0] })
        .where(and(eq(expensesTable.id, id), eq(expensesTable.crecheId, crecheId), eq(expensesTable.isPaid, false)))
        .returning();
        
      if (!expense) return;

      const [transaction] = await tx.insert(transactionsTable).values({
        crecheId,
        type: "expense",
        amount: expense.amount,
        description: `Pagamento Despesa: ${expense.description}`,
        expenseId: expense.id,
        paymentMethod: req.body?.paymentMethod || "cash",
        transactionDate: new Date().toISOString().split("T")[0],
      }).returning();
      
      await logFinancialAudit({
        crecheId, userId: req.user!.id, action: "manual_payment_register",
        referenceId: expense.id, referenceType: "expenses",
        details: `Baixa de despesa via transação #${transaction.id}`
      }, tx);
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete("/expenses/:id", requireFinancialAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const id = Number(req.params.id);
    await db.delete(expensesTable).where(and(eq(expensesTable.id, id), eq(expensesTable.crecheId, crecheId)));
    
    await logFinancialAudit({
      crecheId,
      userId: req.user!.id,
      action: "invoice_void", // reusing existing action for deletion logic (as expenses delete is similar)
      referenceId: id,
      referenceType: "expenses",
      details: "Despesa excluída."
    }, db);

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ==========================================
// 6. POS SALE E DEVOLUÇÕES (BALCÃO)
// ==========================================

const posSaleSchema = z.object({
  items: z.array(z.object({
    catalogueItemId: z.number(),
    quantity: z.number().int().positive()
  })).min(1),
  paymentMethod: z.string().optional(),
  tutorId: z.number().optional().nullable()
});

router.post("/pos-sale", requireFinancialAccess, validate(posSaleSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const { items, paymentMethod, tutorId } = req.body;
    
    // Sort items by catalogueItemId to guarantee deterministic lock order
    const sortedItems = [...items].sort((a, b) => a.catalogueItemId - b.catalogueItemId);

    await db.transaction(async (tx) => {
      let subtotal = 0;
      const orderItemsToInsert = [];
      const stockTransactions = [];
      const catalogueItems = [];

      for (const reqItem of sortedItems) {
        // Acquire row lock deterministically
        const [lockedItem] = await tx.select().from(catalogueItemsTable)
          .where(
            and(
              eq(catalogueItemsTable.id, reqItem.catalogueItemId),
              eq(catalogueItemsTable.crecheId, crecheId),
              eq(catalogueItemsTable.isActive, true)
            )
          )
          .for('update');

        if (!lockedItem) {
          throw new Error(`Item ID ${reqItem.catalogueItemId} não encontrado ou inativo.`);
        }

        if (lockedItem.type === 'product' && lockedItem.stockQuantity < reqItem.quantity) {
          throw new Error(`Estoque insuficiente para o item: ${lockedItem.name}. Saldo atual: ${lockedItem.stockQuantity}`);
        }
        
        catalogueItems.push(lockedItem);
      }

      for (const reqItem of sortedItems) {
        const catItem = catalogueItems.find(c => c.id === reqItem.catalogueItemId);
        if (!catItem) continue;

        const unitPrice = Number(catItem.basePrice);
        const totalPrice = unitPrice * reqItem.quantity;
        subtotal += totalPrice;

        orderItemsToInsert.push({
          description: catItem.name,
          quantity: reqItem.quantity,
          amount: unitPrice.toString(),
          catalogueItemId: catItem.id
        });

        if (catItem.type === 'product') {
          // Decrement stock
          await tx.update(catalogueItemsTable)
            .set({ stockQuantity: sql`${catalogueItemsTable.stockQuantity} - ${reqItem.quantity}` })
            .where(eq(catalogueItemsTable.id, catItem.id));

          stockTransactions.push({
            itemId: catItem.id,
            crecheId,
            type: 'out' as const,
            quantity: reqItem.quantity,
            reason: 'Venda Balcão',
            userId: req.user!.id
          });
        }
      }

      const isPending = !paymentMethod || paymentMethod === 'pending';
      
      if (isPending && tutorId) {
        if (await hasOverdueInvoices(tutorId)) {
          throw new Error("Este tutor possui faturas em atraso. A compra deve ser paga à vista (jogar para a fatura está bloqueado).");
        }
      }

      let invoiceId: number | null = null;
      const isAvulso = !isPending || !tutorId;

      for (const oi of orderItemsToInsert) {
        invoiceId = await BillingService.addCharge({
          crecheId,
          tutorId: tutorId || 0, // 0 for anonymous
          amount: oi.amount,
          quantity: oi.quantity,
          description: oi.description,
          type: "pos_sale",
          isAvulso: isAvulso,
          itemDate: new Date(),
          tx: tx,
          userId: req.user!.id,
          // Fase 14: snapshot para rastreabilidade de estorno
          catalogueItemId: oi.catalogueItemId,
        });
      }

      if (stockTransactions.length > 0) {
        await tx.insert(catalogueStockTransactionsTable).values(stockTransactions);
      }

      if (!isPending) {
        // Since it's avulso, we might want to mark it paid right now because the BillingService creates it as pending
        await tx.update(invoicesTable).set({ status: 'paid' }).where(eq(invoicesTable.id, invoiceId!));
        
        await tx.insert(transactionsTable).values({
          crecheId,
          invoiceId: invoiceId!,
          type: "income",
          amount: subtotal.toString(),
          transactionDate: new Date().toISOString().split('T')[0],
          paymentMethod: paymentMethod as any,
          description: "Venda Balcão",
        });
      }

      const [updatedInvoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId!)).limit(1);
      res.status(201).json({ invoice: updatedInvoice });
    });
  } catch (err: any) {
    if (err.message && err.message.includes("Estoque")) {
      res.status(400).json({ error: err.message });
    } else {
      next(err);
    }
  }
});

const refundItemSchema = z.object({
  invoiceItemId: z.number(),
  quantity: z.number().int().positive()
});

router.post("/invoices/:invoiceId/refund-item", validate(refundItemSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const invoiceId = Number(req.params.invoiceId);
    const { invoiceItemId, quantity } = req.body;

    await db.transaction(async (tx) => {
      // 1. Get the invoice to make sure it exists and belongs to the creche
      const [invoice] = await tx.select().from(invoicesTable)
        .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.crecheId, crecheId)));
        
      if (!invoice) throw new Error("Fatura não encontrada.");

      // 2. Get the invoice item
      const [invoiceItem] = await tx.select().from(invoiceItemsTable)
        .where(and(eq(invoiceItemsTable.id, invoiceItemId), eq(invoiceItemsTable.invoiceId, invoiceId)));

      if (!invoiceItem) throw new Error("Item da fatura não encontrado.");
      if (invoiceItem.quantity < quantity) throw new Error("Quantidade de devolução maior que a comprada.");

      // Fase 14: usar catalogueItemId do snapshot (mais confiável que lookup por nome)
      let catItem: typeof catalogueItemsTable.$inferSelect | undefined;
      if (invoiceItem.catalogueItemId) {
        [catItem] = await tx.select().from(catalogueItemsTable)
          .where(eq(catalogueItemsTable.id, invoiceItem.catalogueItemId))
          .for('update');
      } else {
        // Fallback legado — invoice sem snapshot
        [catItem] = await tx.select().from(catalogueItemsTable)
          .where(and(eq(catalogueItemsTable.crecheId, crecheId), eq(catalogueItemsTable.name, invoiceItem.description)))
          .for('update');
      }

      if (catItem && catItem.type === 'product') {
        // Return stock
        await tx.update(catalogueItemsTable)
          .set({ stockQuantity: sql`${catalogueItemsTable.stockQuantity} + ${quantity}` })
          .where(eq(catalogueItemsTable.id, catItem.id));

        await tx.insert(catalogueStockTransactionsTable).values({
          itemId: catItem.id,
          crecheId,
          type: 'in',
          quantity,
          reason: 'Devolução / Estorno',
          userId: req.user!.id
        });
      }

      const itemTotalValue = Number(invoiceItem.amount) * quantity;

      if (invoice.status === 'pending') {
        // Adjust the invoice total directly
        const newInvoiceAmount = Number(invoice.amount) - itemTotalValue;
        
        await tx.update(invoicesTable)
          .set({ amount: newInvoiceAmount.toString() })
          .where(eq(invoicesTable.id, invoice.id));

        if (invoiceItem.quantity === quantity) {
          await tx.delete(invoiceItemsTable).where(eq(invoiceItemsTable.id, invoiceItem.id));
        } else {
          await tx.update(invoiceItemsTable)
            .set({ quantity: invoiceItem.quantity - quantity })
            .where(eq(invoiceItemsTable.id, invoiceItem.id));
        }
      } else if (invoice.status === 'paid') {
        // Paid invoices shouldn't mutate their items for accounting history,
        // Instead, generate a negative income transaction.
        await tx.insert(transactionsTable).values({
          crecheId,
          invoiceId: invoice.id,
          type: "income",
          amount: (-itemTotalValue).toString(), // negative amount
          transactionDate: new Date().toISOString().split('T')[0],
          paymentMethod: "cash", // Assuming refund is given manually or just registered contábilmente
          description: `Estorno de Venda: ${invoiceItem.description} (Qtd: ${quantity})`,
        });
      }

      await logFinancialAudit({
        crecheId,
        userId: req.user!.id,
        action: "invoice_refund",
        referenceId: invoice.id,
        referenceType: "invoices",
        details: `Estorno parcial/total do item ${invoiceItem.description} (Qtd: ${quantity})`
      }, tx);

      res.status(200).json({ ok: true });
    });
  } catch (err: any) {
    if (err.message && err.message.includes("Estoque")) {
      res.status(400).json({ error: err.message });
    } else {
      next(err);
    }
  }
});


router.get("/audit", requireFinancialAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    if (req.user?.role !== "creche_admin") {
      res.status(403).json({ error: "Acesso negado. Apenas gestores podem visualizar trilhas de auditoria." });
      return;
    }

    // Log the access to sensitive data itself!
    await logFinancialAudit({
      crecheId,
      userId: req.user.id,
      action: "sensitive_data_read",
      referenceId: 0,
      referenceType: "financial_audit_logs",
      details: "Gestor acessou a trilha de auditoria financeira.",
    }, db);

    const logs = await db.select({
      id: financialAuditLogsTable.id,
      action: financialAuditLogsTable.action,
      referenceType: financialAuditLogsTable.referenceType,
      referenceId: financialAuditLogsTable.referenceId,
      details: financialAuditLogsTable.details,
      createdAt: financialAuditLogsTable.createdAt,
      userName: usersTable.name
    })
    .from(financialAuditLogsTable)
    .leftJoin(usersTable, eq(financialAuditLogsTable.userId, usersTable.id))
    .where(eq(financialAuditLogsTable.crecheId, crecheId))
    .orderBy(desc(financialAuditLogsTable.createdAt))
    .limit(100);

    res.json(logs);
  } catch (err) {
    next(err);
  }
});

export default router;
