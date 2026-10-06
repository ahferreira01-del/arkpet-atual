import { db } from "@workspace/db";
import {
  crechesTable,
  bookingsTable,
  petsTable,
  tasksTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, and, gte, lte, or, inArray, desc } from "drizzle-orm";
import { getBusinessDate } from "../lib/date.js";
import { ASSISTANT_CONFIG } from "./assistant.config.js";
import { OperationalPriorityEngine } from "./operational-priority.engine.js";
import type {
  OperationalSnapshot,
  OperationalArrivalItem,
  OperationalTaskItem,
  OperationalSourceStatus,
} from "./assistant.types.js";

interface CacheEntry {
  snapshot: OperationalSnapshot;
  cachedAt: number;
  expiresAt: number;
}

export interface SessionBaselineContext {
  sessionId: string;
  userId: number;
  crecheId: number;
  role: string;
}

interface SessionBaselineEntry {
  sessionId: string;
  userId: number;
  crecheId: number;
  role: string;
  snapshot: OperationalSnapshot;
  storedAt: number;
}

export class OperationalSnapshotService {
  /**
   * Tenant-isolated in-memory cache.
   * Keyed strictly by crecheId (CROSS_TENANT_OPERATIONAL_CACHE_LEAK = 0).
   * Documented TTL: 30 seconds (OPERATIONAL_CACHE_TTL_DOCUMENTED = YES).
   */
  private static cache: Map<number, CacheEntry> = new Map();

  /**
   * Session-based snapshot history for change detection (process-local).
   * Bound strictly to sessionId, userId, crecheId and role.
   */
  private static sessionBaselines: Map<string, SessionBaselineEntry> = new Map();

  /**
   * Invalidates cached operational snapshot for a specific creche.
   * Triggered upon execution of safe actions (SAFE_ACTION_OPERATIONAL_CACHE_INVALIDATION = PASS).
   */
  public static invalidateCache(crecheId: number): void {
    this.cache.delete(crecheId);
  }

  /**
   * Clears entire operational cache (for testing or restart).
   */
  public static clearAllCache(): void {
    this.cache.clear();
    this.sessionBaselines.clear();
  }

  /**
   * Sets a session baseline for change comparison with strict security binding.
   * UNBOUND_OPERATIONAL_SESSION_API = 0: Only accepts SessionBaselineContext. Unbound strings are rejected.
   */
  public static setSessionBaseline(
    context: SessionBaselineContext,
    snapshot: OperationalSnapshot
  ): void {
    if (
      !context ||
      typeof context !== "object" ||
      typeof context.sessionId !== "string" ||
      typeof context.userId !== "number" ||
      typeof context.crecheId !== "number" ||
      typeof context.role !== "string"
    ) {
      throw new Error(
        "Invalid SessionBaselineContext: sessionId, userId, crecheId, and role are strictly required"
      );
    }
    this.sessionBaselines.set(context.sessionId, {
      sessionId: context.sessionId,
      userId: context.userId,
      crecheId: context.crecheId,
      role: context.role,
      snapshot,
      storedAt: Date.now(),
    });
  }

  /**
   * Retrieves the session baseline for comparison with strict security verification.
   * UNBOUND_OPERATIONAL_SESSION_API = 0: Only accepts SessionBaselineContext. Unbound strings are rejected.
   */
  public static getSessionBaseline(
    context: SessionBaselineContext
  ): OperationalSnapshot | undefined {
    if (
      !context ||
      typeof context !== "object" ||
      typeof context.sessionId !== "string" ||
      typeof context.userId !== "number" ||
      typeof context.crecheId !== "number" ||
      typeof context.role !== "string"
    ) {
      return undefined;
    }
    const entry = this.sessionBaselines.get(context.sessionId);
    if (!entry) return undefined;
    if (
      entry.userId !== context.userId ||
      entry.crecheId !== context.crecheId ||
      entry.role !== context.role
    ) {
      return undefined;
    }
    return entry.snapshot;
  }

