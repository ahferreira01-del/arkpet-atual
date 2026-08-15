import { Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { subscriptionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { AuthRequest } from "./authenticate.js";

// Statuses that hard-block the operational app.
// "past_due" is intentionally allowed through — UI shows a warning banner only.
const BLOCKED_STATUSES = new Set(["suspended", "cancelled"]);

/**
 * Central subscription enforcement gate.
 *
 * Applies to: creche_admin, staff (any user with a crecheId that isn't master_admin or tutor).
 * Bypasses: master_admin (platform ops), tutor (separate product scope), no crecheId.
 *
 * Blocks with HTTP 402:
 *   - expired trial (real-time check — doesn't wait for the hourly job)
 *   - suspended / cancelled
 *   - missing subscription row (no subscription = no free access)
 *
 * Allows:
 *   - active trial (trialEndsAt in the future)
 *   - past_due (grace period — banner shown in UI)
 *   - active subscription
 *
 * The authoritative source is the authenticated user's OWN crecheId, never the
 * (spoofable) :crecheId path param — the gate cannot be bypassed by targeting
 * another tenant's path.
 */
export async function requireActiveSubscription(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const role = req.user?.role;

  // master_admin: platform-wide bypass.
  if (role === "master_admin") {
    next();
    return;
  }

  // Tutor: scope excluded from this enforcement phase — behavior unchanged.
  if (role === "tutor") {
    next();
    return;
  }

  // No authenticated user or no creche association — let auth middleware handle it.
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

  // Missing subscription row → block. Absence ≠ free lifetime access.
  if (!sub) {
    res.status(402).json({
      error: "subscription_missing",
      message: "Nenhuma assinatura encontrada. Assine um plano para continuar.",
      status: "missing",
    });
    return;
  }

  // Real-time trial expiry check — does not wait for the hourly job.
  if (sub.status === "trial" && sub.trialEndsAt && new Date(sub.trialEndsAt) < new Date()) {
    res.status(402).json({
      error: "trial_expired",
      message: "O período de teste encerrou. Assine um plano para continuar usando o sistema.",
      status: "trial_expired",
    });
    return;
  }

  // Hard-blocked statuses.
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
