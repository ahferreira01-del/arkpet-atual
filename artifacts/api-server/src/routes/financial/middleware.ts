import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";

/**
 * Restricts management financial access to creche_admin only.
 * Staff, tutors, and master_admin are blocked with 403.
 */
export function requireFinancialAccess(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const user = req.user;
  if (!user || user.role !== "creche_admin") {
    res.status(403).json({ error: "Acesso restrito ao administrador da creche." });
    return;
  }
  next();
}