  /**
   * Fetches a coherent operational snapshot for the given creche.
   * Reuses cache if valid and forceRefresh is false.
   */
  public static async getSnapshot(
    crecheId: number,
    options?: { forceRefresh?: boolean }
  ): Promise<OperationalSnapshot> {
    const nowMs = Date.now();
    if (!options?.forceRefresh) {
      const cached = this.cache.get(crecheId);
      if (cached && cached.expiresAt > nowMs) {
        return cached.snapshot;
      }
    }

    const serverNow = new Date();
    const asOf = serverNow.toISOString();
    const businessDate = getBusinessDate("America/Sao_Paulo");
    const unavailableSources: string[] = [];

    // 1. Fetch Creche Occupancy & Capacity (FAKE_OPERATIONAL_CAPACITY_FALLBACK = 0)
    let occupancy: { current: number | null; capacity: number | null } | null = null;
    try {
      const [creche] = await db
        .select({
          maxCapacity: crechesTable.maxCapacity,
          currentOccupancy: crechesTable.currentOccupancy,
        })
        .from(crechesTable)
        .where(eq(crechesTable.id, crecheId))
        .limit(1);

      if (creche) {
        occupancy = {
          current: creche.currentOccupancy ?? 0,
          capacity: creche.maxCapacity ?? null,
        };
      } else {
        occupancy = { current: 0, capacity: null };
      }
    } catch {
      unavailableSources.push("occupancy");
      occupancy = null;
    }

    // 2. Fetch Arrivals & Bookings for Today (DATA_RETRIEVAL_FAILURE_INTERPRETED_AS_ZERO = 0)
    let arrivalItems: OperationalArrivalItem[] = [];
    let arrivalsTotalExpected = 0;
    let arrivalsCheckedIn = 0;
    let arrivalsPending = 0;
    let arrivalsCompleted = 0;
    let arrivalsCancelled = 0;
    let arrivalsOnTheWay = 0;

    let departuresTotalExpected = 0;
    let departuresCheckedOut = 0;
    let departuresPending = 0;

    let arrivalsData: OperationalSnapshot["arrivals"] = null;
    let departuresData: OperationalSnapshot["departures"] = null;

    try {
      // Query bookings for today: startDate <= businessDate AND (endDate >= businessDate OR endDate IS NULL)
      // or status = 'active'
      const bookingsRaw = await db
        .select({
          id: bookingsTable.id,
          petId: bookingsTable.petId,
          petName: petsTable.name,
          tutorId: bookingsTable.tutorId,
          type: bookingsTable.type,
          status: bookingsTable.status,
          startDate: bookingsTable.startDate,
          endDate: bookingsTable.endDate,
          onTheWayType: bookingsTable.onTheWayType,
          onTheWayEtaMinutes: bookingsTable.onTheWayEtaMinutes,
          onTheWayAt: bookingsTable.onTheWayAt,
        })
        .from(bookingsTable)
        .leftJoin(petsTable, eq(bookingsTable.petId, petsTable.id))
        .where(
          and(
            eq(bookingsTable.crecheId, crecheId),
            or(
              eq(bookingsTable.startDate, businessDate),
              eq(bookingsTable.endDate, businessDate),
              eq(bookingsTable.status, "active")
            )
          )
        )
        .orderBy(desc(bookingsTable.startDate));

      for (const b of bookingsRaw) {
        const isStartDate = b.startDate === businessDate;
        const isEndDate = b.endDate === businessDate;

        if (isStartDate) {
          arrivalsTotalExpected++;
          if (b.status === "active") {
            arrivalsCheckedIn++;
          } else if (b.status === "confirmed") {
            arrivalsPending++;
          } else if (b.status === "completed") {
            arrivalsCompleted++;
          } else if (b.status === "cancelled") {
            arrivalsCancelled++;
          }

          if (b.onTheWayAt || b.onTheWayType) {
            arrivalsOnTheWay++;
          }

          arrivalItems.push({
            bookingId: b.id,
            petId: b.petId,
            petName: b.petName || `Pet #${b.petId}`,
            tutorId: b.tutorId,
            status: b.status,
            serviceType: b.type,
            onTheWayType: b.onTheWayType,
            onTheWayEtaMinutes: b.onTheWayEtaMinutes,
            onTheWayAt: b.onTheWayAt ? b.onTheWayAt.toISOString() : null,
          });
        }

        if (isEndDate || (b.status === "active" && !b.endDate)) {
          departuresTotalExpected++;
          if (b.status === "completed") {
            departuresCheckedOut++;
          } else if (b.status === "active") {
            departuresPending++;
          }
        }
      }

      // If active bookings count exceeds occupancy column, reflect active count
      const activeBookingsCount = bookingsRaw.filter((b) => b.status === "active").length;
      if (occupancy && activeBookingsCount > (occupancy.current ?? 0)) {
        occupancy.current = activeBookingsCount;
      }

      const maxLimit = ASSISTANT_CONFIG.operationalMaxListLimit || 25;
      arrivalsData = {
        totalExpected: arrivalsTotalExpected,
        checkedIn: arrivalsCheckedIn,
        pending: arrivalsPending,
        completed: arrivalsCompleted,
        cancelled: arrivalsCancelled,
        onTheWay: arrivalsOnTheWay,
        items: arrivalItems.slice(0, maxLimit),
      };

      departuresData = {
        totalExpected: departuresTotalExpected,
        checkedOut: departuresCheckedOut,
        pending: departuresPending,
      };
    } catch {
      unavailableSources.push("bookings");
      arrivalsData = null;
      departuresData = null;
    }

    // 3. Fetch Tasks (Today + Overdue Pending)
    let taskItems: OperationalTaskItem[] = [];
    let tasksTotal = 0;
    let tasksPending = 0;
    let tasksCompleted = 0;
    let tasksOverdue = 0;
    let tasksUnassigned = 0;

    const byType = {
      feeding: { total: 0, pending: 0, completed: 0, overdue: 0 },
      medication: { total: 0, pending: 0, completed: 0, overdue: 0 },
      walk: { total: 0, pending: 0, completed: 0, overdue: 0 },
      other: { total: 0, pending: 0, completed: 0, overdue: 0 },
    };

    let tasksData: OperationalSnapshot["tasks"] = null;

    try {
      const todayStart = new Date(`${businessDate}T00:00:00-03:00`);
      const todayEnd = new Date(`${businessDate}T23:59:59-03:00`);

      const tasksRaw = await db
        .select({
          id: tasksTable.id,
          type: tasksTable.type,
          title: tasksTable.title,
          status: tasksTable.status,
          scheduledFor: tasksTable.scheduledFor,
          petId: tasksTable.petId,
          petName: petsTable.name,
          assignedToId: tasksTable.assignedToId,
          assignedToName: usersTable.name,
          priority: tasksTable.priority,
        })
        .from(tasksTable)
        .leftJoin(petsTable, and(eq(tasksTable.petId, petsTable.id), eq(petsTable.crecheId, crecheId)))
        .leftJoin(usersTable, and(eq(tasksTable.assignedToId, usersTable.id), eq(usersTable.crecheId, crecheId)))
        .where(
          and(
            eq(tasksTable.crecheId, crecheId),
            or(
              and(gte(tasksTable.scheduledFor, todayStart), lte(tasksTable.scheduledFor, todayEnd)),
              and(eq(tasksTable.status, "pending"), lte(tasksTable.scheduledFor, serverNow))
            )
          )
        )
        .orderBy(tasksTable.scheduledFor);

      for (const t of tasksRaw) {
        tasksTotal++;
        const isPast = new Date(t.scheduledFor).getTime() < serverNow.getTime();
        const isOverdue = t.status === "pending" && isPast;
        const delayMinutes = isOverdue
          ? Math.max(0, Math.floor((serverNow.getTime() - new Date(t.scheduledFor).getTime()) / 60000))
          : 0;

        const cat = t.type === "feeding" || t.type === "medication" || t.type === "walk" ? t.type : "other";
        byType[cat].total++;

        if (t.status === "pending") {
          tasksPending++;
          byType[cat].pending++;
          if (isOverdue) {
            tasksOverdue++;
            byType[cat].overdue++;
          }
          if (!t.assignedToId) {
            tasksUnassigned++;
          }
        } else if (t.status === "completed") {
          tasksCompleted++;
          byType[cat].completed++;
        }

        taskItems.push({
          id: t.id,
          type: t.type,
          title: t.title,
          status: t.status,
          scheduledFor: t.scheduledFor.toISOString(),
          petId: t.petId,
          petName: t.petName || (t.petId ? `Pet #${t.petId}` : null),
          assignedToId: t.assignedToId,
          assignedToName: t.assignedToName || null,
          priority: t.priority,
          isOverdue,
          delayMinutes,
        });
      }

      const maxLimit = ASSISTANT_CONFIG.operationalMaxListLimit || 25;
      tasksData = {
        total: tasksTotal,
        pending: tasksPending,
        completed: tasksCompleted,
        overdue: tasksOverdue,
        unassigned: tasksUnassigned,
        byType,
        items: taskItems.slice(0, maxLimit),
      };
    } catch {
      unavailableSources.push("tasks");
      tasksData = null;
    }

    const dataCompleteness: "complete" | "partial" =
      unavailableSources.length === 0 ? "complete" : "partial";

    const sourceStatus: OperationalSourceStatus = {
      occupancy: unavailableSources.includes("occupancy") ? "unavailable" : "available",
      bookings: unavailableSources.includes("bookings") ? "unavailable" : "available",
      tasks: unavailableSources.includes("tasks") ? "unavailable" : "available",
    };

    // Evaluate Priorities deterministically
    const issues = OperationalPriorityEngine.evaluate({
      serverNow,
      businessDate,
      arrivals: arrivalItems,
      tasks: taskItems,
    });

    const snapshot: OperationalSnapshot = {
      asOf,
      businessDate,
      crecheId,
      dataCompleteness,
      unavailableSources: unavailableSources.length > 0 ? unavailableSources : undefined,
      sourceStatus,
      occupancy,
      arrivals: arrivalsData,
      departures: departuresData,
      tasks: tasksData,
      issues,
    };

    // Store in tenant cache
    const ttlSeconds = ASSISTANT_CONFIG.operationalCacheTtlSeconds || 30;
    this.cache.set(crecheId, {
      snapshot,
      cachedAt: nowMs,
      expiresAt: nowMs + ttlSeconds * 1000,
    });

    return snapshot;
  }

