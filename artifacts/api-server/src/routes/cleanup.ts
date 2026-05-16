import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate.js";

const router = Router();
router.use(authenticate);
router.use(requireRole("master_admin"));

router.post("/", async (_req: AuthRequest, res) => {
  await db.execute(sql`DELETE FROM timeline_likes`);
  await db.execute(sql`DELETE FROM timeline_events`);
  await db.execute(sql`DELETE FROM chat_messages`);
  await db.execute(sql`DELETE FROM push_subscriptions`);
  await db.execute(sql`DELETE FROM tasks`);
  await db.execute(sql`DELETE FROM bookings`);
  await db.execute(sql`DELETE FROM walks`);
  await db.execute(sql`DELETE FROM medications`);
  await db.execute(sql`DELETE FROM vaccines`);
  await db.execute(sql`DELETE FROM pets`);
  await db.execute(sql`DELETE FROM users WHERE role != 'master_admin'`);
  await db.execute(sql`DELETE FROM creches`);

  res.json({ ok: true, message: "Banco de produção limpo. Apenas o master_admin foi mantido." });
});

export default router;
