import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { 
  catalogueItemsTable, 
  invoicesTable, 
  tutorCreditsTable, 
  transactionsTable,
  expensesTable,
  usersTable,
  invoiceItemsTable,
  ordersTable,
  orderItemsTable,
  bookingsTable
} from "@workspace/db/schema";
import { eq, and, desc, sql, gte, lte, count, lt, or, isNull, inArray } from "drizzle-orm";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate.js";
import { z } from "zod";

const router = Router({ mergeParams: true });
// router.use(authenticate);

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
  const end = endDate ? new Date(endDate as string) : new Date();
  
  let start: Date;
  if (startDate) {
    start = new Date(startDate as string);
  } else {
    start = new Date();
    start.setDate(start.getDate() - 30);
  }

  // Calculate previous period
  const diffTime = Math.abs(end.getTime() - start.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
  
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - diffDays);

  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
    prevStart: prevStart.toISOString().split("T")[0],
    prevEnd: prevEnd.toISOString().split("T")[0],
    diffDays
  };
}

// ----------------------------------------------------------------------
// GET /dashboard/kpis
// ----------------------------------------------------------------------
router.get("/dashboard/kpis", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const dates = parseDates(req);

    // Transactions logic for Gross/Net/Expenses
    const transactions = await db.select({
      type: transactionsTable.type,
      amount: transactionsTable.amount,
      date: transactionsTable.transactionDate
    }).from(transactionsTable)
      .where(and(
        eq(transactionsTable.crecheId, crecheId),
        gte(transactionsTable.transactionDate, dates.start),
        lte(transactionsTable.transactionDate, dates.end)
      ));

    const prevTransactions = await db.select({
      type: transactionsTable.type,
      amount: transactionsTable.amount
    }).from(transactionsTable)
      .where(and(
        eq(transactionsTable.crecheId, crecheId),
        gte(transactionsTable.transactionDate, dates.prevStart),
        lte(transactionsTable.transactionDate, dates.prevEnd)
      ));

    let grossRevenue = 0;
    let netRevenue = 0;
    let expenses = 0;
    
    const sparklineDays = dates.diffDays + 1;
    const grossSparkline = new Array(sparklineDays).fill(0);
    const startDateObj = new Date(dates.start);

    for (const t of transactions) {
      const amt = Number(t.amount);
      if (t.type === 'income') {
        netRevenue += amt;
        if (amt > 0) {
          grossRevenue += amt;
          const tDate = new Date(t.date);
          const dayIndex = Math.floor((tDate.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24));
          if (dayIndex >= 0 && dayIndex < sparklineDays) {
            grossSparkline[dayIndex] += amt;
          }
        }
      } else if (t.type === 'expense') {
        expenses += amt;
      }
    }

    let prevGross = 0;
    let prevNet = 0;
    let prevExpenses = 0;
    for (const t of prevTransactions) {
      const amt = Number(t.amount);
      if (t.type === 'income') {
        prevNet += amt;
        if (amt > 0) prevGross += amt;
      } else {
        prevExpenses += amt;
      }
    }

    const netProfit = netRevenue - expenses;
    const prevNetProfit = prevNet - prevExpenses;
    
    const profitMargin = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;
    const prevProfitMargin = prevGross > 0 ? (prevNetProfit / prevGross) * 100 : 0;

    // Helper for KPI format
    const formatKPI = (value: number, prev: number, sparkline: number[] = []) => {
      let growth = 0;
      if (prev > 0) growth = ((value - prev) / prev) * 100;
      else if (value > 0) growth = 100;
      else if (value < 0) growth = -100;

      return {
        value,
        previousValue: prev,
        growth,
        sparkline
      };
    };

    const invoices = await db.select({
      status: invoicesTable.status,
      amount: invoicesTable.amount,
      tutorId: invoicesTable.tutorId,
    }).from(invoicesTable)
      .where(and(
        eq(invoicesTable.crecheId, crecheId),
        gte(invoicesTable.createdAt, new Date(dates.start)),
        lte(invoicesTable.createdAt, new Date(dates.end))
      ));

    let forecastRevenue = 0;
    let receivedRevenue = 0;
    let openAmount = 0;
    let defaultAmount = 0;
    const uniqueTutors = new Set<number>();
    let paidInvoicesCount = 0;

    for (const inv of invoices) {
      const amt = Number(inv.amount);
      if (inv.status === 'pending') {
        openAmount += amt;
        forecastRevenue += amt;
      } else if (inv.status === 'overdue') {
        defaultAmount += amt;
        forecastRevenue += amt;
      } else if (inv.status === 'paid') {
        receivedRevenue += amt;
        paidInvoicesCount++;
        if (inv.tutorId) uniqueTutors.add(inv.tutorId);
      }
    }

    const averageTicket = paidInvoicesCount > 0 ? receivedRevenue / paidInvoicesCount : 0;
    const averageRevenuePerTutor = uniqueTutors.size > 0 ? receivedRevenue / uniqueTutors.size : 0;

    // Products and Services Sold
    const items = await db.select({
      quantity: orderItemsTable.quantity
    }).from(orderItemsTable);

    let productsSold = 0;
    let servicesRendered = 0;

    const orders = await db.select({ id: ordersTable.id }).from(ordersTable)
      .where(and(
        eq(ordersTable.crecheId, crecheId),
        gte(ordersTable.createdAt, new Date(dates.start)),
        lte(ordersTable.createdAt, new Date(dates.end))
      ));
    
    const storeOrdersCount = orders.length;

    let posSalesCount = 0;
    for (const t of transactions) {
      if (t.type === 'income' && (t as any).description === 'Venda Balcão') {
        posSalesCount++;
      }
    }

    const kpis = {
      grossRevenue: formatKPI(grossRevenue, prevGross, grossSparkline),
      netRevenue: formatKPI(netRevenue, prevNet),
      expenses: formatKPI(expenses, prevExpenses),
      netProfit: formatKPI(netProfit, prevNetProfit),
      profitMargin: formatKPI(profitMargin, prevProfitMargin),
      
      forecastRevenue: formatKPI(forecastRevenue, 0),
      receivedRevenue: formatKPI(receivedRevenue, 0),
      openAmount: formatKPI(openAmount, 0),
      defaultAmount: formatKPI(defaultAmount, 0),
      averageTicket: formatKPI(averageTicket, 0),
      averageRevenuePerTutor: formatKPI(averageRevenuePerTutor, 0),
      averageRevenuePerPet: formatKPI(0, 0),
      productsSold: formatKPI(productsSold, 0),
      servicesRendered: formatKPI(servicesRendered, 0),
      storeOrders: formatKPI(storeOrdersCount, 0),
      posSales: formatKPI(posSalesCount, 0),
    };

    res.json(kpis);
  } catch (err) {
    console.error("Error in /dashboard/kpis:", err);
    next(err);
  }
});

// ----------------------------------------------------------------------
// GET /dashboard/charts
// ----------------------------------------------------------------------
router.get("/dashboard/charts", requireFinancialAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ charts: [] });
  } catch (err) {
    console.error("Error in /dashboard/kpis:", err);
    next(err);
  }
});

// ----------------------------------------------------------------------
// GET /dashboard/sales
// ----------------------------------------------------------------------
router.get("/dashboard/sales", requireFinancialAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ topProducts: [], topServices: [] });
  } catch (err) {
    console.error("Error in /dashboard/kpis:", err);
    next(err);
  }
});



export default router;
