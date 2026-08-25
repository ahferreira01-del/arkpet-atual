import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { 
  catalogueItemsTable, 
  invoicesTable, 
  transactionsTable,
  expensesTable,
  usersTable,
  invoiceItemsTable,
  ordersTable,
  orderItemsTable
} from "@workspace/db/schema";
import { eq, and, desc, gte, lte, lt, sql } from "drizzle-orm";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate.js";
import { requireFinancialAccess } from "./financial/middleware.js";
import {
  getBusinessDate,
  isValidCalendarDate,
  getNextCalendarDay,
  getPreviousCalendarDay,
  getBusinessDayStartInstant
} from "../lib/date.js";

const router = Router({ mergeParams: true });
router.use(authenticate);

function parseReportDates(req: Request): {
  startStr: string;
  endStr: string;
  startInstant: Date;
  nextDayInstant: Date;
} | { error: string } {
  const { startDate, endDate } = req.query;

  const todayStr = getBusinessDate();
  let startStr: string;
  let endStr: string;

  if (endDate !== undefined && endDate !== null && endDate !== "" && endDate !== "undefined" && endDate !== "null") {
    if (!isValidCalendarDate(endDate)) {
      return { error: "Data final inválida. Use YYYY-MM-DD" };
    }
    endStr = String(endDate);
  } else {
    endStr = todayStr;
  }

  if (startDate !== undefined && startDate !== null && startDate !== "" && startDate !== "undefined" && startDate !== "null") {
    if (!isValidCalendarDate(startDate)) {
      return { error: "Data inicial inválida. Use YYYY-MM-DD" };
    }
    startStr = String(startDate);
  } else {
    startStr = getPreviousCalendarDay(endStr, 30);
  }

  const startInstant = getBusinessDayStartInstant(startStr, "America/Sao_Paulo");
  const nextDayStr = getNextCalendarDay(endStr);
  const nextDayInstant = getBusinessDayStartInstant(nextDayStr, "America/Sao_Paulo");

  return {
    startStr,
    endStr,
    startInstant,
    nextDayInstant,
  };
}

router.get("/reports/:type", requireFinancialAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const type = req.params.type;
    const parsed = parseReportDates(req);

    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    if (type === 'cash-flow') {
      const tx = await db.select({
        id: transactionsTable.id,
        date: transactionsTable.transactionDate,
        description: transactionsTable.description,
        type: transactionsTable.type,
        paymentMethod: transactionsTable.paymentMethod,
        amount: transactionsTable.amount
      }).from(transactionsTable)
        .where(and(
          eq(transactionsTable.crecheId, crecheId),
          gte(transactionsTable.transactionDate, parsed.startStr),
          lte(transactionsTable.transactionDate, parsed.endStr)
        ))
        .orderBy(desc(transactionsTable.transactionDate));
      return res.json({ data: tx });
    }

    if (type === 'accounts-receivable') {
      const inv = await db.select({
        id: invoicesTable.id,
        issueDate: invoicesTable.createdAt,
        dueDate: invoicesTable.dueDate,
        status: invoicesTable.status,
        amount: invoicesTable.amount,
        tutorName: usersTable.name
      }).from(invoicesTable)
        .leftJoin(usersTable, eq(invoicesTable.tutorId, usersTable.id))
        .where(and(
          eq(invoicesTable.crecheId, crecheId),
          gte(invoicesTable.createdAt, parsed.startInstant),
          lt(invoicesTable.createdAt, parsed.nextDayInstant)
        ))
        .orderBy(desc(invoicesTable.createdAt));
      return res.json({ data: inv });
    }

    if (type === 'accounts-payable') {
      const exp = await db.select({
        id: expensesTable.id,
        dueDate: expensesTable.dueDate,
        description: expensesTable.description,
        category: expensesTable.category,
        supplier: expensesTable.supplier,
        amount: expensesTable.amount,
        isPaid: expensesTable.isPaid,
        paidDate: expensesTable.paidDate
      }).from(expensesTable)
        .where(and(
          eq(expensesTable.crecheId, crecheId),
          gte(expensesTable.dueDate, parsed.startStr),
          lte(expensesTable.dueDate, parsed.endStr)
        ))
        .orderBy(desc(expensesTable.dueDate));
      return res.json({ data: exp });
    }

    if (type === 'products-sold') {
      const items = await db.select({
        date: ordersTable.createdAt,
        productName: catalogueItemsTable.name,
        category: catalogueItemsTable.category,
        quantity: orderItemsTable.quantity,
        unitPrice: orderItemsTable.unitPrice,
        tutorName: usersTable.name
      }).from(orderItemsTable)
        .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
        .innerJoin(catalogueItemsTable, eq(orderItemsTable.catalogueItemId, catalogueItemsTable.id))
        .leftJoin(usersTable, eq(ordersTable.tutorId, usersTable.id))
        .where(and(
          eq(ordersTable.crecheId, crecheId),
          gte(ordersTable.createdAt, parsed.startInstant),
          lt(ordersTable.createdAt, parsed.nextDayInstant),
          eq(ordersTable.status, 'delivered')
        ))
        .orderBy(desc(ordersTable.createdAt));
      return res.json({ data: items });
    }

    // Default fallback
    return res.status(404).json({ error: "Report type not found" });
  } catch (err) {
    return next(err);
  }
});

export default router;


