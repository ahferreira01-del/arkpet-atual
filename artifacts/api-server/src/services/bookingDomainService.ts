import { db } from "@workspace/db";
import {
  bookingsTable,
  petsTable,
  usersTable,
  crechesTable,
  catalogueItemsTable,
  bookingConsumablesTable,
  invoiceItemsTable,
  invoicesTable,
  vaccinesTable,
} from "@workspace/db/schema";
import { eq, and, inArray, count, ilike, or, lte, sql } from "drizzle-orm";
import { getBusinessDate } from "../lib/date.js";
import { sendPushToUser, sendPushToRole } from "../lib/push.js";
import {
  restoreBookingPackageCredits,
  restoreBookingServiceCredits,
  restoreAdditionalServices,
} from "./credits.js";
import { CrecheCampaignReservationService } from "./crecheCampaignReservation.service.js";
import { logFinancialAudit } from "./audit.js";
import { BillingService } from "./billing.js";
import { acquireTenantOperationalLock } from "./tenantLifecycleLock.js";

function clientError(message: string, status = 400, code?: string): Error & { status: number; statusCode: number; code?: string } {
  const err = new Error(message) as Error & { status: number; statusCode: number; code?: string };
  err.status = status;
  err.statusCode = status;
  if (code) err.code = code;
  return err;
}

export function isServiceBookingBackend(
  bookingType: string,
  catalogueItemType: string | null | undefined
): boolean {
  const itemType = catalogueItemType ?? null;
  const LEGACY_SERVICE_TYPES = new Set(["banho", "visita_taxi", "creche_taxi"]);
  if (itemType === null) {
    return LEGACY_SERVICE_TYPES.has(bookingType);
  }
  return itemType === "service";
}

export async function getBookingWithNames(booking: typeof bookingsTable.$inferSelect) {
  const [pet] = await db
    .select({ name: petsTable.name })
    .from(petsTable)
    .where(eq(petsTable.id, booking.petId))
    .limit(1);
  const [tutor] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, booking.tutorId))
    .limit(1);

  return {
    ...booking,
    petName: pet?.name ?? null,
    tutorName: tutor?.name ?? null,
  };
}

export interface ValidateCancellationParams {
  bookingId: number;
  crecheId: number;
  actorUserId: number;
  actorRole: string;
  tx?: any;
}

export interface ValidatedCancellation {
  booking: typeof bookingsTable.$inferSelect;
  petName: string;
  tutorName: string | null;
}

export interface PreviewCancellationParams {
  bookingId: number;
  crecheId: number;
  actorUserId: number;
  actorRole: string;
  reason?: string;
  tx?: any;
}

export interface CancelBookingParams {
  bookingId: number;
  crecheId: number;
  actorUserId: number;
  actorRole: string;
  reason?: string;
  tx?: any;
}

export interface ValidateCheckInParams {
  bookingId?: number;
  petId?: number;
  crecheId: number;
  actorUserId: number;
  actorRole: string;
  notes?: string;
  tx?: any;
}

export interface ValidatedCheckIn {
  pet: { id: number; name: string; isCheckedIn?: boolean | null };
  booking: typeof bookingsTable.$inferSelect;
  catalogueItemType: string | null;
  skipPhysicalCheckin: boolean;
}

export interface PreviewCheckInParams {
  bookingId?: number;
  petId: number;
  crecheId: number;
  actorUserId: number;
  actorRole: string;
  notes?: string;
  tx?: any;
}

export interface CheckInBookingParams {
  bookingId: number;
  crecheId: number;
  actorUserId: number;
  actorRole: string;
  petId?: number;
  notes?: string;
  tx?: any;
}

export interface ValidateCheckOutParams {
  bookingId?: number;
  petId?: number;
  crecheId: number;
  actorUserId: number;
  actorRole: string;
  notes?: string;
  tx?: any;
}

export interface ValidatedCheckOut {
  pet: { id: number; name: string; isCheckedIn?: boolean | null };
  booking: typeof bookingsTable.$inferSelect;
  catalogueItemType: string | null;
}

export interface PreviewCheckOutParams {
  bookingId?: number;
  petId?: number;
  crecheId: number;
  actorUserId: number;
  actorRole: string;
  notes?: string;
  tx?: any;
}

