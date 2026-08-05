/**
 * Financial router index (Fase 15A).
 * Mounts all financial sub-routers under the prefix already applied by
 * routes/index.ts (/creches/:crecheId/financial).
 */

import { Router } from "express";
import catalogueRouter from "./catalogue.routes.js";
import invoiceRouter from "./invoice.routes.js";
import walletRouter from "./wallet.routes.js";
import creditsRouter from "./credits.routes.js";
import expenseRouter from "./expense.routes.js";
import transactionRouter from "./transaction.routes.js";
import auditRouter from "./audit.routes.js";
import posRouter from "./pos.routes.js";
import refundRouter from "./refund.routes.js";

const financialRouter = Router({ mergeParams: true });

financialRouter.use("/catalogue", catalogueRouter);
financialRouter.use("/invoices", invoiceRouter);
financialRouter.use("/packages", walletRouter);
financialRouter.use("/service-credits", creditsRouter);
financialRouter.use("/expenses", expenseRouter);
financialRouter.use("/dashboard", transactionRouter);
financialRouter.use("/audit", auditRouter);
financialRouter.use("/pos-sale", posRouter);
financialRouter.use("/invoices", refundRouter);   // /invoices/:invoiceId/refund-item

export default financialRouter;
