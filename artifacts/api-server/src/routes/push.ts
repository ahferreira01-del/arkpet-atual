import { Router } from "express";
import { db } from "@workspace/db";
import { pushSubscriptionsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";

const router = Router();

// GET VAPID public key — public, no auth needed (it's a public key)
router.get("/vapid-public-key", (_req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY ?? null });
});

// POST subscribe — accepts both authenticated (user session) and anonymous
// (service worker pushsubscriptionchange, no token available)
router.post("/subscribe", async (req: AuthRequest, res) => {
  const { endpoint, p256dh, auth } = req.body;
  if (!endpoint || !p256dh || !auth) {
    res.status(400).json({ error: "endpoint, p256dh e auth são obrigatórios" }); return;
  }

  // Try to identify user from auth token if present
  const authHeader = req.headers.authorization;
  let userId: number | null = null;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const { verifyToken } = await import("../lib/auth.js");
      const payload = verifyToken(authHeader.slice(7));
      userId = (payload as any)?.id ?? null;
    } catch {}
  }

  const existing = await db.select().from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint)).limit(1);

  if (existing.length) {
    const update: Record<string, any> = { p256dh, auth };
    if (userId) update.userId = userId;
    await db.update(pushSubscriptionsTable)
      .set(update)
      .where(eq(pushSubscriptionsTable.endpoint, endpoint));
    res.json({ message: "Assinatura atualizada" });
    return;
  }

  if (!userId) {
    // Can't create new subscription without knowing the user
    res.status(401).json({ error: "Token necessário para nova assinatura" }); return;
  }

  await db.insert(pushSubscriptionsTable).values({ userId, endpoint, p256dh, auth });
  res.status(201).json({ message: "Assinatura registrada" });
});

// DELETE unsubscribe — requires auth
router.delete("/subscribe", authenticate, async (req: AuthRequest, res) => {
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
