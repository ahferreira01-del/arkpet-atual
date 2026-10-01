import { Router } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import crechesRouter, { acceptInvitationHandler } from "./creches.js";
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
import financialRouter from "./financial/index.js";
import financialAnalyticsRouter from "./financial-analytics.js";
import financialSearchRouter from "./financial-search.js";
import financialReportsRouter from "./financial-reports.js";
import medicalRouter from "./medical.js";
import ordersRouter from "./orders.js";
import logsRouter from "./logs.js";
import { commercialRouter } from "./commercial.js";
import tutorCommercialRouter from "./tutorCommercial.routes.js";
import crecheCampaignRouter from "./crecheCampaign.routes.js";
import marketingOpportunityRouter from "./marketingOpportunity.routes.js";
import crecheCommercialMetricsRouter from "./crecheCommercialMetrics.routes.js";
import tutorCommercialOffersRouter from "./tutorCommercialOffers.routes.js";
import searchRouter from "./search.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireActiveSubscription } from "../middlewares/requireActiveSubscription.js";
import { requireCrecheMembership } from "../middlewares/requireCrecheMembership.js";

const router = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use("/auth", authRouter);
router.use("/commercial", commercialRouter);

// ── R38.C3 DEC-C3-SCOPE-01: Public invitation acceptance endpoint ──────────
// Mounted BEFORE the central authenticate / requireActiveSubscription gate
// because invited staff members do not yet possess an active ArkPet user account or JWT.
router.post("/creches/:crecheId/invitations/:invitationId/accept", acceptInvitationHandler);

// ── Central subscription gate ─────────────────────────────────────────────────
// Applies to every /creches/:crecheId/* route (all tenant operational endpoints).
// Recovery routes (/auth, /billing, /push, /users, /healthz) are mounted outside
// this path and remain accessible regardless of subscription status — ensuring
// the user can always authenticate, view plans, and complete payment recovery.
//
// authenticate runs first so req.user is populated before the subscription check.
// Individual sub-routers also call authenticate (defence-in-depth); the second
// call is idempotent and adds one extra DB round-trip per request — acceptable.
router.use("/creches/:crecheId", authenticate, requireActiveSubscription);

router.use("/creches", crechesRouter);
router.use("/creches/:crecheId/commercial", commercialRouter);
router.use("/creches/:crecheId/pets", petsRouter);
router.use("/creches/:crecheId/bookings", bookingsRouter);
router.use("/creches/:crecheId/tasks", tasksRouter);
router.use("/creches/:crecheId/chat", chatRouter);
router.use("/creches/:crecheId/walks", walksRouter);
router.use("/creches/:crecheId/pets/:petId/walks", walksRouter);

router.use("/creches/:crecheId/tutor-timeline", tutorTimelineRouter);
router.use("/creches/:crecheId/feed", feedRouter);
router.use("/creches/:crecheId/financial", requireCrecheMembership, financialRouter);
router.use("/creches/:crecheId/financial", requireCrecheMembership, financialAnalyticsRouter);
router.use("/creches/:crecheId/financial", requireCrecheMembership, financialSearchRouter);
router.use("/creches/:crecheId/financial", requireCrecheMembership, financialReportsRouter);
router.use("/creches/:crecheId/medical", medicalRouter);
router.use("/creches/:crecheId/orders", requireCrecheMembership, ordersRouter);
router.use("/creches/:crecheId/tutors/:tutorId/commercial-conditions", requireCrecheMembership, tutorCommercialRouter);
router.use("/creches/:crecheId/campaigns", requireCrecheMembership, crecheCampaignRouter);
router.use("/creches/:crecheId/marketing/opportunities", requireCrecheMembership, marketingOpportunityRouter);
router.use("/creches/:crecheId/marketing/metrics", requireCrecheMembership, crecheCommercialMetricsRouter);
router.use("/creches/:crecheId/tutor/commercial-offers", requireCrecheMembership, tutorCommercialOffersRouter);
router.use("/users", usersRouter);
router.use("/push", pushRouter);
router.use("/billing", billingRouter);
router.use("/search", searchRouter);
router.use(logsRouter);

// ── Versão do app ────────────────────────────────────────────────────────────
// Deve ser bumped junto com CACHE_NAME em public/sw.js a cada deploy que
// quebre compatibilidade com clientes antigos.
import { handleGetVersion, APP_VERSION } from "../lib/version.js";
export { APP_VERSION };
router.get("/version", (req, res) => handleGetVersion(req, res));

// ── Catch-all: rota não encontrada → sempre JSON, nunca HTML ─────────────────
// Garante que qualquer requisição a /api/* que não bater em nenhuma rota
// receba JSON, em vez do HTML padrão do Express, que quebra o customFetch.
router.use((_req, res) => {
  res.status(404).json({ error: "Rota não encontrada" });
});

export default router;
