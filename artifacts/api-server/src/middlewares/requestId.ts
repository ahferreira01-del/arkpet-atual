import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

const REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

export function isValidRequestId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  return REQUEST_ID_REGEX.test(id);
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers["x-request-id"];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;

  const validId = isValidRequestId(candidate) ? candidate : crypto.randomUUID();

  // Attach correlation ID to both request and response header
  (req as any).id = validId;
  res.setHeader("X-Request-ID", validId);

  next();
}
