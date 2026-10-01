import { Response, NextFunction } from "express";
import type { AuthRequest } from "./authenticate.js";
import { logger } from "../lib/logger.js";

// Tenant isolation for /creches/:crecheId/* routes: a user may only act within
// their own creche. master_admin (platform-wide) is exempt. Without this, the
// :crecheId path segment is attacker-controlled and any authenticated user could
// read or write another tenant's data.
export function requireCrecheMembership(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role === "master_admin") {
    next();
    return;
  }

  const crecheId = Number(req.params.crecheId);
  if (!crecheId || Number.isNaN(crecheId)) {
    res.status(400).json({ error: "Creche inválida." });
    return;
  }

  if (req.user?.crecheId !== crecheId) {
    logger.warn("authorization_denied", {
      requestId: (req as any).id,
      userId: req.user?.id,
      role: req.user?.role,
      userCrecheId: req.user?.crecheId ?? undefined,
      targetCrecheId: crecheId,
      reason: "cross_tenant_access_attempt",
      path: req.path,
      method: req.method,
    });
    res.status(403).json({ error: "Sem acesso a esta creche." });
    return;
  }

  next();
}
