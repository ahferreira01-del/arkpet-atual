import { Router, type Response } from "express";
import { db } from "@workspace/db";
import { petsTable, usersTable, bookingsTable, crechesTable } from "@workspace/db/schema";
import { eq, and, or, ilike } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { requireActiveSubscription } from "../middlewares/requireActiveSubscription.js";

const router = Router();
router.use(authenticate);
router.use(requireActiveSubscription);

export interface SearchResultItem {
  id: string | number;
  type: "pet" | "tutor" | "booking" | "creche" | "user";
  title: string;
  subtitle?: string;
  url: string;
  badge?: string;
}

export interface SearchGroup {
  type: "pet" | "tutor" | "booking" | "creche" | "user";
  label: string;
  items: SearchResultItem[];
}

export interface SearchResponse {
  query: string;
  groups: SearchGroup[];
  total: number;
}

function sanitizeLike(input: string): string {
  return input.replace(/[%_\\]/g, "\\$&");
}

export async function executeGlobalSearch(
  user: { id: number; role: string; crecheId: number | null },
  rawQuery: string,
  dbInstance: any = db
): Promise<SearchResponse> {
  const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
  const minLength = 2;

  if (query.length < minLength) {
    return {
      query,
      groups: [],
      total: 0,
    };
  }

  const likePattern = `%${sanitizeLike(query)}%`;
  const groups: SearchGroup[] = [];

  if (user.role === "master_admin") {
    // ── MASTER ADMIN SEARCH ───────────────────────────────────────────────
    // Allowed: Creches across the network and system Users
    const [creches, platformUsers] = await Promise.all([
      dbInstance
        .select({
          id: crechesTable.id,
          name: crechesTable.name,
          address: crechesTable.address,
          status: crechesTable.status,
        })
        .from(crechesTable)
        .where(
          or(
            ilike(crechesTable.name, likePattern),
            ilike(crechesTable.address, likePattern)
          )
        )
        .limit(5),
      dbInstance
        .select({
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
          role: usersTable.role,
        })
        .from(usersTable)
        .where(
          or(
            ilike(usersTable.name, likePattern),
            ilike(usersTable.email, likePattern)
          )
        )
        .limit(5),
    ]);

    if (creches.length > 0) {
      groups.push({
        type: "creche",
        label: "Creches",
        items: creches.map((c: any) => ({
          id: c.id,
          type: "creche",
          title: c.name,
          subtitle: c.address,
          badge: c.status,
          url: "/admin/creches",
        })),
      });
    }

    if (platformUsers.length > 0) {
      groups.push({
        type: "user",
        label: "Usuários",
        items: platformUsers.map((u: any) => ({
          id: u.id,
          type: "user",
          title: u.name,
          subtitle: `${u.email} • Papel: ${u.role}`,
          badge: u.role,
          url: "/admin/users",
        })),
      });
    }
  } else if (user.role === "creche_admin" || user.role === "staff") {
    // ── CRECHE ADMIN & STAFF SEARCH ───────────────────────────────────────
    // Strictly scoped to the authenticated user's own crecheId.
    const crecheId = user.crecheId;
    if (!crecheId) {
      return { query, groups: [], total: 0 };
    }

    const [pets, tutors, bookings] = await Promise.all([
      // 1. Pets in creche
      dbInstance
        .select({
          id: petsTable.id,
          name: petsTable.name,
          species: petsTable.species,
          breed: petsTable.breed,
          status: petsTable.status,
          tutorName: usersTable.name,
        })
        .from(petsTable)
        .leftJoin(usersTable, eq(petsTable.tutorId, usersTable.id))
        .where(
          and(
            eq(petsTable.crecheId, crecheId),
            or(
              ilike(petsTable.name, likePattern),
              ilike(petsTable.breed, likePattern),
              ilike(usersTable.name, likePattern)
            )
          )
        )
        .limit(5),

      // 2. Tutors in creche
      dbInstance
        .select({
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
        })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.crecheId, crecheId),
            eq(usersTable.role, "tutor"),
            or(
              ilike(usersTable.name, likePattern),
              ilike(usersTable.email, likePattern)
            )
          )
        )
        .limit(5),

      // 3. Bookings in creche
      dbInstance
        .select({
          id: bookingsTable.id,
          type: bookingsTable.type,
          status: bookingsTable.status,
          startDate: bookingsTable.startDate,
          petName: petsTable.name,
          tutorName: usersTable.name,
        })
        .from(bookingsTable)
        .leftJoin(petsTable, eq(bookingsTable.petId, petsTable.id))
        .leftJoin(usersTable, eq(bookingsTable.tutorId, usersTable.id))
        .where(
          and(
            eq(bookingsTable.crecheId, crecheId),
            or(
              ilike(bookingsTable.type, likePattern),
              ilike(petsTable.name, likePattern),
              ilike(usersTable.name, likePattern)
            )
          )
        )
        .limit(5),
    ]);

    if (pets.length > 0) {
      groups.push({
        type: "pet",
        label: "Pets",
        items: pets.map((p: any) => ({
          id: p.id,
          type: "pet",
          title: p.name,
          subtitle: `${p.breed || p.species || "Pet"}${p.tutorName ? ` • Tutor: ${p.tutorName}` : ""}`,
          badge: p.status === "active" ? undefined : "Inativo",
          url: `/pets/${p.id}`,
        })),
      });
    }

    if (tutors.length > 0) {
      groups.push({
        type: "tutor",
        label: "Tutores",
        items: tutors.map((t: any) => ({
          id: t.id,
          type: "tutor",
          title: t.name,
          subtitle: t.email,
          url: "/tutors",
        })),
      });
    }

    if (bookings.length > 0) {
      groups.push({
        type: "booking",
        label: "Reservas",
        items: bookings.map((b: any) => ({
          id: b.id,
          type: "booking",
          title: `Reserva #${b.id} — ${b.type}`,
          subtitle: `${b.petName ? `${b.petName} • ` : ""}${b.tutorName ? `${b.tutorName} • ` : ""}${b.startDate}`,
          badge: b.status,
          url: "/bookings",
        })),
      });
    }
  } else if (user.role === "tutor") {
    // ── TUTOR SEARCH ──────────────────────────────────────────────────────
    // Strictly scoped to the authenticated tutor's OWN pets and OWN bookings.
    // Zero access to other tutors (TUTOR_SEARCH_OTHER_TUTOR = 0).
    // Zero access to foreign pets (TUTOR_SEARCH_FOREIGN_PET = 0).
    // Zero access to foreign bookings (TUTOR_SEARCH_FOREIGN_BOOKING = 0).
    const crecheId = user.crecheId;
    if (!crecheId) {
      return { query, groups: [], total: 0 };
    }

    const [pets, bookings] = await Promise.all([
      // 1. Tutor's own pets only
      dbInstance
        .select({
          id: petsTable.id,
          name: petsTable.name,
          species: petsTable.species,
          breed: petsTable.breed,
          status: petsTable.status,
        })
        .from(petsTable)
        .where(
          and(
            eq(petsTable.crecheId, crecheId),
            eq(petsTable.tutorId, user.id),
            or(
              ilike(petsTable.name, likePattern),
              ilike(petsTable.breed, likePattern)
            )
          )
        )
        .limit(5),

      // 2. Tutor's own bookings only
      dbInstance
        .select({
          id: bookingsTable.id,
          type: bookingsTable.type,
          status: bookingsTable.status,
          startDate: bookingsTable.startDate,
          petName: petsTable.name,
        })
        .from(bookingsTable)
        .leftJoin(petsTable, eq(bookingsTable.petId, petsTable.id))
        .where(
          and(
            eq(bookingsTable.crecheId, crecheId),
            eq(bookingsTable.tutorId, user.id),
            or(
              ilike(bookingsTable.type, likePattern),
              ilike(petsTable.name, likePattern)
            )
          )
        )
        .limit(5),
    ]);

    if (pets.length > 0) {
      groups.push({
        type: "pet",
        label: "Meus Pets",
        items: pets.map((p: any) => ({
          id: p.id,
          type: "pet",
          title: p.name,
          subtitle: p.breed || p.species || "Pet",
          badge: p.status === "active" ? undefined : "Inativo",
          url: `/pets/${p.id}`,
        })),
      });
    }

    if (bookings.length > 0) {
      groups.push({
        type: "booking",
        label: "Minhas Reservas",
        items: bookings.map((b: any) => ({
          id: b.id,
          type: "booking",
          title: `Reserva #${b.id} — ${b.type}`,
          subtitle: `${b.petName ? `${b.petName} • ` : ""}${b.startDate}`,
          badge: b.status,
          url: "/bookings",
        })),
      });
    }
  }

  const total = groups.reduce((acc, g) => acc + g.items.length, 0);
  return {
    query,
    groups,
    total,
  };
}

router.get("/", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawQuery = typeof req.query.q === "string" ? req.query.q : "";
    const result = await executeGlobalSearch(req.user!, rawQuery);
    res.json(result);
  } catch (error) {
    console.error("Global search error:", error);
    res.status(500).json({ error: "Erro interno ao processar a busca" });
  }
});

export default router;
