import { Router } from "express";
import { db } from "@workspace/db";
import { pushSubscriptionsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";

const router = Router();
router.use(authenticate);

// GET VAPID public key
router.get("/vapid-public-key", (_req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY ?? null });
});

// POST subscribe
router.post("/subscribe", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }
  const { endpoint, p256dh, auth } = req.body;
  if (!endpoint || !p256dh || !auth) {
    res.status(400).json({ error: "endpoint, p256dh e auth são obrigatórios" }); return;
  }
  const existing = await db.select().from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint)).limit(1);
  if (existing.length) {
    await db.update(pushSubscriptionsTable)
      .set({ userId: req.user.id, p256dh, auth })
      .where(eq(pushSubscriptionsTable.endpoint, endpoint));
    res.json({ message: "Assinatura atualizada" });
    return;
  }
  await db.insert(pushSubscriptionsTable).values({
    userId: req.user.id, endpoint, p256dh, auth,
  });
  res.status(201).json({ message: "Assinatura registrada" });
});

// DELETE unsubscribe
router.delete("/subscribe", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }
  const { endpoint } = req.body;
  if (!endpoint) { res.status(400).json({ error: "endpoint obrigatório" }); return; }
  await db.delete(pushSubscriptionsTable)
    .where(and(
      eq(pushSubscriptionsTable.userId, req.user.id),
      eq(pushSubscriptionsTable.endpoint, endpoint),
    ));
  res.json({ message: "Assinatura removida" });
});

export default router;
