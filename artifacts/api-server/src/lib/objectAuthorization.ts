import { db } from "@workspace/db";
import {
  timelineEventsTable,
  timelineEventPetsTable,
  petsTable,
  vaccinesTable,
  bookingsTable,
  invoicesTable,
  catalogueItemsTable,
  chatMessagesTable,
} from "@workspace/db/schema";
import { and, eq, or } from "drizzle-orm";

const CANONICAL_PATH_REGEX =
  /^(?:\/api\/storage)?(?:\/objects\/|\/)?uploads\/c([1-9]\d*)\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(\.[a-zA-Z0-9]+)?$/;

export interface CanonicalPathParseResult {
  ok: boolean;
  pathCrecheId?: number;
  canonicalObjectPath?: string;
  storageKey?: string;
  error?: string;
}

/**
 * Strict canonical parser for private object storage paths.
 * Enforces:
 *   - Format: uploads/c<positive-int>/<UUID>[.<extension>]
 *   - No path traversal (..)
 *   - Extracts integer crecheId, UUID, and normalized /objects/ canonical path.
 */
export function parseCanonicalPrivateObjectPath(path: string): CanonicalPathParseResult {
  if (!path || typeof path !== "string") {
    return { ok: false, error: "Caminho de arquivo vazio ou inválido" };
  }

  // Reject path traversal
  if (path.includes("..")) {
    return { ok: false, error: "Caminho de arquivo contém caracteres não permitidos" };
  }

  const match = path.trim().match(CANONICAL_PATH_REGEX);
  if (!match) {
    return { ok: false, error: "Formato de caminho de arquivo privado inválido" };
  }

  const pathCrecheId = parseInt(match[1], 10);
  if (Number.isNaN(pathCrecheId) || pathCrecheId <= 0) {
    return { ok: false, error: "ID de creche inválido no caminho" };
  }

  const uuid = match[2].toLowerCase();
  const ext = match[3] || "";
  const canonicalObjectPath = `/objects/uploads/c${pathCrecheId}/${uuid}${ext}`;
  const storageKey = `uploads/c${pathCrecheId}/${uuid}${ext}`;

  return {
    ok: true,
    pathCrecheId,
    canonicalObjectPath,
    storageKey,
  };
}

export interface UserContext {
  id: number;
  role: string;
  crecheId?: number | null;
}

/**
 * Evaluates whether a user is authorized to download a private storage object.
 *
 * Rules:
 * 1. master_admin: Global access allowed.
 * 2. staff / creche_admin: Allowed for any object within their authorized creche (user.crecheId === pathCrecheId).
 * 3. tutor: Allowed ONLY if user.crecheId === pathCrecheId AND at least ONE current business resource
 *    referencing the canonicalObjectPath belongs to this tutor:
 *      - Feed / Timeline event tagging tutor's pet (via N:N timeline_event_pets or legacy petId)
 *      - Pet profile or check-in photo for a pet owned by tutor
 *      - Vaccine receipt for a pet owned by tutor
 *      - Booking personal items photo for a booking owned by tutor
 *      - Invoice receipt for an invoice owned by tutor
 *      - Active Store product image within the creche catalog
 *      - Chat message in tutor's conversation thread
 */
