import { Router } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import crechesRouter from "./creches.js";
import petsRouter from "./pets.js";
import bookingsRouter from "./bookings.js";
import tasksRouter from "./tasks.js";
import chatRouter from "./chat.js";
import usersRouter from "./users.js";
import pushRouter from "./push.js";
import walksRouter from "./walks.js";

const router = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/creches", crechesRouter);
router.use("/creches/:crecheId/pets", petsRouter);
router.use("/creches/:crecheId/bookings", bookingsRouter);
router.use("/creches/:crecheId/tasks", tasksRouter);
router.use("/creches/:crecheId/chat", chatRouter);
router.use("/creches/:crecheId/walks", walksRouter);
router.use("/users", usersRouter);
router.use("/push", pushRouter);

export default router;
