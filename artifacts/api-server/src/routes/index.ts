import { Router } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import crechesRouter from "./creches.js";
import petsRouter from "./pets.js";
import bookingsRouter from "./bookings.js";
import tasksRouter from "./tasks.js";
import chatRouter from "./chat.js";
import usersRouter from "./users.js";
import pushRouter from "./push.js";
import walksRouter from "./walks.js";
import storageRouter from "./storage.js";
import tutorTimelineRouter from "./tutor-timeline.js";
import feedRouter from "./feed-v2.js";
import billingRouter from "./billing.js";
import financialRouter from "./financial.js";
import financialAnalyticsRouter from "./financial-analytics.js";
import financialSearchRouter from "./financial-search.js";
import financialReportsRouter from "./financial-reports.js";
import medicalRouter from "./medical.js";
import ordersRouter from "./orders.js";
import logsRouter from "./logs.js";

const router = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use("/auth", authRouter);
router.use("/creches", crechesRouter);
router.use("/creches/:crecheId/pets", petsRouter);
router.use("/creches/:crecheId/bookings", bookingsRouter);
router.use("/creches/:crecheId/tasks", tasksRouter);
router.use("/creches/:crecheId/chat", chatRouter);
router.use("/creches/:crecheId/walks", walksRouter);
router.use("/creches/:crecheId/pets/:petId/walks", walksRouter);

router.use("/creches/:crecheId/tutor-timeline", tutorTimelineRouter);
router.use("/creches/:crecheId/feed", feedRouter);
router.use("/creches/:crecheId/financial", financialRouter);
router.use("/creches/:crecheId/financial", financialAnalyticsRouter);
router.use("/creches/:crecheId/financial", financialSearchRouter);
router.use("/creches/:crecheId/financial", financialReportsRouter);
router.use("/creches/:crecheId/medical", medicalRouter);
router.use("/creches/:crecheId/orders", ordersRouter);
router.use("/users", usersRouter);
router.use("/push", pushRouter);
router.use("/billing", billingRouter);
router.use(logsRouter);

// ── Versão do app ────────────────────────────────────────────────────────────
// Deve ser bumped junto com CACHE_NAME em public/sw.js a cada deploy que
// quebre compatibilidade com clientes antigos.
export const APP_VERSION = "arkpet-v19";
router.get("/version", (_req, res) => {
  res.json({ version: APP_VERSION });
});

// ── Catch-all: rota não encontrada → sempre JSON, nunca HTML ─────────────────
// Garante que qualquer requisição a /api/* que não bater em nenhuma rota
// receba JSON, em vez do HTML padrão do Express, que quebra o customFetch.
router.use((_req, res) => {
  res.status(404).json({ error: "Rota não encontrada" });
});

export default router;