export async function canUserAccessPrivateResource({
  canonicalObjectPath,
  pathCrecheId,
  user,
}: {
  canonicalObjectPath: string;
  pathCrecheId: number;
  user: UserContext;
}): Promise<boolean> {
  // Master Admin has global operational access
  if (user.role === "master_admin") {
    return true;
  }

  // Cross-tenant gate for non-master roles
  if (user.crecheId !== pathCrecheId) {
    return false;
  }

  // Operational staff and creche admins have broad operational access within their assigned creche
  if (user.role === "staff" || user.role === "creche_admin") {
    return true;
  }

  // Tutors must have at least one authorized business resource referencing this object
  if (user.role === "tutor") {
    // 1. Check Feed / Timeline Events
    const events = await db
      .select({
        id: timelineEventsTable.id,
        petId: timelineEventsTable.petId,
      })
      .from(timelineEventsTable)
      .where(
        and(
          eq(timelineEventsTable.crecheId, pathCrecheId),
          eq(timelineEventsTable.mediaUrl, canonicalObjectPath)
        )
      );

    for (const ev of events) {
      // Check N:N relations
      const eventPets = await db
        .select({ tutorId: petsTable.tutorId })
        .from(timelineEventPetsTable)
        .innerJoin(petsTable, eq(timelineEventPetsTable.petId, petsTable.id))
        .where(eq(timelineEventPetsTable.eventId, ev.id));

      if (eventPets.length > 0) {
        if (eventPets.some((p) => p.tutorId === user.id)) {
          return true;
        }
      } else if (ev.petId != null) {
        // Legacy single-pet fallback
        const [legacyPet] = await db
          .select({ tutorId: petsTable.tutorId })
          .from(petsTable)
          .where(and(eq(petsTable.id, ev.petId), eq(petsTable.crecheId, pathCrecheId)))
          .limit(1);

        if (legacyPet && legacyPet.tutorId === user.id) {
          return true;
        }
      }
    }

    // 2. Check Pet Profile Photos & Last Check-in Photos
    const [petMatch] = await db
      .select({ id: petsTable.id })
      .from(petsTable)
      .where(
        and(
          eq(petsTable.crecheId, pathCrecheId),
          eq(petsTable.tutorId, user.id),
          or(
            eq(petsTable.photoUrl, canonicalObjectPath),
            eq(petsTable.lastCheckinPhotoUrl, canonicalObjectPath)
          )
        )
      )
      .limit(1);

    if (petMatch) {
      return true;
    }

    // 3. Check Vaccine Receipts
    const [vaccineMatch] = await db
      .select({ id: vaccinesTable.id })
      .from(vaccinesTable)
      .innerJoin(petsTable, eq(vaccinesTable.petId, petsTable.id))
      .where(
        and(
          eq(vaccinesTable.crecheId, pathCrecheId),
          eq(vaccinesTable.receiptUrl, canonicalObjectPath),
          eq(petsTable.tutorId, user.id)
        )
      )
      .limit(1);

    if (vaccineMatch) {
      return true;
    }

    // 4. Check Booking Personal Items Photos
    const [bookingMatch] = await db
      .select({ id: bookingsTable.id })
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.crecheId, pathCrecheId),
          eq(bookingsTable.tutorId, user.id),
          eq(bookingsTable.personalItemsPhotoUrl, canonicalObjectPath)
        )
      )
      .limit(1);

    if (bookingMatch) {
      return true;
    }

    // 5. Check Invoice Receipts
    const [invoiceMatch] = await db
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(
        and(
          eq(invoicesTable.crecheId, pathCrecheId),
          eq(invoicesTable.tutorId, user.id),
          eq(invoicesTable.receiptPhotoPath, canonicalObjectPath)
        )
      )
      .limit(1);

    if (invoiceMatch) {
      return true;
    }

    // 6. Check Store Products (Catalog images accessible to all tutors of the creche)
    const storeProducts = await db
      .select({
        id: catalogueItemsTable.id,
        mediaUrls: catalogueItemsTable.mediaUrls,
      })
      .from(catalogueItemsTable)
      .where(
        and(
          eq(catalogueItemsTable.crecheId, pathCrecheId),
          eq(catalogueItemsTable.isActive, true)
        )
      );

    for (const sp of storeProducts) {
      if (Array.isArray(sp.mediaUrls) && sp.mediaUrls.includes(canonicalObjectPath)) {
        return true;
      }
    }

    // 7. Check Chat Messages (Tutor conversation thread)
    const [chatMatch] = await db
      .select({ id: chatMessagesTable.id })
      .from(chatMessagesTable)
      .where(
        and(
          eq(chatMessagesTable.crecheId, pathCrecheId),
          eq(chatMessagesTable.tutorId, user.id),
          eq(chatMessagesTable.mediaUrl, canonicalObjectPath)
        )
      )
      .limit(1);

    if (chatMatch) {
      return true;
    }
  }

  return false;
}
