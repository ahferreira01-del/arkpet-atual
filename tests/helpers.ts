import { db } from "@workspace/db";
import { 
  crechesTable, usersTable, petsTable, bookingsTable, 
  catalogueItemsTable, tutorCreditsTable, invoicesTable, 
  invoiceItemsTable, transactionsTable, expensesTable, bookingCreditsTable, bookingServicesTable, financialAuditLogsTable
} from "@workspace/db/schema";
import { generateToken } from "../artifacts/api-server/src/lib/auth.js";
import { eq } from "drizzle-orm";

export async function createTestCreche(params: { name: string }) {
  const [creche] = await db.insert(crechesTable).values({
    name: params.name,
    address: 'Endereço Teste, 123',
    phone: '11999999999',
    email: `creche-${Date.now()}@test.com`,
  }).returning();

  const { subscriptionsTable, plansTable } = await import("@workspace/db/schema");
  
  let [plan] = await db.select().from(plansTable).limit(1);
  if (!plan) {
    [plan] = await db.insert(plansTable).values({
      name: `Test Plan ${Date.now()}`,
      petLimit: 100,
      priceBrl: 10000,
      stripePriceId: "price_test",
      description: "Plan for testing"
    }).returning();
  }

  await db.insert(subscriptionsTable).values({
    crecheId: creche.id,
    stripeCustomerId: `cus_test_${Date.now()}`,
    status: "active",
    planId: plan.id,
  });

  return creche;
}

export async function createTestUser(params: { role: string; crecheId: number; name?: string; cpf?: string; isActive?: boolean }) {
  const [user] = await db.insert(usersTable).values({
    crecheId: params.crecheId,
    name: params.name || "Test User",
    email: `test-${Date.now()}-${Math.random()}@test.com`,
    passwordHash: "dummyhash",
    role: params.role,
    cpf: params.cpf || "111.111.111-11",
    isActive: params.isActive !== undefined ? params.isActive : true
  }).returning();
  return user;
}

export function generateTestToken(user: any) {
  return generateToken(user.id, user.role);
}

export async function createTestPet(params: { tutorId: number; crecheId: number; size: string }) {
  const [pet] = await db.insert(petsTable).values({
    tutorId: params.tutorId,
    crecheId: params.crecheId,
    name: "Rex Test",
    species: "dog",
    size: params.size,
    breed: "Mutt"
  }).returning();
  return pet;
}

export async function createActiveBooking(params: { petId: number; crecheId: number; tutorId?: number; primaryCatalogueItemId?: number }) {
  let tutorId = params.tutorId;
  if (!tutorId) {
    const [pet] = await db.select({ tutorId: petsTable.tutorId }).from(petsTable).where(eq(petsTable.id, params.petId));
    tutorId = pet.tutorId;
  }

  const [booking] = await db.insert(bookingsTable).values({
    petId: params.petId,
    crecheId: params.crecheId,
    tutorId: tutorId,
    checkInTime: new Date(),
    startDate: new Date().toISOString().split("T")[0],
    endDate: new Date().toISOString().split("T")[0],
    status: "active",
    type: "day_use", primaryCatalogueItemId: params.primaryCatalogueItemId || null,
  }).returning();
  return booking;
}

export async function createCatalogueItem(params: {
  crecheId: number;
  name?: string;
  isActive?: boolean;
  basePrice?: number;
  priceSmall?: number;
  priceMedium?: number;
  priceLarge?: number;
  trackStock?: boolean;
  stockQuantity?: number;
  type?: "service" | "product" | "package";
  creditsAmount?: number;
  maxPetsPerDay?: number;
  expirationDays?: number;
}) {
  const [item] = await db.insert(catalogueItemsTable).values({
    crecheId: params.crecheId,
    name: params.name || "Test Item",
    type: params.type || "service",
    isActive: params.isActive ?? true,
    basePrice: String(params.basePrice || 0),
    priceSmall: params.priceSmall ? String(params.priceSmall) : null,
    priceMedium: params.priceMedium ? String(params.priceMedium) : null,
    priceLarge: params.priceLarge ? String(params.priceLarge) : null,
    trackStock: params.trackStock || false,
    stockQuantity: params.stockQuantity || 0,
    creditsAmount: params.creditsAmount,
    maxPetsPerDay: params.maxPetsPerDay || 1,
    expirationDays: params.expirationDays,
  }).returning();
  return item;
}

export async function createTutorCredits(params: { tutorId: number; crecheId: number; totalCredits: number; usedCredits: number; expirationDate: string | null }) {
  const [credits] = await db.insert(tutorCreditsTable).values({
    tutorId: params.tutorId,
    crecheId: params.crecheId,
    totalCredits: params.totalCredits,
    usedCredits: params.usedCredits,
    expirationDate: params.expirationDate ? new Date(params.expirationDate) : null
  }).returning();
  return credits;
}

export async function createTestInvoice(params: { crecheId: number; tutorId: number; status: string; amount?: number; receiptPhotoPath?: string; stripePaymentIntentId?: string }) {
  const [invoice] = await db.insert(invoicesTable).values({
    crecheId: params.crecheId,
    tutorId: params.tutorId,
    status: params.status,
    amount: String(params.amount || 100),
    issueDate: new Date(),
    dueDate: new Date(),
    receiptPhotoPath: params.receiptPhotoPath,
    stripePaymentIntentId: params.stripePaymentIntentId
  }).returning();
  return invoice;
}

export async function createTestExpense(params: { crecheId: number; amount: number; isPaid: boolean; dueDate?: string | Date }) {
  const dueDateStr = params.dueDate
    ? (typeof params.dueDate === "string" ? params.dueDate : params.dueDate.toISOString().split("T")[0])
    : new Date().toISOString().split("T")[0];
  const [expense] = await db.insert(expensesTable).values({
    crecheId: params.crecheId,
    description: "Test Expense",
    category: "outros",
    amount: String(params.amount),
    dueDate: dueDateStr,
    isPaid: params.isPaid
  }).returning();
  return expense;
}

export async function createTestTransaction(params: { crecheId: number; type: string; amount: number; transactionDate: string }) {
  const [tx] = await db.insert(transactionsTable).values({
    crecheId: params.crecheId,
    type: params.type,
    amount: String(params.amount),
    transactionDate: new Date(params.transactionDate),
    paymentMethod: "cash",
    description: "Test Tx"
  }).returning();
  return tx;
}

export async function cleanupTestData(crecheId: number) {
  await db.delete(financialAuditLogsTable).where(eq(financialAuditLogsTable.crecheId, crecheId));
  await db.delete(transactionsTable).where(eq(transactionsTable.crecheId, crecheId));
  await db.delete(expensesTable).where(eq(expensesTable.crecheId, crecheId));
  await db.delete(invoiceItemsTable); // we don't have crecheId directly on invoiceItems, could be cleaner but fine for tests
  await db.delete(invoicesTable).where(eq(invoicesTable.crecheId, crecheId));
  await db.delete(bookingCreditsTable);
  await db.delete(bookingServicesTable);
  await db.delete(tutorCreditsTable).where(eq(tutorCreditsTable.crecheId, crecheId));
  await db.delete(catalogueItemsTable).where(eq(catalogueItemsTable.crecheId, crecheId));
  await db.delete(bookingsTable).where(eq(bookingsTable.crecheId, crecheId));
  await db.delete(petsTable).where(eq(petsTable.crecheId, crecheId));
  await db.delete(usersTable).where(eq(usersTable.crecheId, crecheId));
  await db.delete(crechesTable).where(eq(crechesTable.id, crecheId));
}
