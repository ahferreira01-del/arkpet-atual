import { Request, Response, NextFunction } from "express";
import { z } from "zod";

export function validate<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: "Dados inválidos",
        code: "VALIDATION_ERROR",
        fields: result.error.flatten().fieldErrors,
      });
    }
    req.body = result.data;
    return next();
  };
}
