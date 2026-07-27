import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { 
  ordersTable,
  orderItemsTable,
  catalogueItemsTable,
  invoicesTable,
  invoiceItemsTable,
  catalogueStockTransactionsTable,
  usersTable,
  crechesTable,
} from "@workspace/db/schema";
import { eq, and, desc, asc, sql, inArray } from "drizzle-orm";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate.js";
import { validate } from "../middlewares/validate.js";
import { z } from "zod";
import { releasePurchasedCredits } from "../services/credits.js";
import { hasOverdueInvoices, calculateDueDate } from "../services/billing.js";
import { sendLowStockAlertEmail } from "../services/email.js";

const router = Router({ mergeParams: true });
router.use(authenticate);

function requireCrecheAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user || (user.role !== "creche_admin" && user.role !== "staff")) {
    res.status(403).json({ error: "Acesso não autorizado para tutores." });
    return;
  }
  next();
}

const createOrderSchema = z.object({
  items: z.array(z.object({
    catalogueItemId: z.number().int().positive(),
    quantity: z.number().int().positive()
  })).min(1),
  deliveryMethod: z.enum(["pickup", "delivery"]),
  deliveryAddress: z.string().optional().nullable(),
  deliveryFee: z.number().nonnegative().default(0)
});

router.post("/", validate(createOrderSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const tutorId = req.user!.id;
    const { items, deliveryMethod, deliveryAddress, deliveryFee } = req.body;

    // Collect items that cross the low-stock threshold so we can alert after the transaction
    const lowStockAlerts: Array<{ itemName: string; currentStock: number; reorderThreshold: number }> = [];

    await db.transaction(async (tx) => {
      // 1. Sort item IDs to prevent deadlocks when acquiring multiple row locks
      const sortedReqItems = [...items].sort((a: any, b: any) => a.catalogueItemId - b.catalogueItemId);
      const catalogueItems = [];
      const batchAllocations: any[] = [];
      const orderItemsToInsert: any[] = [];
      const inventoryMovementsToInsert: any[] = [];
      let subtotal = 0;

      for (const reqItem of sortedReqItems) {
        const [lockedItem] = await tx.select().from(catalogueItemsTable)
          .where(
            and(
              eq(catalogueItemsTable.id, reqItem.catalogueItemId),
              eq(catalogueItemsTable.crecheId, crecheId),
              eq(catalogueItemsTable.isActive, true)
            )
          )
          .for('update'); // Acquire row lock

        if (!lockedItem) {
          throw new Error(`Item ID ${reqItem.catalogueItemId} não encontrado ou inativo.`);
        }

        if (lockedItem.type === 'product') {
          if (lockedItem.stockQuantity < reqItem.quantity) {
            throw new Error(`Estoque insuficiente para o item: ${lockedItem.name}. Saldo: ${lockedItem.stockQuantity}`);
          }

          // Deduct stock directly from the catalogue item
          await tx.update(catalogueItemsTable)
            .set({ stockQuantity: sql`${catalogueItemsTable.stockQuantity} - ${reqItem.quantity}` })
            .where(eq(catalogueItemsTable.id, lockedItem.id));

          // Check if the new quantity will be at or below the reorder threshold
          const newQuantity = lockedItem.stockQuantity - reqItem.quantity;
          if (newQuantity <= lockedItem.minStockAlert) {
            lowStockAlerts.push({
              itemName: lockedItem.name,
              currentStock: newQuantity,
              reorderThreshold: lockedItem.minStockAlert,
            });
          }
        }
        
        catalogueItems.push(lockedItem);
      }

      for (const reqItem of items) {
        const catItem = catalogueItems.find(c => c.id === reqItem.catalogueItemId);
        if (!catItem) continue;

        const unitPrice = Number(catItem.basePrice);
        const totalPrice = unitPrice * reqItem.quantity;
        subtotal += totalPrice;

        orderItemsToInsert.push({
          tempId: catItem.id, // temporary reference
          catalogueItemId: catItem.id,
          quantity: reqItem.quantity,
          unitPrice: unitPrice.toString(),
          totalPrice: totalPrice.toString()
        });
      }

      const total = subtotal + Number(deliveryFee);

      let dueDateStr = new Date().toISOString().split('T')[0];
      if (!(await hasOverdueInvoices(tutorId))) {
        const [tutorRec] = await tx.select({ mensalidadeDia: usersTable.mensalidadeDia }).from(usersTable).where(eq(usersTable.id, tutorId)).limit(1);
        dueDateStr = calculateDueDate(tutorRec?.mensalidadeDia, new Date());
      } else {
        // If they have overdue invoices, we force payment today (no faturado)
        dueDateStr = new Date().toISOString().split('T')[0];
      }

      // 2. Create Invoice
      const [invoice] = await tx.insert(invoicesTable).values({
        crecheId,
        tutorId,
        amount: total.toString(),
        status: "pending",
        dueDate: dueDateStr,
      }).returning();

      // 3. Create Invoice Items
      for (const reqItem of orderItemsToInsert) {
        const catItem = catalogueItems.find(c => c.id === reqItem.catalogueItemId);
        await tx.insert(invoiceItemsTable).values({
          invoiceId: invoice.id,
          description: catItem!.name,
          quantity: reqItem.quantity,
          amount: reqItem.unitPrice
        });
      }
      
      if (Number(deliveryFee) > 0) {
        await tx.insert(invoiceItemsTable).values({
          invoiceId: invoice.id,
          description: "Taxa de Entrega",
          quantity: 1,
          amount: deliveryFee.toString()
        });
      }

      // 4. Create Order
      const [order] = await tx.insert(ordersTable).values({
        crecheId,
        tutorId,
        invoiceId: invoice.id,
        status: "pending_payment",
        deliveryMethod,
        deliveryAddress,
        deliveryFee: deliveryFee.toString(),
        subtotal: subtotal.toString(),
        total: total.toString()
      }).returning();

      // 5. Create Order Items
      for (const oi of orderItemsToInsert) {
        await tx.insert(orderItemsTable).values({
          orderId: order.id,
          catalogueItemId: oi.catalogueItemId,
          quantity: oi.quantity,
          unitPrice: oi.unitPrice,
          totalPrice: oi.totalPrice
        });
      }

      res.status(201).json({ order, invoice });
    });

    // Fire low-stock alerts asynchronously after the transaction commits — does not block the response
    if (lowStockAlerts.length > 0) {
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
            for (const alert of lowStockAlerts) {
              await sendLowStockAlertEmail({
                adminEmail: admin.email,
                adminName: admin.name,
                crecheName: creche.name,
                itemName: alert.itemName,
                currentStock: alert.currentStock,
                reorderThreshold: alert.reorderThreshold,
              });
            }
          }
        } catch (alertErr) {
          console.error("[low-stock-alert] Failed to send alert after POS sale:", alertErr);
        }
      })();
    }
  } catch (err: any) {
    if (err.message && err.message.includes("Estoque")) {
      res.status(400).json({ error: err.message });
    } else {
      next(err);
    }
  }
});

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const tutorId = req.user!.id;
    const role = req.user!.role;

    let query = db.select({
      order: ordersTable,
      tutor: {
        id: usersTable.id,
        name: usersTable.name,
        phone: usersTable.phone,
      },
      invoiceStatus: invoicesTable.status,
      invoiceAmount: invoicesTable.amount
    })
    .from(ordersTable)
    .leftJoin(usersTable, eq(ordersTable.tutorId, usersTable.id))
    .leftJoin(invoicesTable, eq(ordersTable.invoiceId, invoicesTable.id))
    .where(eq(ordersTable.crecheId, crecheId))
    .orderBy(desc(ordersTable.createdAt));

    const results = await query;
    
    // Filtro em memória simples para tutor (poderia ser na query tb)
    const filtered = role === 'tutor' 
      ? results.filter(r => r.order.tutorId === tutorId)
      : results;

    // Fetch items for each order
    const ordersWithItems = await Promise.all(filtered.map(async (r) => {
      const items = await db.select({
        quantity: orderItemsTable.quantity,
        unitPrice: orderItemsTable.unitPrice,
        totalPrice: orderItemsTable.totalPrice,
        name: catalogueItemsTable.name,
        mediaUrls: catalogueItemsTable.mediaUrls,
      })
      .from(orderItemsTable)
      .innerJoin(catalogueItemsTable, eq(orderItemsTable.catalogueItemId, catalogueItemsTable.id))
      .where(eq(orderItemsTable.orderId, r.order.id));

      return {
        ...r.order,
        tutor: r.tutor,
        invoiceStatus: r.invoiceStatus,
        invoiceAmount: r.invoiceAmount,
        items
      };
    }));

    res.json(ordersWithItems);
  } catch (err) {
    next(err);
  }
});

