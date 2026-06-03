import express, { type Express } from "express";
import cors from "cors";
import router from "./routes";

const app: Express = express();

// Replit runs the app behind a reverse proxy; trust the first hop so
// express-rate-limit can read the real client IP from X-Forwarded-For.
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true, limit: "12mb" }));

app.use("/api", router);

export default app;
