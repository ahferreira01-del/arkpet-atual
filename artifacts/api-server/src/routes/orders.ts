/**
 * routes/orders.ts — Fase R24F: controller fino e seguro
 *
 * - Tenant isolation: requireCrecheMembership
 * - Role enforcement: POST / apenas para role === 'tutor'
 * - Idempotency: operationId UUID obrigatório
 * - Delivery fee: autoridade 100% do servidor
 * - State machine: proíbe forjar 'paid' diretamente e proíbe avanço operacional sem fatura paga
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
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { requireCrecheMembership } from "../middlewares/requireCrecheMembership.js";
import { validate } from "../middlewares/validate.js";
import { z } from "zod";
import { createOrder, cancelOrder, dispatchLowStockAlerts } from "../services/orders.js";
import {
  acquireTenantOperationalLock,
  TenantArchivedError,
} from "../services/tenantLifecycleLock.js";
import { sendPushToRole, sendPushToUser } from "../lib/push.js";

const router = Router({ mergeParams: true });
router.use(authenticate);
router.use(requireCrecheMembership);

function requireCrecheAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user || (user.role !== "creche_admin" && user.role !== "staff")) {
    res.status(403).json({ error: "Acesso não autorizado para tutores." });
    return;
  }
  next();
}

const createOrderSchema = z.object({
  operationId: z.string().uuid("operationId deve ser um UUID válido"),
  items: z.array(z.object({
    catalogueItemId: z.number().int().positive(),
    quantity: z.number().int().positive()
  })).min(1),
  deliveryMethod: z.enum(["pickup", "delivery"]),
  deliveryAddress: z.string().optional().nullable(),
  deliveryFee: z.number().nonnegative().optional()
});

// ─── POST / — Criar pedido (Tutor Store) ──────────────────────────────────────
router.post("/", validate(createOrderSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user!.role !== "tutor") {
      res.status(403).json({ error: "Apenas tutores podem realizar compras na loja." });
      return;
    }

    const crecheId = Number(req.params.crecheId);
    const tutorId = req.user!.id;
    const { operationId, items, deliveryMethod, deliveryAddress, deliveryFee } = req.body;

    const { result, lowStockAlerts } = await createOrder({
      crecheId,
      tutorId,
      operationId,
      items,
      deliveryMethod,
      deliveryAddress,
      deliveryFee,
    });

    res.status(201).json(result);

    // Notificar a creche sobre o novo pedido — fire-and-forget.
    sendPushToRole(crecheId, "creche_admin", {
      title: "🛍️ Novo pedido recebido",
      body: `Um tutor realizou um pedido na loja. Verifique os pedidos.`,
      tag: `order-new-${result.order.id}`,
      data: { type: "order", orderId: result.order.id, crecheId },
    }).catch(() => {});

    // Disparar alertas de baixo estoque de forma assíncrona — não bloqueia a resposta
    dispatchLowStockAlerts(crecheId, lowStockAlerts).catch(() => {});
  } catch (err: any) {
    if (err.status === 409 || (err.message && err.message.includes("Operação já processada"))) {
      res.status(409).json({ error: err.message });
    } else if (
      err.status === 400 ||
      (err.message && (
        err.message.includes("Estoque") ||
        err.message.includes("não encontrado ou inativo") ||
        err.message.includes("inativo")
      ))
    ) {
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

    // Pedidos cancelados não podem ser reativados
    if (order.status === "cancelled" && status !== "cancelled") {
      res.status(409).json({ error: "Pedidos cancelados não podem ser reativados." });
      return;
    }

    // Status 'paid' é controlado exclusivamente pela conciliação de pagamento da fatura
    if (status === "paid") {
      res.status(409).json({ error: "O status pago é controlado exclusivamente pela confirmação do pagamento da fatura." });
      return;
    }

    // Cancelamento delegado ao OrderService
    if (status === "cancelled") {
      const cancelledOrder = await cancelOrder({ order, crecheId, userId: req.user!.id });
      res.json(cancelledOrder);
      sendPushToUser(order.tutorId, {
        title: "❌ Pedido cancelado",
        body: "Seu pedido na loja foi cancelado pela creche.",
        tag: `order-status-${orderId}`,
        data: { type: "order_status", orderId, crecheId },
      }).catch(() => {});
      return;
    }

    // Status operacionais (preparing, ready_for_pickup, delivering, delivered)
    // exigem que a fatura vinculada já esteja paga
    if (["preparing", "ready_for_pickup", "delivering", "delivered"].includes(status)) {
      if (order.invoiceId) {
        const [inv] = await db.select({ status: invoicesTable.status }).from(invoicesTable).where(eq(invoicesTable.id, order.invoiceId));
        if (!inv || inv.status !== "paid") {
          res.status(409).json({ error: "O pedido não pode avançar para status operacional antes da confirmação do pagamento da fatura." });
          return;
        }
      }
    }

    const updatedOrder = await db.transaction(async (tx) => {
      await acquireTenantOperationalLock(crecheId, tx);

      const [locked] = await tx
        .select()
        .from(ordersTable)
        .where(and(eq(ordersTable.id, orderId), eq(ordersTable.crecheId, crecheId)))
        .for("update");

      if (!locked) throw Object.assign(new Error("Pedido não encontrado."), { status: 404 });

      if (locked.status === "cancelled" && status !== "cancelled") {
        throw Object.assign(new Error("Pedidos cancelados não podem ser reativados."), { status: 409 });
      }

      const [updated] = await tx
        .update(ordersTable)
        .set({ status })
        .where(eq(ordersTable.id, orderId))
        .returning();

      return updated;
    });

    res.json(updatedOrder);

    // Notificar tutor sobre a mudança de status — fire-and-forget.
    const statusLabels: Record<string, string> = {
      pending_payment: "Aguardando pagamento",
      paid: "Pagamento confirmado ✅",
      preparing: "Em preparação 👨‍🍳",
      ready_for_pickup: "Pronto para retirada 🛍️",
      delivering: "Saiu para entrega 🚚",
      delivered: "Pedido entregue! 🎉",
      cancelled: "Pedido cancelado ❌",
    };
    sendPushToUser(updatedOrder.tutorId, {
      title: "📦 Pedido atualizado",
      body: statusLabels[status] ?? `Status: ${status}`,
      tag: `order-status-${orderId}`,
      data: { type: "order_status", orderId, crecheId },
    }).catch(() => {});
  } catch (err: any) {
    if (err instanceof TenantArchivedError || err?.code === "tenant_archived" || err?.message === "tenant_archived") {
      res.status(403).json({ error: "tenant_archived", code: "tenant_archived", message: "Esta creche foi arquivada. Operações desabilitadas." });
      return;
    }
    if (err.status === 409 || err.message?.includes("não pode avançar") || err.message?.includes("cancelados")) {
      res.status(409).json({ error: err.message });
    } else {
      next(err);
    }
  }
});

export default router;
