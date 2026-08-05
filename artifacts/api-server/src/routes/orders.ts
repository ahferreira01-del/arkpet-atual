/**
 * routes/orders.ts — Fase 8: controller fino
 *
 * Toda lógica de negócio foi extraída para services/orders.ts.
 * Esta rota apenas recebe, valida e delega.
 */

import { Router, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  ordersTable,
  orderItemsTable,
  catalogueItemsTable,
  invoicesTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate.js";
import { validate } from "../middlewares/validate.js";
import { z } from "zod";
import { createOrder, cancelOrder, dispatchLowStockAlerts } from "../services/orders.js";
import { releasePurchasedCredits } from "../services/credits.js";
import { OutboxRepository } from "../repositories/outbox.repository.js";
import type { FinancialDomainEvent } from "../services/events.js";

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

// ─── POST / — Criar pedido ───────────────────────────────────────────────────
router.post("/", validate(createOrderSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const tutorId = req.user!.id;
    const { items, deliveryMethod, deliveryAddress, deliveryFee } = req.body;

    const { result, lowStockAlerts } = await createOrder({
      crecheId,
      tutorId,
      items,
      deliveryMethod,
      deliveryAddress,
      deliveryFee,
    });

    res.status(201).json(result);

    // Disparar alertas de baixo estoque de forma assíncrona — não bloqueia a resposta
    dispatchLowStockAlerts(crecheId, lowStockAlerts).catch(() => {});
  } catch (err: any) {
    if (err.message && err.message.includes("Estoque")) {
      res.status(400).json({ error: err.message });
    } else {
      next(err);
    }
  }
});

// ─── GET / — Listar pedidos ──────────────────────────────────────────────────
router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const tutorId = req.user!.id;
    const role = req.user!.role;

    const results = await db.select({
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

    const filtered = role === "tutor"
      ? results.filter(r => r.order.tutorId === tutorId)
      : results;

    const ordersWithItems = await Promise.all(filtered.map(async (r) => {
      const orderItems = await db.select({
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
        items: orderItems,
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

// ─── PUT /:orderId/status — Atualizar status ─────────────────────────────────
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

    // Fase 8: cancelamento delegado ao OrderService.
    // cancelOrder() includes the status→cancelled update inside its own
    // transaction together with the outbox events, so they are atomic.
    if (status === "cancelled" && order.status !== "cancelled") {
      const cancelledOrder = await cancelOrder({ order, crecheId, userId: req.user!.id });
      res.json(cancelledOrder);
      return;
    }

    // Status update + credit release + outbox event must all commit in ONE
    // transaction. Lock the row first so concurrent requests see the same
    // pre-transition state — preventing duplicate credit releases and
    // duplicate OrderPaid events when the same status is set twice.
    const updatedOrder = await db.transaction(async (tx) => {
      // Re-read with a row-level lock to get the authoritative pre-update status.
      const [locked] = await tx
        .select()
        .from(ordersTable)
        .where(and(eq(ordersTable.id, orderId), eq(ordersTable.crecheId, crecheId)))
        .for("update");

      if (!locked) throw Object.assign(new Error("Pedido não encontrado."), { status: 404 });

      const [updated] = await tx
        .update(ordersTable)
        .set({ status })
        .where(eq(ordersTable.id, orderId))
        .returning();

      // Credit release happens at the first transition into
      // {ready_for_pickup, paid, delivered}. Gate on the pre-update status
      // so a ready_for_pickup → delivered sequence does not release twice.
      const creditsAlreadyReleased = (["ready_for_pickup", "paid", "delivered"] as string[]).includes(locked.status);
      // OrderPaid emits only when the order first reaches paid/delivered.
      // A ready_for_pickup → paid sequence must still emit the event; a
      // paid → delivered repeat must not.
      const orderAlreadyPaid = (["paid", "delivered"] as string[]).includes(locked.status);

      if (["delivered", "ready_for_pickup", "paid"].includes(status) && locked.invoiceId) {
        if (!creditsAlreadyReleased) {
          await releasePurchasedCredits(locked.invoiceId!, req.user!.id, tx);
        }
        if ((status === "paid" || status === "delivered") && !orderAlreadyPaid) {
          await OutboxRepository.insert({
            type: "OrderPaid",
            crecheId,
            invoiceId: locked.invoiceId!,
            occurredAt: new Date().toISOString(),
          } as FinancialDomainEvent, tx);
        }
      }

      return updated;
    });

    res.json(updatedOrder);
  } catch (err) {
    next(err);
  }
});

export default router;
