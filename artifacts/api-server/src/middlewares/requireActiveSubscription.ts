import { Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { subscriptionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { AuthRequest } from "./authenticate.js";

// Statuses that hard-block write actions. "past_due" is intentionally allowed
// through as a grace period (the UI shows a warning banner instead).
const BLOCKED_STATUSES = new Set(["suspended", "cancelled"]);

// Gate for creating new billable resources (pets, bookings). master_admin and
// creches without a subscription row pass through untouched.
export async function requireActiveSubscription(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role === "master_admin") {
    next();
    return;
  }

  // Authoritative on the authenticated user's own creche — never the (spoofable)
  // path param — so the gate cannot be bypassed by targeting another tenant path.
  const crecheId = req.user?.crecheId ?? undefined;
  if (!crecheId) {
    next();
    return;
  }

  const [sub] = await db
    .select({ status: subscriptionsTable.status, trialEndsAt: subscriptionsTable.trialEndsAt })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.crecheId, crecheId))
    .limit(1);

  if (!sub) {
    next();
    return;
  }

  // Trial expired: treat the same as suspended.
  if (sub.status === "trial" && sub.trialEndsAt && new Date(sub.trialEndsAt) < new Date()) {
    res.status(402).json({
      error: "trial_expired",
      message: "O período de teste encerrou. Assine um plano para continuar usando o sistema.",
      status: "trial_expired",
    });
    return;
  }

  if (BLOCKED_STATUSES.has(sub.status)) {
    res.status(402).json({
      error: "subscription_inactive",
      message: "A assinatura da creche está inativa. Regularize o pagamento para continuar.",
      status: sub.status,
    });
    return;
  }

  next();
}