export interface CheckOutBookingParams {
  bookingId: number;
  crecheId: number;
  actorUserId: number;
  actorRole: string;
  notes?: string;
  tx?: any;
}

export class BookingDomainService {
  /**
   * Pure Canonical Booking Cancellation Validation.
   * Single source of truth for ownership, cancellable-status, and paid invoice guard.
   * Reused identically by previewCancellation and cancelBooking.
   */
  public static async validateCancellation(params: ValidateCancellationParams): Promise<ValidatedCancellation> {
    const { bookingId, crecheId, actorUserId, actorRole, tx } = params;
    const dbHandle = tx || db;

    // 1. Fetch booking
    const query = dbHandle
      .select()
      .from(bookingsTable)
      .where(and(eq(bookingsTable.id, bookingId), eq(bookingsTable.crecheId, crecheId)))
      .limit(1);

    const [existing] = tx && typeof query.for === "function" ? await query.for("update") : await query;

    if (!existing) {
      throw clientError("Reserva não encontrada", 404, "target_not_found");
    }

    // Tutor ownership check
    if (actorRole === "tutor" && existing.tutorId !== actorUserId) {
      throw clientError("Você só pode cancelar suas próprias reservas.", 403, "ownership_mismatch");
    }

    if (existing.status === "cancelled") {
      throw clientError("Esta reserva já está cancelada.", 400, "invalid_domain_state");
    }

    if (existing.status === "checked_in" || existing.status === "active") {
      throw clientError("Não é possível cancelar uma reserva com check-in já realizado (status: checked_in/active).", 400, "invalid_domain_state");
    }

    if (existing.status === "completed") {
      throw clientError("Não é possível cancelar uma reserva já finalizada.", 400, "invalid_domain_state");
    }

    // 2. Paid items guard: block cancellation if ANY invoice item of this booking
    // belongs to a paid or refunded invoice.
    const paidItems = await dbHandle
      .select({ itemId: invoiceItemsTable.id })
      .from(invoiceItemsTable)
      .innerJoin(invoicesTable, eq(invoiceItemsTable.invoiceId, invoicesTable.id))
      .where(
        and(
          eq(invoiceItemsTable.bookingId, bookingId),
          inArray(invoicesTable.status, ["paid", "refunded"])
        )
      )
      .limit(1);

    if (paidItems.length > 0) {
      throw clientError(
        "Não é possível cancelar — a reserva possui cobranças com pagamento já processado. Solicite o estorno manualmente antes de cancelar.",
        422,
        "paid_invoice_exists"
      );
    }

    const [pet] = await dbHandle
      .select({ name: petsTable.name })
      .from(petsTable)
      .where(eq(petsTable.id, existing.petId))
      .limit(1);

    const [tutor] = await dbHandle
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, existing.tutorId))
      .limit(1);

    return {
      booking: existing,
      petName: pet?.name ?? "Pet",
      tutorName: tutor?.name ?? null,
    };
  }

  /**
   * Pure Canonical Cancellation Preview.
   * Performs zero mutation and delegates 100% of business eligibility to validateCancellation.
   */
  public static async previewCancellation(params: PreviewCancellationParams) {
    const { booking, petName } = await this.validateCancellation(params);
    const dateStr = new Date(booking.startDate).toLocaleDateString("pt-BR");

    return {
      targetId: booking.id,
      previewData: {
        bookingId: booking.id,
        petId: booking.petId,
        petName,
        date: dateStr,
        serviceType: booking.type,
        status: booking.status,
      },
      summary: `Cancelar reserva #${booking.id} (${booking.type}) de ${petName} para ${dateStr}`,
    };
  }

  /**
   * Canonical Booking Cancellation Logic.
   * Shared between REST endpoints and Assistant Safe Actions.
   * Revalidates domain state under transaction row lock via validateCancellation.
   * Guarantees 100% parity across credit restoration, campaign release, invoice voids, and notifications.
   */
  public static async cancelBooking(params: CancelBookingParams) {
    const { bookingId, crecheId, actorUserId, actorRole, reason } = params;

    const runInTx = async (tx: any) => {
      // 1. Fetch & validate booking with locking using the exact same canonical validator
      const { booking: existing } = await BookingDomainService.validateCancellation({
        bookingId,
        crecheId,
        actorUserId,
        actorRole,
        tx,
      });

      // 2. Restore package credits and service credits
      await restoreBookingPackageCredits(bookingId, tx, crecheId);
      await restoreBookingServiceCredits(bookingId, tx, crecheId);

      // 3. Restore add-ons and cancel booking_services
      if (existing.tutorId) {
        await restoreAdditionalServices(bookingId, existing.tutorId, crecheId, tx);
      }

      // 4. Safely handle pending invoices linked to this booking
      const bookingItems = await tx
        .select({
          id: invoiceItemsTable.id,
          invoiceId: invoiceItemsTable.invoiceId,
          amount: invoiceItemsTable.amount,
          quantity: invoiceItemsTable.quantity,
        })
        .from(invoiceItemsTable)
        .where(eq(invoiceItemsTable.bookingId, bookingId));

      const byInvoice = new Map<number, typeof bookingItems>();
      for (const item of bookingItems) {
        if (!byInvoice.has(item.invoiceId)) byInvoice.set(item.invoiceId, []);
        byInvoice.get(item.invoiceId)!.push(item);
      }

      for (const [affectedInvoiceId, items] of byInvoice) {
        const [invoice] = await tx
          .select({
            id: invoicesTable.id,
            amount: invoicesTable.amount,
            status: invoicesTable.status,
            dueDate: invoicesTable.dueDate,
          })
          .from(invoicesTable)
          .where(eq(invoicesTable.id, affectedInvoiceId))
          .limit(1);

        if (!invoice || invoice.status !== "pending" || invoice.dueDate < getBusinessDate()) {
          continue;
        }

        let amountToRemove = 0;
        for (const item of items) {
          amountToRemove += parseFloat(item.amount) * (item.quantity ?? 1);
          await tx.delete(invoiceItemsTable).where(eq(invoiceItemsTable.id, item.id));
        }

        const [{ remaining }] = await tx
          .select({ remaining: count(invoiceItemsTable.id) })
          .from(invoiceItemsTable)
          .where(eq(invoiceItemsTable.invoiceId, affectedInvoiceId));

        if (Number(remaining) === 0) {
          await tx.update(invoicesTable)
            .set({ status: "voided", amount: "0.00", updatedAt: new Date() })
            .where(eq(invoicesTable.id, affectedInvoiceId));
        } else {
          const newTotal = Math.max(0, parseFloat(invoice.amount) - amountToRemove);
          await tx.update(invoicesTable)
            .set({ amount: newTotal.toFixed(2), updatedAt: new Date() })
            .where(eq(invoicesTable.id, affectedInvoiceId));
        }
      }

      // 5. Financial Audit
      await logFinancialAudit({
        crecheId,
        userId: actorUserId,
        action: "credits_deduct",
        referenceId: bookingId,
        referenceType: "bookings",
        details: "Estorno de créditos devido a cancelamento da reserva.",
      }, tx);

      // 6. Campaign reservation release
      await CrecheCampaignReservationService.releaseBookingCampaigns(
        tx,
        crecheId,
        bookingId,
        "booking_cancelled",
        {
          userId: actorUserId,
          role: actorRole,
        }
      );

      // 7. Update booking status to cancelled
      const [updatedBooking] = await tx
        .update(bookingsTable)
        .set({
          status: "cancelled",
          updatedAt: new Date(),
        })
        .where(and(eq(bookingsTable.id, bookingId), eq(bookingsTable.crecheId, crecheId)))
        .returning();

      const bookingResult = updatedBooking ? { ...existing, ...updatedBooking } : { ...existing, status: "cancelled" };
      return bookingResult;
    };

    const cancelledBooking = params.tx ? await runInTx(params.tx) : await db.transaction(runInTx);
    const enriched = await getBookingWithNames(cancelledBooking);

    // Push notifications
    if (cancelledBooking.tutorId) {
      sendPushToUser(cancelledBooking.tutorId, {
        title: "❌ Cancelamento aprovado",
        body: `A creche aprovou o cancelamento da reserva de ${enriched.petName ?? "seu pet"}.`,
        tag: `booking-status-${cancelledBooking.id}`,
        data: { type: "booking", bookingId: cancelledBooking.id, petId: cancelledBooking.petId },
      }).catch(() => {});
    }

    return { booking: cancelledBooking, enriched };
  }

  /**
   * Pure Canonical Check-in Validation.
   * Single source of truth for pet existence, confirmed booking, vaccine check, and active booking conflict.
   * Reused identically by previewCheckIn and checkInBooking.
   */
  public static async validateCheckIn(params: ValidateCheckInParams): Promise<ValidatedCheckIn> {
    const { bookingId, petId: expectedPetId, crecheId, tx } = params;
    const dbHandle = tx || db;

    let targetPetId = expectedPetId;

    // 1. If bookingId is provided without petId, fetch booking first to resolve petId
    if (bookingId && !targetPetId) {
      const [b] = await dbHandle
        .select({ id: bookingsTable.id, petId: bookingsTable.petId, status: bookingsTable.status })
        .from(bookingsTable)
        .where(and(eq(bookingsTable.id, bookingId), eq(bookingsTable.crecheId, crecheId)))
        .limit(1);

      if (!b) {
        throw clientError("Reserva não encontrada", 404, "target_not_found");
      }
      targetPetId = b.petId;
    }

    if (!targetPetId) {
      throw clientError("Identificador do pet não fornecido.", 400, "invalid_payload");
    }

    // 2. Validate pet exists in creche
    const [pet] = await dbHandle
      .select({ id: petsTable.id, name: petsTable.name, isCheckedIn: petsTable.isCheckedIn })
      .from(petsTable)
      .where(and(eq(petsTable.id, targetPetId), eq(petsTable.crecheId, crecheId)))
      .limit(1);

    if (!pet) {
      throw clientError("Pet não encontrado nesta creche.", 404, "target_not_found");
    }

    // 3. Find confirmed booking
    const conditions: any[] = [
      eq(bookingsTable.crecheId, crecheId),
      eq(bookingsTable.petId, targetPetId),
    ];
    if (bookingId) {
      conditions.push(eq(bookingsTable.id, bookingId));
    } else {
      conditions.push(eq(bookingsTable.status, "confirmed"));
    }

    const query = dbHandle
      .select({
        booking: bookingsTable,
        catalogueItemType: catalogueItemsTable.type,
      })
      .from(bookingsTable)
      .leftJoin(catalogueItemsTable, eq(bookingsTable.primaryCatalogueItemId, catalogueItemsTable.id))
      .where(and(...conditions))
      .limit(1);

    const [row] = tx && typeof query.for === "function" ? await query.for("update") : await query;

    if (!row) {
      throw clientError("Não há reserva confirmada para este pet realizar check-in.", 400, "invalid_domain_state");
    }

    const booking = row.booking || row;
    const catalogueItemType = row.catalogueItemType ?? null;

    if (expectedPetId && booking.petId !== expectedPetId) {
      throw clientError("A reserva não pertence a este pet.", 400, "invalid_domain_state");
    }

    if (booking.status === "active") {
      throw clientError("O check-in já foi realizado para esta reserva.", 409, "active_checkin_exists");
    }

    if (booking.status !== "confirmed") {
      throw clientError("Não há reserva confirmada para este pet realizar check-in.", 400, "invalid_domain_state");
    }

    // 4. Check rabies vaccine
    const [expiredVaccine] = await dbHandle
      .select({ id: vaccinesTable.id })
      .from(vaccinesTable)
      .where(
        and(
          eq(vaccinesTable.crecheId, crecheId),
          eq(vaccinesTable.petId, booking.petId),
          or(
            ilike(vaccinesTable.name, "%antirr%"),
            ilike(vaccinesTable.name, "%raiva%")
          ),
          lte(vaccinesTable.nextDueDate, getBusinessDate())
        )
      )
      .limit(1);

    if (expiredVaccine) {
      const err = clientError("Vacina antirrábica vencida. Check-in bloqueado por razões de saúde e segurança.", 403, "VACCINE_EXPIRED");
      throw err;
    }

    // 5. Check existing active bookings for same pet (semantic conflict check)
    const activeBookings = await dbHandle
      .select({
        id: bookingsTable.id,
        type: bookingsTable.type,
        catalogueItemType: catalogueItemsTable.type,
      })
      .from(bookingsTable)
      .leftJoin(catalogueItemsTable, eq(bookingsTable.primaryCatalogueItemId, catalogueItemsTable.id))
      .where(
        and(
          eq(bookingsTable.crecheId, crecheId),
          eq(bookingsTable.petId, booking.petId),
          eq(bookingsTable.status, "active")
        )
      );

    let skipPhysicalCheckin = false;
    if (activeBookings.length > 0) {
      const targetIsService = isServiceBookingBackend(booking.type, catalogueItemType);
      const hasSameSemanticTypeActive = activeBookings.some((b: any) => {
        const bIsService = isServiceBookingBackend(b.type, b.catalogueItemType);
        return bIsService === targetIsService;
      });

      if (hasSameSemanticTypeActive) {
        throw clientError("Este pet já possui um check-in ativo desta mesma categoria. Realize o check-out antes de fazer um novo.", 409, "active_checkin_exists");
      }

      skipPhysicalCheckin = true;
    }

    return {
      pet,
      booking,
      catalogueItemType,
      skipPhysicalCheckin,
    };
  }

  /**
   * Pure Canonical Check-in Preview.
   * Performs zero mutation and delegates 100% of business eligibility to validateCheckIn.
   */
  public static async previewCheckIn(params: PreviewCheckInParams) {
    const { pet, booking } = await this.validateCheckIn(params);

    return {
      targetId: pet.id,
      previewData: {
        petId: pet.id,
        petName: pet.name,
        bookingId: booking.id,
        serviceType: booking.type,
        notes: params.notes || null,
      },
      summary: `Realizar check-in do pet ${pet.name} (Reserva #${booking.id} - ${booking.type})`,
    };
  }

  /**
   * Canonical Check-in Domain Logic.
   * Shared between REST endpoints and Assistant Safe Actions.
   * Revalidates domain state under transaction lock via validateCheckIn.
   */
  public static async checkInBooking(params: CheckInBookingParams) {
    const { bookingId, crecheId, actorUserId, actorRole, petId: expectedPetId, notes } = params;

    const runInTx = async (tx: any) => {
      // 1. Revalidate domain state under transaction row lock using canonical validator
      const { booking, skipPhysicalCheckin } = await BookingDomainService.validateCheckIn({
        bookingId,
        petId: expectedPetId,
        crecheId,
        actorUserId,
        actorRole,
        notes,
        tx,
      });

      // 2. Update booking to active
      const [updatedBooking] = await tx
        .update(bookingsTable)
        .set({
          status: "active",
          checkInTime: new Date(),
          onTheWayType: null,
          onTheWayEtaMinutes: null,
          onTheWayAt: null,
          ...(notes ? { notes } : {}),
        })
        .where(eq(bookingsTable.id, booking.id))
        .returning();

      if (!skipPhysicalCheckin) {
        await tx
          .update(petsTable)
          .set({ isCheckedIn: true })
          .where(eq(petsTable.id, updatedBooking.petId));

        await tx
          .update(crechesTable)
          .set({
            currentOccupancy: (typeof tx.$count === "function"
              ? tx.$count(
                  petsTable,
                  and(eq(petsTable.crecheId, crecheId), eq(petsTable.isCheckedIn, true))
                )
              : sql`(SELECT count(*) FROM ${petsTable} WHERE ${petsTable.crecheId} = ${crecheId} AND ${petsTable.isCheckedIn} = true)`) as any,
          })
          .where(eq(crechesTable.id, crecheId));
      }

      return updatedBooking;
    };

    const updatedBooking = params.tx ? await runInTx(params.tx) : await db.transaction(runInTx);
    const enriched = await getBookingWithNames(updatedBooking);

    // Push notification to tutor
    if (updatedBooking.tutorId) {
      sendPushToUser(updatedBooking.tutorId, {
        title: `🏠 ${enriched.petName ?? "Seu pet"} fez check-in!`,
        body: `${enriched.petName ?? "Seu pet"} chegou à creche com segurança.`,
        tag: `checkin-${updatedBooking.id}`,
        data: { type: "checkin", bookingId: updatedBooking.id, petId: updatedBooking.petId },
      }).catch(() => {});
    }

    // Trigger task generation in background
    import("../lib/scheduler.js")
      .then(({ generateTasksForPetToday }) => generateTasksForPetToday(updatedBooking.petId, crecheId))
      .catch((err: unknown) => console.error("[check-in] task generation failed:", err));

    return { booking: updatedBooking, enriched };
  }

  /**
   * Pure Canonical Check-out Validation.
   * Single source of truth for pet existence, active booking status, and stay/day-use eligibility.
   * Reused identically by previewCheckOut and checkOutBooking.
   */
  public static async validateCheckOut(params: ValidateCheckOutParams): Promise<ValidatedCheckOut> {
    const { bookingId, petId: expectedPetId, crecheId, tx } = params;
    const dbHandle = tx || db;

    let targetBookingId = bookingId;
    let targetPetId = expectedPetId;

    // 1. If only petId provided, fetch pet and find active booking
    if (!targetBookingId && targetPetId) {
      const [pet] = await dbHandle
        .select({ id: petsTable.id, name: petsTable.name, isCheckedIn: petsTable.isCheckedIn })
        .from(petsTable)
        .where(and(eq(petsTable.id, targetPetId), eq(petsTable.crecheId, crecheId)))
        .limit(1);

      if (!pet) {
        throw clientError("Pet não encontrado nesta creche.", 404, "target_not_found");
      }

      const [activeBookingRow] = await dbHandle
        .select({
          booking: bookingsTable,
          catalogueItemType: catalogueItemsTable.type,
        })
        .from(bookingsTable)
        .leftJoin(catalogueItemsTable, eq(bookingsTable.primaryCatalogueItemId, catalogueItemsTable.id))
        .where(
          and(
            eq(bookingsTable.crecheId, crecheId),
            eq(bookingsTable.petId, targetPetId),
            eq(bookingsTable.status, "active")
          )
        )
        .limit(1);

      if (!activeBookingRow) {
        throw clientError("O pet não possui reserva ativa para check-out.", 400, "invalid_domain_state");
      }

      const activeBooking = activeBookingRow.booking || activeBookingRow;
      const catalogueItemType = activeBookingRow.catalogueItemType ?? null;

      if (isServiceBookingBackend(activeBooking.type, catalogueItemType)) {
        throw clientError("Apenas estadias e day use podem realizar check-out.", 400, "invalid_domain_state");
      }

      return {
        pet,
        booking: activeBooking,
        catalogueItemType,
      };
    }

    // 2. If bookingId is provided
    if (!targetBookingId) {
      throw clientError("Identificador da reserva ou do pet não fornecido.", 400, "invalid_payload");
    }

    const [row] = await dbHandle
      .select({
        booking: bookingsTable,
        catalogueItemType: catalogueItemsTable.type,
      })
      .from(bookingsTable)
      .leftJoin(catalogueItemsTable, eq(bookingsTable.primaryCatalogueItemId, catalogueItemsTable.id))
      .where(
        and(
          eq(bookingsTable.id, targetBookingId),
          eq(bookingsTable.crecheId, crecheId),
          eq(bookingsTable.status, "active")
        )
      )
      .limit(1);

    if (!row) {
      const [existingBooking] = await dbHandle
        .select({ id: bookingsTable.id, status: bookingsTable.status })
        .from(bookingsTable)
        .where(and(eq(bookingsTable.id, targetBookingId), eq(bookingsTable.crecheId, crecheId)))
        .limit(1);

      if (!existingBooking) {
        throw clientError("Reserva não encontrada", 404, "target_not_found");
      }
      throw clientError("O pet não possui reserva ativa para check-out.", 400, "invalid_domain_state");
    }

    const existing = row.booking || row;
    const catalogueItemType = row.catalogueItemType ?? null;

    if (expectedPetId && existing.petId !== expectedPetId) {
      throw clientError("A reserva não pertence a este pet.", 400, "invalid_domain_state");
    }

    if (existing.status !== "active") {
      throw clientError("O pet não possui reserva ativa para check-out.", 400, "invalid_domain_state");
    }

    if (isServiceBookingBackend(existing.type, catalogueItemType)) {
      throw clientError("Apenas estadias e day use podem realizar check-out.", 400, "invalid_domain_state");
    }

    const [pet] = await dbHandle
      .select({ id: petsTable.id, name: petsTable.name, isCheckedIn: petsTable.isCheckedIn })
      .from(petsTable)
      .where(eq(petsTable.id, existing.petId))
      .limit(1);

    return {
      pet: pet || { id: existing.petId, name: "Pet" },
      booking: existing,
      catalogueItemType,
    };
  }

  /**
   * Pure Canonical Check-out Preview.
   * Performs zero mutation and delegates 100% of business eligibility to validateCheckOut.
   */
  public static async previewCheckOut(params: PreviewCheckOutParams) {
    const { pet, booking } = await this.validateCheckOut(params);

    return {
      targetId: pet.id,
      previewData: {
        petId: pet.id,
        petName: pet.name,
        bookingId: booking.id,
        serviceType: booking.type,
        checkInTime: booking.checkInTime,
        notes: params.notes || null,
      },
      summary: `Realizar check-out do pet ${pet.name} (Reserva #${booking.id})`,
    };
  }

  /**
   * Canonical Check-out Domain Logic.
   * Shared between REST endpoints and Assistant Safe Actions.
   * Revalidates domain state under transaction lock via validateCheckOut.
   */
  public static async checkOutBooking(params: CheckOutBookingParams) {
    const { bookingId, crecheId, actorUserId, notes } = params;

    const runInTx = async (tx: any) => {
      await acquireTenantOperationalLock(crecheId, tx);

      // 1. Revalidate domain state under transaction lock using canonical validator
      const { booking: existing } = await BookingDomainService.validateCheckOut({
        bookingId,
        crecheId,
        actorUserId,
        actorRole: "staff",
        notes,
        tx,
      });

      await BillingService.acquireTutorFinancialLock(crecheId, existing.tutorId, tx);

      // 2. Atomic transition active -> completed
      const [lockedBooking] = await tx
        .update(bookingsTable)
        .set({
          status: "completed",
          checkOutTime: new Date(),
          onTheWayType: null,
          onTheWayEtaMinutes: null,
          onTheWayAt: null,
        })
        .where(
          and(
            eq(bookingsTable.crecheId, crecheId),
            eq(bookingsTable.id, bookingId),
            eq(bookingsTable.status, "active")
          )
        )
        .returning();

      if (!lockedBooking) {
        throw clientError("A reserva não está ativa ou o check-out já foi concluído.", 409);
      }

      await tx
        .update(petsTable)
        .set({ isCheckedIn: false })
        .where(eq(petsTable.id, lockedBooking.petId));

      // Charge consumables on check-out
      const consumables = await tx
        .select({
          itemId: bookingConsumablesTable.itemId,
          quantity: bookingConsumablesTable.quantity,
          chargedPrice: bookingConsumablesTable.chargedPrice,
          itemName: catalogueItemsTable.name,
        })
        .from(bookingConsumablesTable)
        .leftJoin(catalogueItemsTable, eq(bookingConsumablesTable.itemId, catalogueItemsTable.id))
        .where(eq(bookingConsumablesTable.bookingId, bookingId));

      const consumableCharges = consumables.filter((item: any) => Number(item.chargedPrice) > 0);

      if (consumableCharges.length > 0 && lockedBooking.tutorId) {
        let firstInvoiceId: number | null = null;
        for (const item of consumableCharges) {
          const { invoiceId } = await BillingService.addCharge({
            crecheId,
            tutorId: lockedBooking.tutorId,
            amount: Number(item.chargedPrice),
            quantity: item.quantity,
            description: item.itemName || `Consumível #${item.itemId}`,
            type: "consumable",
            petId: lockedBooking.petId,
            bookingId: bookingId,
            itemDate: new Date(),
            tx,
          });
          if (firstInvoiceId === null) firstInvoiceId = invoiceId;
        }

        await logFinancialAudit({
          crecheId,
          userId: actorUserId,
          action: "invoice_create",
          referenceId: firstInvoiceId!,
          referenceType: "invoices",
          details: `Check-out da reserva #${bookingId}. ${consumableCharges.length} consumível(is) faturado(s) no check-out.`,
        }, tx);
      }

      return lockedBooking;
    };

    const completedBooking = params.tx ? await runInTx(params.tx) : await db.transaction(runInTx);
    const enriched = await getBookingWithNames(completedBooking);

    // Push notification to tutor
    if (completedBooking.tutorId) {
      sendPushToUser(completedBooking.tutorId, {
        title: `🏠 ${enriched.petName ?? "Seu pet"} fez check-out!`,
        body: `${enriched.petName ?? "Seu pet"} está pronto para ir para casa.`,
        tag: `checkout-${completedBooking.id}`,
        data: {
          type: "checkout",
          bookingId: completedBooking.id,
          petId: completedBooking.petId,
        },
      }).catch(() => {});
    }

    return { booking: completedBooking, enriched };
  }
}
