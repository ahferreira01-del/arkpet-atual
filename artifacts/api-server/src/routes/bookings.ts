import { Router } from "express";
import { db } from "@workspace/db";
import { bookingsTable, petsTable, usersTable, crechesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";

const router = Router({ mergeParams: true });
router.use(authenticate);

async function getBookingWithNames(booking: typeof bookingsTable.$inferSelect) {
  const [pet] = await db.select({ name: petsTable.name }).from(petsTable).where(eq(petsTable.id, booking.petId)).limit(1);
  const [tutor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, booking.tutorId)).limit(1);
  return { ...booking, petName: pet?.name ?? null, tutorName: tutor?.name ?? null };
}

router.get("/", async (req: AuthRequest, res) => {
  const crecheId = parseInt(req.params.crecheId);
  const { status, type } = req.query;
  let conditions: any[] = [eq(bookingsTable.crecheId, crecheId)];
  if (req.user?.role === "tutor") conditions.push(eq(bookingsTable.tutorId, req.user.id));
  if (status) conditions.push(eq(bookingsTable.status, status as any));
  if (type) conditions.push(eq(bookingsTable.type, type as any));
  const bookings = await db.select().from(bookingsTable).where(and(...conditions)).orderBy(bookingsTable.startDate);
  const enriched = await Promise.all(bookings.map(getBookingWithNames));
  res.json(enriched);
});

router.post("/", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const crecheId = parseInt(req.params.crecheId);
  const { petId, type, startDate, endDate, notes, isRecurring, recurringDays, price } = req.body;
  const [pet] = await db.select().from(petsTable).where(eq(petsTable.id, petId)).limit(1);
  const tutorId = req.user.role === "tutor" ? req.user.id : (pet?.tutorId ?? req.user.id);
  const [booking] = await db.insert(bookingsTable).values({
    crecheId, petId, tutorId, type, startDate, endDate, notes,
    isRecurring: isRecurring || false, recurringDays, price,
  }).returning();
  res.status(201).json(await getBookingWithNames(booking));
});

router.get("/:bookingId", async (req: AuthRequest, res) => {
  const crecheId = parseInt(req.params.crecheId);
  const bookingId = parseInt(req.params.bookingId);
  const [booking] = await db.select().from(bookingsTable)
    .where(and(eq(bookingsTable.crecheId, crecheId), eq(bookingsTable.id, bookingId))).limit(1);
  if (!booking) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await getBookingWithNames(booking));
});

router.put("/:bookingId", async (req: AuthRequest, res) => {
  const crecheId = parseInt(req.params.crecheId);
  const bookingId = parseInt(req.params.bookingId);
  const { status, notes, price } = req.body;
  const updates: Record<string, unknown> = {};
  if (status !== undefined) updates.status = status;
  if (notes !== undefined) updates.notes = notes;
  if (price !== undefined) updates.price = price;
  const [booking] = await db.update(bookingsTable).set(updates)
    .where(and(eq(bookingsTable.crecheId, crecheId), eq(bookingsTable.id, bookingId))).returning();
  res.json(await getBookingWithNames(booking));
});

router.post("/:bookingId/checkin", async (req: AuthRequest, res) => {
  const crecheId = parseInt(req.params.crecheId);
  const bookingId = parseInt(req.params.bookingId);
  const [booking] = await db.update(bookingsTable).set({
    status: "active", checkInTime: new Date(),
  }).where(and(eq(bookingsTable.crecheId, crecheId), eq(bookingsTable.id, bookingId))).returning();
  // Update pet checked_in status
  await db.update(petsTable).set({ isCheckedIn: true }).where(eq(petsTable.id, booking.petId));
  // Update creche occupancy
  await db.update(crechesTable).set({ currentOccupancy: db.$count(petsTable, and(eq(petsTable.crecheId, crecheId), eq(petsTable.isCheckedIn, true))) as any }).where(eq(crechesTable.id, crecheId));
  res.json(await getBookingWithNames(booking));
});

router.post("/:bookingId/checkout", async (req: AuthRequest, res) => {
  const crecheId = parseInt(req.params.crecheId);
  const bookingId = parseInt(req.params.bookingId);
  const [booking] = await db.update(bookingsTable).set({
    status: "completed", checkOutTime: new Date(),
  }).where(and(eq(bookingsTable.crecheId, crecheId), eq(bookingsTable.id, bookingId))).returning();
  await db.update(petsTable).set({ isCheckedIn: false }).where(eq(petsTable.id, booking.petId));
  res.json(await getBookingWithNames(booking));
});

export default router;
