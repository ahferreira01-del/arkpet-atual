import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/auth.js";
import { db } from "@workspace/db";
import { usersTable, crechesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export interface AuthRequest extends Request {
  user?: {
    id: number;
    role: string;
    crecheId: number | null;
    name: string;
    email: string;
  };
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  if (user.isActive === false) {
    res.status(401).json({ error: "Conta desativada. Entre em contato com o administrador." });
    return;
  }
  // Invalidate tokens issued before the last password change (e.g. after a reset).
  if (user.passwordChangedAt && payload.issuedAt < user.passwordChangedAt.getTime()) {
    res.status(401).json({ error: "Sessão expirada. Entre novamente." });
    return;
  }
  // Block access if user belongs to an archived tenant (non-master)
  if (user.crecheId != null && user.role !== "master_admin") {
    const [creche] = await db
      .select({ status: crechesTable.status })
      .from(crechesTable)
      .where(eq(crechesTable.id, user.crecheId))
      .limit(1);

    if (creche && creche.status === "archived") {
      logger.warn("authorization_denied", {
        requestId: (req as any).id,
        userId: user.id,
        role: user.role,
        crecheId: user.crecheId,
        reason: "tenant_archived",
        path: req.path,
        method: req.method,
      });
      res.status(403).json({
        error: "tenant_archived",
        code: "tenant_archived",
        message: "Esta creche foi arquivada. Acesso bloqueado.",
      });
      return;
    }
  }
  req.user = { id: user.id, role: user.role, crecheId: user.crecheId, name: user.name, email: user.email };
  next();
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      logger.warn("authorization_denied", {
        requestId: (req as any).id,
        userId: req.user?.id,
        role: req.user?.role,
        crecheId: req.user?.crecheId ?? undefined,
        requiredRoles: roles,
        reason: "insufficient_role",
        path: req.path,
        method: req.method,
      });
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
