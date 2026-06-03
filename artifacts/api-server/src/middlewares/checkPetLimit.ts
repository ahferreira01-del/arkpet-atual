import { Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { petsTable, subscriptionsTable, plansTable } from "@workspace/db/schema";
import { and, eq, count } from "drizzle-orm";
import type { AuthRequest } from "./authenticate.js";

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
    .select({ planId: subscriptionsTable.planId })
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

  const [{ total }] = await db
    .select({ total: count() })
    .from(petsTable)
    .where(and(eq(petsTable.crecheId, crecheId), eq(petsTable.status, "active")));

  if (Number(total) >= plan.petLimit) {
    res.status(403).json({
      error: "pet_limit_reached",
      message: `Limite de ${plan.petLimit} pets atingido no seu plano. Faça upgrade para cadastrar mais.`,
      current: Number(total),
      limit: plan.petLimit,
    });
    return;
  }

  next();
}
