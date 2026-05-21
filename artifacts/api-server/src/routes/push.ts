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
  const { endpoint, p256dh, auth, oldEndpoint } = req.body;
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
      userId = payload?.userId ?? null;
    } catch {}
  }

  // 1. Direct hit by new endpoint → update in place
  const existing = await db.select().from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint)).limit(1);
  if (existing.length) {
    const update: Record<string, any> = { p256dh, auth };
    if (userId) update.userId = userId;
    await db.update(pushSubscriptionsTable).set(update)
      .where(eq(pushSubscriptionsTable.endpoint, endpoint));
    console.log(`[push] Subscription refreshed for userId=${existing[0].userId} (endpoint matched)`);
    res.json({ message: "Assinatura atualizada" }); return;
  }

  // 2. Subscription rotation: SW sent oldEndpoint → carry over the userId.
  // Security: the new endpoint MUST be on the same push-service origin as the
  // old one. This blocks the attack where someone who learned a victim's
  // endpoint URL tries to redirect their notifications to an attacker-owned
  // push subscription on a different host.
  if (oldEndpoint) {
    try {
      const oldHost = new URL(oldEndpoint).host;
      const newHost = new URL(endpoint).host;
      if (oldHost !== newHost) {
        console.warn(`[push] Rotation rejected: host mismatch (${oldHost} → ${newHost})`);
        res.status(403).json({ error: "Rotação inválida" }); return;
      }
    } catch {
      res.status(400).json({ error: "Endpoint inválido" }); return;
    }
    const prev = await db.select().from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.endpoint, oldEndpoint)).limit(1);
    if (prev.length) {
      await db.update(pushSubscriptionsTable)
        .set({ endpoint, p256dh, auth })
        .where(eq(pushSubscriptionsTable.endpoint, oldEndpoint));
      console.log(`[push] Subscription rotated for userId=${prev[0].userId}`);
      res.json({ message: "Assinatura rotacionada" }); return;
    }
  }

  if (!userId) {
    res.status(401).json({ error: "Token necessário para nova assinatura" }); return;
  }

  await db.insert(pushSubscriptionsTable).values({ userId, endpoint, p256dh, auth });
  console.log(`[push] New subscription stored for userId=${userId}`);
  res.status(201).json({ message: "Assinatura registrada" });
});

// POST /api/push/test — sends a test push to the current user
router.post("/test", authenticate, async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }
  const { sendPushToUser } = await import("../lib/push.js");
  await sendPushToUser(req.user.id, {
    title: "ArkPet — Teste",
    body: "Notificações funcionando! 🎉",
    tag: `test-${req.user.id}`,
    data: { type: "test" },
  });
  res.json({ message: "Teste enviado" });
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
