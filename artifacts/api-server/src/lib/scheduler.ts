import cron from "node-cron";
import { db } from "@workspace/db";
import { tasksTable, petsTable, usersTable, bookingsTable } from "@workspace/db/schema";
import { medicationsTable } from "@workspace/db/schema";
import { and, eq, gte, lte, isNotNull, inArray, or, isNull } from "drizzle-orm";
import { sendPushToUser } from "./push.js";

const notifiedTaskIds = new Set<number>();

// ─── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Returns today's date string (YYYY-MM-DD) in Brasilia time (UTC-3, no DST
 * since 2019). Always use this instead of new Date().toISOString().split("T")[0]
 * which returns the UTC date — after 21h BRT the UTC date is already "tomorrow".
 */
function getBrazilDateStr(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/**
 * Builds a Date for a specific wall-clock time on a given Brazil date.
 * Uses an explicit -03:00 offset so JS correctly converts to UTC internally.
 */
function makeTimeOnDate(brazilDateStr: string, hours: number, minutes: number): Date {
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  return new Date(`${brazilDateStr}T${hh}:${mm}:00-03:00`);
}

/**
 * Returns the hour and minute of a stored UTC Date in Brasilia time.
 * IMPORTANT: Always use this instead of d.getHours()/d.getMinutes() for
 * deduplication. Tasks are stored as UTC; the server timezone is UTC; so
 * getHours() returns UTC hours, not BRT hours — causing dedup to miss matches
 * and create one duplicate per server restart.
 */
function getBRTHourMinute(date: Date): { h: number; m: number } {
  const str = date.toLocaleTimeString("en-CA", {
    timeZone: "America/Sao_Paulo",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const [h, m] = str.split(":").map(Number);
  return { h, m };
}

// ─── Single-pet task generation (called on check-in) ─────────────────────────

export async function generateTasksForPetToday(petId: number, crecheId: number) {
  try {
    const todayStr = getBrazilDateStr();
    const startOfDay = new Date(`${todayStr}T00:00:00-03:00`);
    const endOfDay = new Date(`${todayStr}T23:59:59-03:00`);

    const [pet] = await db.select({
      id: petsTable.id,
      name: petsTable.name,
      crecheId: petsTable.crecheId,
      feedingSchedule: petsTable.feedingSchedule,
      walkSchedule: petsTable.walkSchedule,
    }).from(petsTable).where(eq(petsTable.id, petId)).limit(1);
    if (!pet) return;

    const existingTasks = await db.select({
      petId: tasksTable.petId,
      type: tasksTable.type,
      scheduledFor: tasksTable.scheduledFor,
    }).from(tasksTable).where(and(
      eq(tasksTable.petId, petId),
      gte(tasksTable.scheduledFor, startOfDay),
      lte(tasksTable.scheduledFor, endOfDay),
    ));

    const allMeds = await db.select({
      name: medicationsTable.name,
      dosage: medicationsTable.dosage,
      times: medicationsTable.times,
      startDate: medicationsTable.startDate,
      endDate: medicationsTable.endDate,
    }).from(medicationsTable).where(and(eq(medicationsTable.petId, petId), eq(medicationsTable.isActive, true)));

    const activeMeds = allMeds.filter((m) => {
      if (m.startDate > todayStr) return false;
      if (m.endDate && m.endDate < todayStr) return false;
      return true;
    });

    const alreadyExists = (type: string, h: number, m: number) =>
      existingTasks.some((t) => {
        if (t.type !== type) return false;
        const { h: taskH, m: taskM } = getBRTHourMinute(new Date(t.scheduledFor));
        return taskH === h && taskM === m;
      });

    const newTasks: (typeof tasksTable.$inferInsert)[] = [];
    // Track what we're already adding in this batch so duplicates inside
    // the schedule itself (e.g. two identical walk entries) are skipped.
    const batchKeys = new Set<string>();
    const inBatch = (type: string, h: number, m: number) => batchKeys.has(`${type}:${h}:${m}`);
    const markBatch = (type: string, h: number, m: number) => batchKeys.add(`${type}:${h}:${m}`);

    const feeding: Array<{ time: string; amount?: string; notes?: string }> =
      Array.isArray(pet.feedingSchedule) ? pet.feedingSchedule as any : [];
    for (const f of feeding) {
      if (!f.time) continue;
      const [h, m] = f.time.split(":").map(Number);
      if (isNaN(h) || isNaN(m)) continue;
      if (alreadyExists("feeding", h, m) || inBatch("feeding", h, m)) continue;
      markBatch("feeding", h, m);
      const desc = [f.amount, f.notes].filter(Boolean).join(" · ") || null;
      newTasks.push({ crecheId, petId, type: "feeding", title: `Alimentação — ${pet.name}`, description: desc, scheduledFor: makeTimeOnDate(todayStr, h, m), priority: "medium" });
    }

    const walks: Array<{ time: string; durationMinutes?: number; notes?: string }> =
      Array.isArray(pet.walkSchedule) ? pet.walkSchedule as any : [];
    for (const w of walks) {
      if (!w.time) continue;
      const [h, m] = w.time.split(":").map(Number);
      if (isNaN(h) || isNaN(m)) continue;
      if (alreadyExists("walk", h, m) || inBatch("walk", h, m)) continue;
      markBatch("walk", h, m);
      newTasks.push({ crecheId, petId, type: "walk", title: `Passeio — ${pet.name}`, description: w.notes || null, scheduledFor: makeTimeOnDate(todayStr, h, m), priority: "medium" });
    }

    for (const med of activeMeds) {
      const times: string[] = Array.isArray(med.times) ? med.times as string[] : [];
      for (const time of times) {
        const [h, m] = time.split(":").map(Number);
        if (isNaN(h) || isNaN(m)) continue;
        if (alreadyExists("medication", h, m) || inBatch("medication", h, m)) continue;
        markBatch("medication", h, m);
        newTasks.push({ crecheId, petId, type: "medication", title: `Medicação — ${pet.name}`, description: `${med.name}${med.dosage ? ` · ${med.dosage}` : ""}`, scheduledFor: makeTimeOnDate(todayStr, h, m), priority: "high" });
      }
    }

    if (newTasks.length > 0) {
      await db.insert(tasksTable).values(newTasks);
      console.log(`[scheduler] check-in: gerou ${newTasks.length} tarefa(s) para ${pet.name} em ${todayStr}`);
    }
  } catch (err) {
    console.error("[scheduler] erro ao gerar tarefas no check-in:", err);
  }
}

// ─── Daily bulk task generation (midnight cron) ───────────────────────────────

async function generateDailyTasks() {
  try {
    const todayStr = getBrazilDateStr();
    const startOfDay = new Date(`${todayStr}T00:00:00-03:00`);
    const endOfDay = new Date(`${todayStr}T23:59:59-03:00`);

    // Only generate tasks for pets that are ALREADY checked in (booking = "active").
    // Pets with "confirmed" bookings haven't arrived yet — their tasks are generated
    // on-demand via generateTasksForPetToday() when they check in.
    // This prevents tarefas from appearing for pets of the same tutor that are
    // booked but not yet at the creche.
    const bookedRows = await db.select({ petId: bookingsTable.petId })
      .from(bookingsTable)
      .where(and(
        eq(bookingsTable.status, "active"),
        lte(bookingsTable.startDate, todayStr),
        or(isNull(bookingsTable.endDate), gte(bookingsTable.endDate, todayStr)),
      ));

    const bookedPetIds = [...new Set(bookedRows.map((r) => r.petId))];
    if (!bookedPetIds.length) return;

    // Double-check with isCheckedIn flag on the pet itself.
    const pets = await db.select({
      id: petsTable.id,
      name: petsTable.name,
      crecheId: petsTable.crecheId,
      feedingSchedule: petsTable.feedingSchedule,
      walkSchedule: petsTable.walkSchedule,
    }).from(petsTable)
      .where(and(
        eq(petsTable.status, "active"),
        eq(petsTable.isCheckedIn, true),
        inArray(petsTable.id, bookedPetIds),
      ));

    if (!pets.length) return;

    const existingTasks = await db.select({
      petId: tasksTable.petId,
      type: tasksTable.type,
      scheduledFor: tasksTable.scheduledFor,
    }).from(tasksTable).where(and(
      gte(tasksTable.scheduledFor, startOfDay),
      lte(tasksTable.scheduledFor, endOfDay),
    ));

    const allMedications = await db.select({
      id: medicationsTable.id,
      petId: medicationsTable.petId,
      crecheId: medicationsTable.crecheId,
      name: medicationsTable.name,
      dosage: medicationsTable.dosage,
      times: medicationsTable.times,
      startDate: medicationsTable.startDate,
      endDate: medicationsTable.endDate,
    }).from(medicationsTable).where(eq(medicationsTable.isActive, true));

    const activeMeds = allMedications.filter((m) => {
      if (m.startDate > todayStr) return false;
      if (m.endDate && m.endDate < todayStr) return false;
      return true;
    });

    const medsByPet = new Map<number, typeof activeMeds>();
    for (const med of activeMeds) {
      if (!medsByPet.has(med.petId)) medsByPet.set(med.petId, []);
      medsByPet.get(med.petId)!.push(med);
    }

    const alreadyExists = (petId: number, type: string, hours: number, minutes: number) =>
      existingTasks.some((t) => {
        if (t.petId !== petId || t.type !== type) return false;
        const { h: taskH, m: taskM } = getBRTHourMinute(new Date(t.scheduledFor));
        return taskH === hours && taskM === minutes;
      });

    const newTasks: (typeof tasksTable.$inferInsert)[] = [];
    // Track tasks already queued in this batch (key = petId:type:h:m) so that
    // duplicate entries in feedingSchedule/walkSchedule don't produce duplicates.
    const batchKeys = new Set<string>();
    const inBatch = (petId: number, type: string, h: number, m: number) =>
      batchKeys.has(`${petId}:${type}:${h}:${m}`);
    const markBatch = (petId: number, type: string, h: number, m: number) =>
      batchKeys.add(`${petId}:${type}:${h}:${m}`);

    for (const pet of pets) {
      const feeding: Array<{ time: string; amount?: string; notes?: string }> =
        Array.isArray(pet.feedingSchedule) ? pet.feedingSchedule as any : [];
      for (const f of feeding) {
        if (!f.time) continue;
        const [h, m] = f.time.split(":").map(Number);
        if (isNaN(h) || isNaN(m)) continue;
        if (alreadyExists(pet.id, "feeding", h, m) || inBatch(pet.id, "feeding", h, m)) continue;
        markBatch(pet.id, "feeding", h, m);
        const desc = [f.amount, f.notes].filter(Boolean).join(" · ") || null;
        newTasks.push({ crecheId: pet.crecheId, petId: pet.id, type: "feeding", title: `Alimentação — ${pet.name}`, description: desc, scheduledFor: makeTimeOnDate(todayStr, h, m), priority: "medium" });
      }

      const walks: Array<{ time: string; durationMinutes?: number; notes?: string }> =
        Array.isArray(pet.walkSchedule) ? pet.walkSchedule as any : [];
      for (const w of walks) {
        if (!w.time) continue;
        const [h, m] = w.time.split(":").map(Number);
        if (isNaN(h) || isNaN(m)) continue;
        if (alreadyExists(pet.id, "walk", h, m) || inBatch(pet.id, "walk", h, m)) continue;
        markBatch(pet.id, "walk", h, m);
        newTasks.push({ crecheId: pet.crecheId, petId: pet.id, type: "walk", title: `Passeio — ${pet.name}`, description: w.notes || null, scheduledFor: makeTimeOnDate(todayStr, h, m), priority: "medium" });
      }

      for (const med of medsByPet.get(pet.id) ?? []) {
        const times: string[] = Array.isArray(med.times) ? med.times as string[] : [];
        for (const time of times) {
          const [h, m] = time.split(":").map(Number);
          if (isNaN(h) || isNaN(m)) continue;
          if (alreadyExists(pet.id, "medication", h, m) || inBatch(pet.id, "medication", h, m)) continue;
          markBatch(pet.id, "medication", h, m);
          newTasks.push({ crecheId: pet.crecheId, petId: pet.id, type: "medication", title: `Medicação — ${pet.name}`, description: `${med.name}${med.dosage ? ` · ${med.dosage}` : ""}`, scheduledFor: makeTimeOnDate(todayStr, h, m), priority: "high" });
        }
      }
    }

    if (newTasks.length > 0) {
      await db.insert(tasksTable).values(newTasks);
      console.log(`[scheduler] Gerou ${newTasks.length} tarefa(s) para ${todayStr}`);
    }
  } catch (err) {
    console.error("[scheduler] Erro ao gerar tarefas diárias:", err);
  }
}

export function startScheduler() {
  generateDailyTasks();

  // 03:01 UTC = 00:01 BRT (Brasilia is UTC-3, no DST since 2019).
  // Previously "1 0 * * *" fired at 21:01 BRT, creating tasks for "tomorrow"
  // from the perspective of Brazil users.
  cron.schedule("1 3 * * *", () => {
    generateDailyTasks();
  });

  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();
      const windowStart = new Date(now.getTime() + 4 * 60 * 1000);
      const windowEnd = new Date(now.getTime() + 6 * 60 * 1000);

      const upcoming = await db.select({
        id: tasksTable.id,
        title: tasksTable.title,
        type: tasksTable.type,
        scheduledFor: tasksTable.scheduledFor,
        assignedToId: tasksTable.assignedToId,
        petId: tasksTable.petId,
        petName: petsTable.name,
        assignedToName: usersTable.name,
      })
        .from(tasksTable)
        .leftJoin(petsTable, eq(tasksTable.petId, petsTable.id))
        .leftJoin(usersTable, eq(tasksTable.assignedToId, usersTable.id))
        .where(and(
          eq(tasksTable.status, "pending"),
          gte(tasksTable.scheduledFor, windowStart),
          lte(tasksTable.scheduledFor, windowEnd),
        ));

      const typeLabels: Record<string, string> = {
        feeding: "🍽️ Alimentação", medication: "💊 Medicação", grooming: "✂️ Banho/Tosa",
        walk: "🦮 Passeio", checkup: "🏥 Avaliação", other: "📋 Tarefa",
      };

      for (const task of upcoming) {
        if (notifiedTaskIds.has(task.id)) continue;
        notifiedTaskIds.add(task.id);
        if (!task.assignedToId) continue;

        const label = typeLabels[task.type] ?? "📋 Tarefa";
        const petSuffix = task.petName ? ` — ${task.petName}` : "";
        const timeStr = task.scheduledFor
          ? new Date(task.scheduledFor).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
          : "";

        await sendPushToUser(task.assignedToId, {
          title: `⏰ Em 5 minutos: ${label}${petSuffix}`,
          body: task.title || `${label} agendada para ${timeStr}.`,
          tag: `task-reminder-${task.id}`,
          data: { type: "task", taskId: task.id },
        }).catch(() => {});
      }

      if (notifiedTaskIds.size > 500) {
        const arr = Array.from(notifiedTaskIds);
        arr.slice(0, 250).forEach((id) => notifiedTaskIds.delete(id));
      }
    } catch (err) {
      console.error("[scheduler] error:", err);
    }
  });

  console.log("[scheduler] Task reminder scheduler started.");
}

