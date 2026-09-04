import { Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { petsTable, subscriptionsTable, plansTable } from "@workspace/db/schema";
import { and, eq, count } from "drizzle-orm";
import type { AuthRequest } from "./authenticate.js";
import {
  resolveActiveCommercialCondition,
  CommercialConditionIntegrityError,
} from "../services/commercialConditions.js";

/**
 * Authoritative shared active pet count helper.
 * Strictly guarantees the Support Console, API endpoints, and checkPetLimit
 * evaluate the exact same definition of an active pet (R36.D Correction 6).
 */
export async function countActivePetsForCreche(
  crecheId: number,
  dbOrTx: any = db,
): Promise<number> {
  const [{ total }] = await dbOrTx
    .select({ total: count() })
    .from(petsTable)
    .where(and(eq(petsTable.crecheId, crecheId), eq(petsTable.status, "active")));
  return Number(total);
}

export async function checkPetLimit(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role === "master_admin") {
    next();
    return;
  }

  const crecheId = Number(req.params.crecheId);
  if (!crecheId || Number.isNaN(crecheId)) {
    res.status(400).json({ error: "Creche inválida." });
    return;
  }

  const [sub] = await db
    .select({
      planId: subscriptionsTable.planId,
      activeConditionId: subscriptionsTable.activeConditionId,
    })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.crecheId, crecheId))
    .limit(1);

  if (!sub) {
    next();
    return;
  }

  const [plan] = await db
    .select({ petLimit: plansTable.petLimit })
    .from(plansTable)
    .where(eq(plansTable.id, sub.planId))
    .limit(1);

  if (!plan) {
    next();
    return;
  }

  // Resolve active condition if pointer exists (R36.D Correction 5)
  let effectivePetLimit = plan.petLimit;
  if (sub.activeConditionId) {
    try {
      const condition = await resolveActiveCommercialCondition(
        crecheId,
        sub.activeConditionId,
        db,
      );
      if (condition?.entitlementPetLimit && condition.entitlementPetLimit > 0) {
        effectivePetLimit = condition.entitlementPetLimit;
      }
    } catch (err) {
      if (err instanceof CommercialConditionIntegrityError) {
        res.status(500).json({
          error: "commercial_condition_integrity_error",
          message: err.message,
        });
        return;
      }
      throw err;
    }
  }

  const currentTotal = await countActivePetsForCreche(crecheId, db);

  if (currentTotal >= effectivePetLimit) {
    res.status(403).json({
      error: "pet_limit_reached",
      message: `Limite de ${effectivePetLimit} pets atingido no seu plano. Faça upgrade para cadastrar mais.`,
      current: currentTotal,
      limit: effectivePetLimit,
    });
    return;
  }

  next();
}