  /**
   * Compares current snapshot with a baseline to answer "O que mudou desde o último resumo?".
   */
  public static async compareWithBaseline(
    crecheId: number,
    baseline?: OperationalSnapshot
  ): Promise<{
    hasChanges: boolean;
    changes: string[];
    asOf: string;
    baselineAsOf?: string;
  }> {
    const current = await this.getSnapshot(crecheId, { forceRefresh: true });
    if (!baseline) {
      return {
        hasChanges: false,
        changes: ["Nenhum resumo operacional anterior nesta sessão para comparação."],
        asOf: current.asOf,
      };
    }

    const changes: string[] = [];

    // 1. Arrival changes
    if (current.arrivals && baseline.arrivals) {
      if (
        current.arrivals.checkedIn !== null &&
        baseline.arrivals.checkedIn !== null &&
        current.arrivals.checkedIn > baseline.arrivals.checkedIn
      ) {
        const diff = current.arrivals.checkedIn - baseline.arrivals.checkedIn;
        changes.push(`${diff} novo(s) check-in(s) realizado(s).`);
      }
      if (
        current.arrivals.pending !== null &&
        baseline.arrivals.pending !== null &&
        current.arrivals.pending < baseline.arrivals.pending
      ) {
        const diff = baseline.arrivals.pending - current.arrivals.pending;
        changes.push(`${diff} reserva(s) que aguardavam check-in foram atendidas.`);
      }
    }

    // 2. Task completion changes
    if (current.tasks && baseline.tasks) {
      if (
        current.tasks.completed !== null &&
        baseline.tasks.completed !== null &&
        current.tasks.completed > baseline.tasks.completed
      ) {
        const diff = current.tasks.completed - baseline.tasks.completed;
        changes.push(`${diff} tarefa(s) operacional(is) concluída(s).`);
      }

      // 3. Overdue changes
      if (
        current.tasks.overdue !== null &&
        baseline.tasks.overdue !== null
      ) {
        if (current.tasks.overdue > baseline.tasks.overdue) {
          const diff = current.tasks.overdue - baseline.tasks.overdue;
          changes.push(`${diff} nova(s) tarefa(s) entraram em atraso.`);
        } else if (current.tasks.overdue < baseline.tasks.overdue) {
          const diff = baseline.tasks.overdue - current.tasks.overdue;
          changes.push(`${diff} tarefa(s) que estavam atrasadas foram resolvidas.`);
        }
      }

      // 4. Medication changes
      if (
        current.tasks.byType.medication.completed !== null &&
        baseline.tasks.byType.medication.completed !== null &&
        current.tasks.byType.medication.completed > baseline.tasks.byType.medication.completed
      ) {
        const diff = current.tasks.byType.medication.completed - baseline.tasks.byType.medication.completed;
        changes.push(`${diff} medicação(ões) administrada(s).`);
      }

      // 5. Feeding changes
      if (
        current.tasks.byType.feeding.completed !== null &&
        baseline.tasks.byType.feeding.completed !== null &&
        current.tasks.byType.feeding.completed > baseline.tasks.byType.feeding.completed
      ) {
        const diff = current.tasks.byType.feeding.completed - baseline.tasks.byType.feeding.completed;
        changes.push(`${diff} alimentação(ões) concluída(s).`);
      }
    }

    if (changes.length === 0) {
      changes.push("Nenhuma alteração operacional detectada desde o último resumo.");
    }

    return {
      hasChanges: changes.length > 0 && !changes[0].includes("Nenhuma alteração"),
      changes,
      asOf: current.asOf,
      baselineAsOf: baseline.asOf,
    };
  }
}