async function sendMensalidadeReminders() {
  try {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 3);
    const targetDay = futureDate.getDate();

    const tutors = await db
      .select({ id: usersTable.id, name: usersTable.name, mensalidadeDia: usersTable.mensalidadeDia })
      .from(usersTable)
      .where(and(eq(usersTable.role, "tutor"), eq(usersTable.isActive, true), isNotNull(usersTable.mensalidadeDia)));

    const dueToday = tutors.filter((t) => t.mensalidadeDia === targetDay);
    if (!dueToday.length) return;

    console.log(`[scheduler] Sending mensalidade reminders to ${dueToday.length} tutor(s) (due day ${targetDay})`);

    for (const tutor of dueToday) {
      await sendPushToUser(tutor.id, {
        title: "📅 Mensalidade vencendo em breve",
        body: `Sua mensalidade vence em 3 dias (dia ${tutor.mensalidadeDia}). Entre em contato com a creche.`,
        tag: `mensalidade-${tutor.id}-${targetDay}`,
        data: { type: "mensalidade" },
      }).catch(() => {});
    }
  } catch (err) {
    console.error("[scheduler] mensalidade reminder error:", err);
  }
}

export function startMensalidadeScheduler() {
  cron.schedule("0 9 * * *", async () => {
    console.log("[scheduler] Running mensalidade check...");
    await sendMensalidadeReminders();
  });
  console.log("[scheduler] Mensalidade reminder scheduler started.");
}
