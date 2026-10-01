import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";

export const SLOW_REQUEST_THRESHOLD_MS = 1500;

export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const requestId = (req as any).id;
    const user = (req as any).user;

    const context = {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
      ...(user && {
        userId: user.id,
        role: user.role,
        crecheId: user.crecheId ?? undefined,
      }),
    };

    if (durationMs >= SLOW_REQUEST_THRESHOLD_MS) {
      logger.warn("slow_request", context);
    } else if (res.statusCode >= 500) {
      logger.error("request_failed", context);
    } else if (res.statusCode >= 400) {
      logger.warn("request_client_error", context);
    } else {
      logger.info("request_completed", context);
    }
  });

  next();
}
