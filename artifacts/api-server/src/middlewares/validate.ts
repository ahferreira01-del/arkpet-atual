import { Request, Response, NextFunction } from "express";
import { z } from "zod";

export function validate<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      // Surface the first descriptive Zod issue message so callers get actionable feedback
      const firstIssue = result.error.issues[0];
      const errorMsg = firstIssue?.message || "Dados inválidos";
      return res.status(400).json({
        error: errorMsg,
        code: "VALIDATION_ERROR",
        fields: result.error.flatten().fieldErrors,
      });
    }
    req.body = result.data;
    return next();
  };
}
