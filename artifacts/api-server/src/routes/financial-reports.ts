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
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate.js";

const router = Router({ mergeParams: true });
router.use(authenticate);

function requireFinancialAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user || (user.role !== "creche_admin" && user.role !== "staff")) {
    res.status(403).json({ error: "Acesso não autorizado para tutores." });
    return;
  }
  next();
}

function parseDates(req: Request) {
  const { startDate, endDate } = req.query;
  
  const isValidDate = (d: any) => typeof d === 'string' && d !== "undefined" && d !== "null";

  const end = isValidDate(endDate) ? new Date(endDate as string) : new Date();
  end.setUTCHours(23, 59, 59, 999);
  
  let start: Date;
  if (isValidDate(startDate)) {
    start = new Date(startDate as string);
  } else {
    start = new Date();
    start.setDate(start.getDate() - 30);
  }
  start.setUTCHours(0, 0, 0, 0);

  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
    startDateObj: start,
    endDateObj: end
  };
}

router.get("/reports/:type", requireFinancialAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const type = req.params.type;
    const dates = parseDates(req);

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
          gte(transactionsTable.transactionDate, dates.start),
          lte(transactionsTable.transactionDate, dates.end)
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
          gte(invoicesTable.createdAt, dates.startDateObj),
          lte(invoicesTable.createdAt, dates.endDateObj)
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
          gte(expensesTable.dueDate, dates.start),
          lte(expensesTable.dueDate, dates.end)
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
          gte(ordersTable.createdAt, dates.startDateObj),
          lte(ordersTable.createdAt, dates.endDateObj),
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


