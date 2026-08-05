import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";

/**
 * Restricts access to creche_admin and staff.
 * Tutors are blocked with 403.
 */
export function requireFinancialAccess(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const user = req.user;
  if (!user || (user.role !== "creche_admin" && user.role !== "staff")) {
    res.status(403).json({ error: "Acesso não autorizado para tutores." });
    return;
  }
  next();
}
