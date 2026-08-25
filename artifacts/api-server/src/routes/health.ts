import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");


    const data = HealthCheckResponse.parse({ status: "ok" });
    res.status(200).json(data);
  } catch (err) {
    console.error("[healthz] Database health check failed:", err instanceof Error ? err.message : String(err));
    res.status(503).json({ status: "unavailable" });
  }
});
export default router;
