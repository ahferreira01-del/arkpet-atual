import { Router } from "express";
import { db } from "@workspace/db";
import {
  bookingsTable,
  chatMessagesTable,
  crechesTable,
  medicationsTable,
  passwordResetTokensTable,
  petsTable,
  pushSubscriptionsTable,
  subscriptionsTable,
  tasksTable,
  timelineEventsTable,
  timelineLikesTable,
  usersTable,
  vaccinesTable,
  walksTable,
} from "@workspace/db/schema";

const WIPE_TOKEN = "arkpet-wipe-2026-prod";

const router = Router();

router.post("/admin/wipe", async (req, res) => {
  const auth = req.headers["authorization"] ?? "";
  if (auth !== `Bearer ${WIPE_TOKEN}`) {
    return res.status(403).json({ error: "Forbidden" });
  }

  await db.delete(timelineLikesTable);
  await db.delete(timelineEventsTable);
  await db.delete(chatMessagesTable);
  await db.delete(bookingsTable);
  await db.delete(walksTable);
  await db.delete(tasksTable);
  await db.delete(vaccinesTable);
  await db.delete(medicationsTable);
  await db.delete(petsTable);
  await db.delete(pushSubscriptionsTable);
  await db.delete(passwordResetTokensTable);
  await db.delete(subscriptionsTable);
  await db.delete(usersTable);
  await db.delete(crechesTable);

  console.log("[admin-wipe] Banco de produção limpo.");
  return res.json({ ok: true, message: "Banco limpo com sucesso." });
});

export default router;
