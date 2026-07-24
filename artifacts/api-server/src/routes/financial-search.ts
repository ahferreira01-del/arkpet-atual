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
import { eq, and, desc, sql, gte, lte, count, lt, or, isNull, inArray, ilike } from "drizzle-orm";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate.js";
import { z } from "zod";

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

router.get("/search", requireFinancialAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const query = req.query.q as string;

    if (!query || query.length < 2) {
      return res.json({ results: [] });
    }

    const likeQuery = `%${query}%`;
    const results: any[] = [];

    // Search Tutors
    const tutors = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
    }).from(usersTable)
      .where(and(
        eq(usersTable.crecheId, crecheId),
        eq(usersTable.role, 'tutor'),
        or(
          ilike(usersTable.name, likeQuery),
          ilike(usersTable.email, likeQuery)
        )
      ))
      .limit(5);

    tutors.forEach(t => results.push({ type: 'tutor', id: t.id, title: t.name, subtitle: t.email }));

    // Search Catalogue
    const items = await db.selectDistinct({
      id: catalogueItemsTable.id,
      name: catalogueItemsTable.name,
      type: catalogueItemsTable.type,
      sku: catalogueItemsTable.sku,
      barcode: catalogueItemsTable.barcode,
    }).from(catalogueItemsTable)
      .where(and(
        eq(catalogueItemsTable.crecheId, crecheId),
        or(
          ilike(catalogueItemsTable.name, likeQuery),
          ilike(catalogueItemsTable.sku, likeQuery),
          ilike(catalogueItemsTable.barcode, likeQuery)
        )
      ))
      .limit(5);

    items.forEach(i => results.push({ type: i.type, id: i.id, title: i.name, subtitle: `SKU: ${i.sku || 'N/A'}` }));

    // Search Invoices
    if (!isNaN(Number(query))) {
      const invoiceId = Number(query);
      const invoices = await db.select({
        id: invoicesTable.id,
        status: invoicesTable.status,
      }).from(invoicesTable)
        .where(and(
          eq(invoicesTable.crecheId, crecheId),
          eq(invoicesTable.id, invoiceId)
        ))
        .limit(3);

      invoices.forEach(i => results.push({ type: 'invoice', id: i.id, title: `Fatura #${i.id}`, subtitle: `Status: ${i.status}` }));
    }

    // Search Transactions
    const tx = await db.select({
      id: transactionsTable.id,
      description: transactionsTable.description,
      amount: transactionsTable.amount
    }).from(transactionsTable)
      .where(and(
        eq(transactionsTable.crecheId, crecheId),
        ilike(transactionsTable.description, likeQuery)
      ))
      .limit(5);
      
    tx.forEach(t => results.push({ type: 'transaction', id: t.id, title: t.description, subtitle: `R$ ${t.amount}` }));

    res.json({ results });
  } catch (err) {
    next(err);
  }
});

// Smart Indicators for Catalogue
router.get("/catalogue/:itemId/stats", requireFinancialAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const itemId = Number(req.params.itemId);

    const orderItems = await db.select({
      quantity: orderItemsTable.quantity,
      amount: orderItemsTable.unitPrice,
      invoiceDate: ordersTable.createdAt
    }).from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(and(
        eq(ordersTable.crecheId, crecheId),
        eq(orderItemsTable.catalogueItemId, itemId),
        or(eq(ordersTable.status, 'delivered'), eq(ordersTable.status, 'paid'))
      ))
      .orderBy(desc(ordersTable.createdAt));

    let revenue = 0;
    let quantitySold = 0;
    for (const item of orderItems) {
      revenue += Number(item.amount) * item.quantity;
      quantitySold += item.quantity;
    }
    const lastSale = orderItems.length > 0 ? orderItems[0].invoiceDate : null;
    const averageTicket = quantitySold > 0 ? revenue / quantitySold : 0;

    res.json({
      revenue,
      quantitySold,
      lastSale,
      averageTicket,
      profit: 0, // Need cost price for this
      margin: 0
    });
  } catch (err) {
    next(err);
  }
});

// Smart Indicators for Tutors
router.get("/tutors/:tutorId/stats", requireFinancialAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = Number(req.params.crecheId);
    const tutorId = Number(req.params.tutorId);

    const invoices = await db.select({
      amount: invoicesTable.amount,
      status: invoicesTable.status,
      issueDate: invoicesTable.dueDate
    }).from(invoicesTable)
      .where(and(
        eq(invoicesTable.crecheId, crecheId),
        eq(invoicesTable.tutorId, tutorId)
      ))
      .orderBy(desc(invoicesTable.dueDate));

    let totalSpent = 0;
    let paidCount = 0;
    let pendingAmount = 0;
    let overdueAmount = 0;
    let lastPayment = null;

    for (const inv of invoices) {
      const amt = Number(inv.amount);
      if (inv.status === 'paid') {
        totalSpent += amt;
        paidCount++;
        if (!lastPayment) lastPayment = inv.issueDate;
      } else if (inv.status === 'pending') {
        pendingAmount += amt;
      } else if (inv.status === 'overdue') {
        overdueAmount += amt;
      }
    }

    const averageTicket = paidCount > 0 ? totalSpent / paidCount : 0;

    res.json({
      totalSpent,
      purchaseCount: paidCount,
      averageTicket,
      lastPayment,
      pendingAmount,
      overdueAmount,
      activePackages: 0
    });
  } catch (err) {
    next(err);
  }
});

export default router;