const updateStatusSchema = z.object({
  status: z.enum(["pending_payment", "paid", "preparing", "ready_for_pickup", "delivering", "delivered", "cancelled"])
});

router.put("/:orderId/status", requireCrecheAccess, validate(updateStatusSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const orderId = Number(req.params.orderId);
    const { status } = req.body;

    const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, orderId), eq(ordersTable.crecheId, crecheId)));
    if (!order) {
      res.status(404).json({ error: "Pedido não encontrado." });
      return;
    }

    if (status === 'cancelled' && order.status !== 'cancelled') {
      // Estornar estoque
      const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
      for (const item of items) {
        await db.update(catalogueItemsTable)
          .set({ stockQuantity: sql`${catalogueItemsTable.stockQuantity} + ${item.quantity}` })
          .where(eq(catalogueItemsTable.id, item.catalogueItemId));
          
        await db.insert(catalogueStockTransactionsTable).values({
          itemId: item.catalogueItemId,
          crecheId,
          type: 'in',
          quantity: item.quantity,
          reason: 'Cancelamento de Pedido',
          userId: req.user!.id
        });
      }
      
      // Cancelar invoice
      if (order.invoiceId) {
        await db.update(invoicesTable)
          .set({ status: 'voided' })
          .where(eq(invoicesTable.id, order.invoiceId));
      }
    }

    const [updatedOrder] = await db.update(ordersTable)
      .set({ status })
      .where(eq(ordersTable.id, orderId))
      .returning();

    if (["delivered", "ready_for_pickup", "paid"].includes(status) && order.invoiceId) {
      await db.transaction(async (tx) => {
        await releasePurchasedCredits(order.invoiceId!, req.user!.id, tx);
      });
    }

    res.json(updatedOrder);
  } catch (err) {
    next(err);
  }
});

export default router;
