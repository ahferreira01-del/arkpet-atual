import cron, { type ScheduledTask } from "node-cron";
import { db } from "@workspace/db";
import { tasksTable, petsTable, usersTable, bookingsTable, subscriptionsTable, invoicesTable, ordersTable, financialOutboxTable } from "@workspace/db/schema";
import { OutboxRepository } from "../repositories/outbox.repository.js";
import { financialLog } from "./logger.js";
import { medicationsTable } from "@workspace/db/schema";
import { and, eq, gte, lte, isNotNull, inArray, or, isNull, sql } from "drizzle-orm";
import { sendPushToUser, sendPushToRole } from "./push.js";
import { cancelOrder } from "../services/orders.js";
import { recoverStaleGatewayEvents, recoverAndProcessStaleGatewayEvents } from "../services/gatewayEvents.js";
import { dispatchWebhookBusinessLogic } from "./webhookHandlers.js";

export const SAO_PAULO_TZ = "America/Sao_Paulo";
export const DAILY_TASK_GENERATION_LOCK_KEY = 999_100_001;

const activeCronTasks: ScheduledTask[] = [];

export function registerCronTask(task: ScheduledTask): ScheduledTask {
  activeCronTasks.push(task);
  return task;
}

export function stopAllSchedulers(): number {
  let count = 0;
  for (const task of activeCronTasks) {
    try {
      task.stop();
      count++;
    } catch (e) {
      console.error("[scheduler] Error stopping cron task:", e);
    }
  }
  activeCronTasks.length = 0;
  console.log(`[scheduler] All background schedulers stopped (${count} handles stopped).`);
  return count;
}

export function getActiveCronTaskCount(): number {
  return activeCronTasks.length;
}

let taskReminderRunning = false;

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
      description: tasksTable.description,
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
    // Track what we're already adding in this batch for feeding/walk so duplicates inside
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

    // ─── Multiplicity-aware medication scheduling ────────────────────────────
    // Count desired occurrences of each medication fingerprint (h:m:description)
    const desiredMedOccurrences = new Map<string, { h: number; m: number; title: string; desc: string; count: number }>();
    for (const med of activeMeds) {
      const desc = `${med.name}${med.dosage ? ` · ${med.dosage}` : ""}`;
      const title = `Medicação — ${pet.name}`;
      const rawTimes: string[] = Array.isArray(med.times) ? med.times as string[] : [];
      const uniqueTimes = [...new Set(rawTimes)];
      for (const time of uniqueTimes) {
        const [h, m] = time.split(":").map(Number);
        if (isNaN(h) || isNaN(m)) continue;
        const key = `${h}:${m}:${desc}`;
        const current = desiredMedOccurrences.get(key);
        if (current) {
          current.count += 1;
        } else {
          desiredMedOccurrences.set(key, { h, m, title, desc, count: 1 });
        }
      }
    }

    // Count existing medication tasks matching each fingerprint
    const existingMedCounts = new Map<string, number>();
    for (const t of existingTasks) {
      if (t.type !== "medication") continue;
      const { h, m } = getBRTHourMinute(new Date(t.scheduledFor));
      const desc = t.description || "";
      const key = `${h}:${m}:${desc}`;
      existingMedCounts.set(key, (existingMedCounts.get(key) || 0) + 1);
    }

    // Generate only the missing delta (desiredCount - existingCount)
    for (const [key, item] of desiredMedOccurrences.entries()) {
      const existingCount = existingMedCounts.get(key) || 0;
      const needed = Math.max(0, item.count - existingCount);
      for (let i = 0; i < needed; i++) {
        newTasks.push({
          crecheId,
          petId,
          type: "medication",
          title: item.title,
          description: item.desc,
          scheduledFor: makeTimeOnDate(todayStr, item.h, item.m),
          priority: "high",
        });
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

export async function generateDailyTasks() {
  try {
    await db.transaction(async (tx) => {
      // PostgreSQL advisory transaction lock to serialize daily task generation across instances
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${DAILY_TASK_GENERATION_LOCK_KEY})`);

      const todayStr = getBrazilDateStr();
      const startOfDay = new Date(`${todayStr}T00:00:00-03:00`);
      const endOfDay = new Date(`${todayStr}T23:59:59-03:00`);

      // Only generate tasks for pets that are ALREADY checked in (booking = "active").
      // Pets with "confirmed" bookings haven't arrived yet — their tasks are generated
      // on-demand via generateTasksForPetToday() when they check in.
      // This prevents tarefas from appearing for pets of the same tutor that are
      // booked but not yet at the creche.
      const bookedRows = await tx.select({ petId: bookingsTable.petId })
        .from(bookingsTable)
        .where(and(
          eq(bookingsTable.status, "active"),
          lte(bookingsTable.startDate, todayStr),
          or(isNull(bookingsTable.endDate), gte(bookingsTable.endDate, todayStr)),
        ));

      const bookedPetIds = [...new Set(bookedRows.map((r) => r.petId))];
      if (!bookedPetIds.length) return;

      // Double-check with isCheckedIn flag on the pet itself.
      const pets = await tx.select({
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

      const existingTasks = await tx.select({
        petId: tasksTable.petId,
        type: tasksTable.type,
        description: tasksTable.description,
        scheduledFor: tasksTable.scheduledFor,
      }).from(tasksTable).where(and(
        gte(tasksTable.scheduledFor, startOfDay),
        lte(tasksTable.scheduledFor, endOfDay),
      ));

      const allMedications = await tx.select({
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

      // Pre-count existing medication tasks by (petId:h:m:desc)
      const existingMedCounts = new Map<string, number>();
      for (const t of existingTasks) {
        if (t.type !== "medication" || !t.petId) continue;
        const { h, m } = getBRTHourMinute(new Date(t.scheduledFor));
        const desc = t.description || "";
        const key = `${t.petId}:${h}:${m}:${desc}`;
        existingMedCounts.set(key, (existingMedCounts.get(key) || 0) + 1);
      }

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

        // ─── Multiplicity-aware medication scheduling for bulk daily cron ───────
        const desiredMedOccurrences = new Map<string, { h: number; m: number; title: string; desc: string; count: number }>();
        for (const med of medsByPet.get(pet.id) ?? []) {
          const desc = `${med.name}${med.dosage ? ` · ${med.dosage}` : ""}`;
          const title = `Medicação — ${pet.name}`;
          const rawTimes: string[] = Array.isArray(med.times) ? med.times as string[] : [];
          const uniqueTimes = [...new Set(rawTimes)];
          for (const time of uniqueTimes) {
            const [h, m] = time.split(":").map(Number);
            if (isNaN(h) || isNaN(m)) continue;
            const key = `${pet.id}:${h}:${m}:${desc}`;
            const current = desiredMedOccurrences.get(key);
            if (current) {
              current.count += 1;
            } else {
              desiredMedOccurrences.set(key, { h, m, title, desc, count: 1 });
            }
          }
        }

        for (const [key, item] of desiredMedOccurrences.entries()) {
          const existingCount = existingMedCounts.get(key) || 0;
          const needed = Math.max(0, item.count - existingCount);
          for (let i = 0; i < needed; i++) {
            newTasks.push({
              crecheId: pet.crecheId,
              petId: pet.id,
              type: "medication",
              title: item.title,
              description: item.desc,
              scheduledFor: makeTimeOnDate(todayStr, item.h, item.m),
              priority: "high",
            });
          }
        }
      }

      if (newTasks.length > 0) {
        await tx.insert(tasksTable).values(newTasks);
        console.log(`[scheduler] Gerou ${newTasks.length} tarefa(s) para ${todayStr}`);
      }
    });
  } catch (err) {
    console.error("[scheduler] Erro ao gerar tarefas diárias:", err);
  }
}

/**
 * Remove tarefas duplicadas do banco — mantém apenas a de menor ID
 * para cada combinação (pet_id, type, scheduled_for).
 * Executado uma vez no startup; inofensivo se não há duplicatas.
 */
async function deduplicateTasks() {
  try {
    const result = await db.execute(`
      DELETE FROM tasks
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM tasks
        GROUP BY pet_id, type, scheduled_for
      )
    `);
    const count = (result as any).rowCount ?? 0;
    if (count > 0) {
      console.log(`[scheduler] Limpeza: ${count} tarefa(s) duplicada(s) removida(s).`);
    }
  } catch (err) {
    console.error("[scheduler] Erro ao deduplicar tarefas:", err);
  }
}

export async function runTaskReminderTick() {
  if (taskReminderRunning) return;
  taskReminderRunning = true;
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
        isNull(tasksTable.reminderSentAt),
        gte(tasksTable.scheduledFor, windowStart),
        lte(tasksTable.scheduledFor, windowEnd),
      ));

    const typeLabels: Record<string, string> = {
      feeding: "🍽️ Alimentação", medication: "💊 Medicação", grooming: "✂️ Banho/Tosa",
      walk: "🦮 Passeio", checkup: "🏥 Avaliação", other: "📋 Tarefa",
    };

    for (const task of upcoming) {
      if (!task.assignedToId) continue;

      // PostgreSQL row-level lock serialization + durable reminder_sent_at marking
      await db.transaction(async (tx) => {
        const [lockedTask] = await tx
          .select({ id: tasksTable.id, reminderSentAt: tasksTable.reminderSentAt })
          .from(tasksTable)
          .where(and(eq(tasksTable.id, task.id), isNull(tasksTable.reminderSentAt)))
          .for("update");

        if (!lockedTask || lockedTask.reminderSentAt !== null) {
          return; // Already processed by another concurrent instance
        }

        const label = typeLabels[task.type] ?? "📋 Tarefa";
        const petSuffix = task.petName ? ` — ${task.petName}` : "";
        const timeStr = task.scheduledFor
          ? new Date(task.scheduledFor).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
          : "";

        try {
          await sendPushToUser(task.assignedToId!, {
            title: `⏰ Em 5 minutos: ${label}${petSuffix}`,
            body: task.title || `${label} agendada para ${timeStr}.`,
            tag: `task-reminder-${task.id}`,
            data: { type: "task", taskId: task.id },
          });

          // Mark reminder as sent in the database
          await tx
            .update(tasksTable)
            .set({ reminderSentAt: new Date() })
            .where(eq(tasksTable.id, task.id));
        } catch (pushErr) {
          // If sending push throws, transaction rolls back: reminderSentAt remains NULL,
          // allowing future retries if the task remains in the window.
          console.error(`[scheduler] Erro ao enviar push para task ${task.id}:`, pushErr);
          throw pushErr;
        }
      }).catch(() => {
        // Handled: push error causes rollback, task remains available for retry
      });
    }
  } catch (err) {
    console.error("[scheduler] task reminder error:", err);
  } finally {
    taskReminderRunning = false;
  }
}

export function startScheduler() {
  deduplicateTasks();
  generateDailyTasks();

  // 00:01 America/Sao_Paulo (preserves 03:01 UTC)
  registerCronTask(
    cron.schedule("1 0 * * *", () => {
      generateDailyTasks();
    }, { timezone: SAO_PAULO_TZ })
  );

  registerCronTask(
    cron.schedule("* * * * *", () => {
      runTaskReminderTick();
    }, { timezone: SAO_PAULO_TZ })
  );

  console.log("[scheduler] Task reminder scheduler started.");
}

export async function sendInvoiceReminders() {
  try {
    const pendingInvoices = await db
      .select({
        invoiceId: invoicesTable.id,
        dueDate: invoicesTable.dueDate,
        amount: invoicesTable.amount,
        status: invoicesTable.status,
        tutorId: usersTable.id,
        tutorName: usersTable.name,
        crecheId: usersTable.crecheId,
      })
      .from(invoicesTable)
      .innerJoin(usersTable, eq(invoicesTable.tutorId, usersTable.id))
      .where(
        and(
          eq(usersTable.role, "tutor"),
          eq(usersTable.isActive, true),
          or(eq(invoicesTable.status, "pending"), eq(invoicesTable.status, "overdue"))
        )
      );

    if (!pendingInvoices.length) return;

    for (const invoice of pendingInvoices) {
      if (!invoice.dueDate || !invoice.crecheId) continue;

      const dueDateObj = new Date(`${invoice.dueDate}T00:00:00`);
      const todayDateObj = new Date(`${getBrazilDateStr()}T00:00:00`);
      const diffTime = dueDateObj.getTime() - todayDateObj.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

      let notifyType: "5_days" | "3_days" | "today" | "overdue" | null = null;
      if (invoice.status === "pending") {
        if (diffDays <= 5 && diffDays > 3) notifyType = "5_days";
        else if (diffDays <= 3 && diffDays > 0) notifyType = "3_days";
        else if (diffDays === 0) notifyType = "today";
      } else if (invoice.status === "overdue") {
        if (diffDays < 0) notifyType = "overdue";
      }

      if (!notifyType) continue;

      await db.transaction(async (tx) => {
        // Lock consultivo para serializar concorrência (invoiceId)
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${invoice.invoiceId})`);

        // Re-verificar status da fatura (pode ter sido paga no meio tempo)
        const [currentInvoice] = await tx.select({ status: invoicesTable.status })
          .from(invoicesTable)
          .where(eq(invoicesTable.id, invoice.invoiceId));
        
        if (!currentInvoice || !["pending", "overdue"].includes(currentInvoice.status)) {
          return;
        }

        // Idempotência protegida por lock
        const [alreadySent] = await tx.select({ id: financialOutboxTable.id })
          .from(financialOutboxTable)
          .where(
            sql`event_type = 'invoice_reminder' AND payload->>'invoiceId' = ${invoice.invoiceId.toString()} AND payload->>'type' = ${notifyType}`
          );

        if (alreadySent) return;

        // Marca como intenção de envio
        await tx.insert(financialOutboxTable).values({
          eventType: 'invoice_reminder',
          payload: { invoiceId: invoice.invoiceId, type: notifyType },
          status: 'processed'
        });

      const [y, m, d] = invoice.dueDate.split("-");
      const dueDateStr = `${d}/${m}/${y}`;

      let tutorTitle = "📅 Lembrete de Fatura";
      let tutorBody = "";

      const fmtAmt = (Number(invoice.amount) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      if (notifyType === "5_days") {
        tutorBody = `Sua fatura de ${fmtAmt} vence em 5 dias (${dueDateStr}).`;
      } else if (notifyType === "3_days") {
        tutorBody = `Sua fatura de ${fmtAmt} vence em 3 dias (${dueDateStr}).`;
      } else if (notifyType === "today") {
        tutorTitle = "⚠️ Fatura Vence HOJE";
        tutorBody = `Sua fatura de ${fmtAmt} vence HOJE. Pague para evitar bloqueios.`;
      } else if (notifyType === "overdue") {
        tutorTitle = "🚨 Fatura Atrasada";
        tutorBody = `Sua fatura de ${fmtAmt} está atrasada. Novos agendamentos estão bloqueados até a regularização.`;
      }

      await sendPushToUser(invoice.tutorId, {
        title: tutorTitle,
        body: tutorBody,
        tag: `invoice-tutor-${invoice.invoiceId}-${notifyType}`,
        data: { type: "invoice", invoiceId: invoice.invoiceId },
      }).catch(() => {});

      let adminTitle = "📅 Fatura de Tutor";
      let adminBody = `A fatura de ${invoice.tutorName} no valor de ${fmtAmt} vence em ${diffDays} dia(s).`;

      if (notifyType === "today") {
        adminTitle = "⚠️ Fatura Vence Hoje";
        adminBody = `A fatura de ${invoice.tutorName} (${fmtAmt}) vence HOJE.`;
      } else if (notifyType === "overdue") {
        adminTitle = "🚨 Fatura Atrasada";
        adminBody = `A fatura de ${invoice.tutorName} (${fmtAmt}) está atrasada e o tutor foi bloqueado para novos agendamentos.`;
      }

      await sendPushToRole(invoice.crecheId!, "creche_admin", {
        title: adminTitle,
        body: adminBody,
        tag: `invoice-creche-${invoice.invoiceId}-${notifyType}`,
        data: { type: "invoice", tutorId: invoice.tutorId },
      }).catch(() => {});
      });
    }
  } catch (err) {
    financialLog({ operation: "invoice_reminder", level: "error", error: err instanceof Error ? err.message : String(err) });
  }
}

export function startMensalidadeScheduler() {
  registerCronTask(
    cron.schedule("0 6 * * *", async () => {
      financialLog({ operation: "invoice_reminder_start", result: "running" });
      await sendInvoiceReminders();
    }, { timezone: SAO_PAULO_TZ })
  );
  console.log("[scheduler] Invoice reminder scheduler started.");
}

// ─── Scheduled plan changes ───────────────────────────────────────────────────
// Runs daily at 03:00 BRT. For every subscription whose currentPeriodEnd has
// passed and has a pending scheduledPlanId, applies the queued plan change.

export async function applyScheduledPlanChanges() {
  try {
    const now = new Date();
    const pending = await db
      .select({
        id: subscriptionsTable.id,
        crecheId: subscriptionsTable.crecheId,
        scheduledPlanId: subscriptionsTable.scheduledPlanId,
        scheduledBillingInterval: subscriptionsTable.scheduledBillingInterval,
        scheduledPeriodEnd: subscriptionsTable.scheduledPeriodEnd,
      })
      .from(subscriptionsTable)
      .where(
        and(
          isNotNull(subscriptionsTable.scheduledPlanId),
          lte(subscriptionsTable.currentPeriodEnd, now),
        ),
      );

    if (!pending.length) return;
    console.log(`[scheduler] Aplicando ${pending.length} mudança(s) de plano agendada(s)...`);

    for (const sub of pending) {
      await db
        .update(subscriptionsTable)
        .set({
          planId: sub.scheduledPlanId!,
          billingInterval: sub.scheduledBillingInterval,
          currentPeriodEnd: sub.scheduledPeriodEnd,
          scheduledPlanId: null,
          scheduledBillingInterval: null,
          scheduledPeriodEnd: null,
          status: "active",
          pastDueSince: null,
        })
        .where(eq(subscriptionsTable.id, sub.id));

      console.log(`[scheduler] Plano aplicado para crecheId=${sub.crecheId}: planId=${sub.scheduledPlanId}`);
    }
  } catch (err) {
    console.error("[scheduler] erro ao aplicar planos agendados:", err);
  }
}

export function startScheduledPlanChangeApplicator() {
  registerCronTask(
    cron.schedule("0 3 * * *", async () => {
      console.log("[scheduler] Verificando mudanças de plano agendadas...");
      await applyScheduledPlanChanges();
    }, { timezone: SAO_PAULO_TZ })
  );
  // Also apply on startup in case the server was down when a change was due.
  applyScheduledPlanChanges();
  console.log("[scheduler] Scheduled plan change applicator started.");
}

// ─── Auto-suspend past_due ────────────────────────────────────────────────────

const PAST_DUE_GRACE_DAYS = 7;

export async function suspendOverduePastDueSubscriptions(): Promise<void> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - PAST_DUE_GRACE_DAYS);

    const overdue = await db
      .select({ id: subscriptionsTable.id, crecheId: subscriptionsTable.crecheId })
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.status, "past_due"),
          isNotNull(subscriptionsTable.pastDueSince),
          lte(subscriptionsTable.pastDueSince, cutoff),
        ),
      );

    if (!overdue.length) return;
    console.log(`[scheduler] Suspendendo ${overdue.length} assinatura(s) com mais de ${PAST_DUE_GRACE_DAYS} dias em atraso...`);

    for (const sub of overdue) {
      await db
        .update(subscriptionsTable)
        .set({ status: "suspended" })
        .where(eq(subscriptionsTable.id, sub.id));
      console.log(`[scheduler] Assinatura suspensa: crecheId=${sub.crecheId}`);
    }
  } catch (err) {
    console.error("[scheduler] erro ao suspender assinaturas em atraso:", err);
  }
}

export function startPastDueSuspender() {
  // Runs daily at 04:00 BRT (previously 07:00 UTC)
  registerCronTask(
    cron.schedule("0 4 * * *", async () => {
      console.log("[scheduler] Verificando assinaturas em atraso para suspensão...");
      await suspendOverduePastDueSubscriptions();
    }, { timezone: SAO_PAULO_TZ })
  );
  suspendOverduePastDueSubscriptions();
  console.log(`[scheduler] Past-due suspender iniciado (graça: ${PAST_DUE_GRACE_DAYS} dias).`);
}

// ─── Auto-suspend expired trials ─────────────────────────────────────────────
// Complements the real-time check in requireActiveSubscription: ensures the DB
// status stays accurate so reports, dashboards and Stripe sync reflect reality.

export async function suspendExpiredTrials(): Promise<void> {
  try {
    const now = new Date();
    const expired = await db
      .select({ id: subscriptionsTable.id, crecheId: subscriptionsTable.crecheId })
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.status, "trial"),
          isNotNull(subscriptionsTable.trialEndsAt),
          lte(subscriptionsTable.trialEndsAt, now),
        ),
      );

    if (!expired.length) return;

    for (const sub of expired) {
      await db
        .update(subscriptionsTable)
        .set({ status: "suspended" })
        .where(eq(subscriptionsTable.id, sub.id));
      console.log(`[scheduler] Trial expirado suspenso: crecheId=${sub.crecheId}`);
    }
    console.log(`[scheduler] ${expired.length} trial(s) expirado(s) convertido(s) para suspended.`);
  } catch (err) {
    console.error("[scheduler] Erro ao suspender trials expirados:", err);
  }
}

export function startTrialExpirationJob() {
  // Runs every hour on the hour, and immediately on startup.
  registerCronTask(
    cron.schedule("0 * * * *", async () => {
      await suspendExpiredTrials();
    }, { timezone: SAO_PAULO_TZ })
  );
  suspendExpiredTrials();
  console.log("[scheduler] Trial expiration job started.");
}

// ─── Auto-delete old Pix receipts (90 days LGPD) ──────────────────────────────
import { ObjectStorageService } from "./objectStorage.js";
// invoicesTable já importado no topo do arquivo — não re-importar aqui

// Fase 14: flag de concorrência para evitar execução paralela
let receiptCleanupRunning = false;

export async function deleteOldReceipts() {
  if (receiptCleanupRunning) {
    console.warn("[scheduler] deleteOldReceipts: execução anterior ainda em andamento, ignorando.");
    return;
  }
  receiptCleanupRunning = true;
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    // Fase 14 (F-11): excluir comprovantes apenas de invoices NÃO pagas
    // (comprovantes de invoices pagas têm valor probatório — não deletar)
    const oldInvoices = await db
      .select({ id: invoicesTable.id, receiptPhotoPath: invoicesTable.receiptPhotoPath })
      .from(invoicesTable)
      .where(
        and(
          isNotNull(invoicesTable.receiptPhotoPath),
          lte(invoicesTable.updatedAt, cutoff),
          // Preservar comprovantes de invoices pagas — apenas limpar as não pagas
          or(
            eq(invoicesTable.status, "voided"),
            eq(invoicesTable.status, "refunded"),
            eq(invoicesTable.status, "overdue")
          )
        )
      );

    if (!oldInvoices.length) return;

    const objectStorageService = new ObjectStorageService();
    console.log(`[scheduler] Excluindo ${oldInvoices.length} comprovantes antigos (>90 dias)...`);

    for (const inv of oldInvoices) {
      if (inv.receiptPhotoPath) {
        try {
          const objectFile = await objectStorageService.getObjectEntityFile(inv.receiptPhotoPath);
          await objectStorageService.deleteObject(objectFile);
        } catch (e) {
          console.warn(`[scheduler] Falha ao deletar arquivo ${inv.receiptPhotoPath}`, e);
        }
      }
      await db.update(invoicesTable).set({ receiptPhotoPath: null }).where(eq(invoicesTable.id, inv.id));
    }
  } catch (err) {
    console.error("[scheduler] erro ao limpar comprovantes antigos:", err);
  } finally {
    receiptCleanupRunning = false;
  }
}

export function startReceiptCleanupJob() {
  // Runs daily at 01:00 BRT (previously 04:00 UTC)
  registerCronTask(
    cron.schedule("0 1 * * *", async () => {
      console.log("[scheduler] Verificando comprovantes antigos para deleção...");
      await deleteOldReceipts();
    }, { timezone: SAO_PAULO_TZ })
  );
  console.log("[scheduler] Receipt cleanup job iniciado.");
}

// ─── Phase 12: Auto-cancel expired unpaid orders ──────────────────────────────
// Orders that stay in "pending_payment" for more than EXPIRED_ORDER_DAYS days
// are automatically cancelled, and their reserved stock is released.

const EXPIRED_ORDER_DAYS = 7;

// Fase 14: flag de concorrência para cancelamento de pedidos
let expiredOrderCancellerRunning = false;

export async function cancelExpiredOrders(): Promise<void> {
  if (expiredOrderCancellerRunning) {
    financialLog({ operation: "expired_order_canceller", result: "skipped_already_running" });
    return;
  }
  expiredOrderCancellerRunning = true;
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - EXPIRED_ORDER_DAYS);

    // Fetch full order rows so cancelOrder() can restore stock, void invoices,
    // and emit the OrderCancelled outbox event atomically.
    const expired = await db
      .select()
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.status, "pending_payment"),
          lte(ordersTable.createdAt, cutoff),
        ),
      );

    if (!expired.length) return;
    financialLog({ operation: "expired_order_canceller", result: `cancelling ${expired.length}` });

    for (const order of expired) {
      try {
        // Route through cancelOrder() so stock is restored, the invoice is
        // voided, and OrderCancelled/InvoiceVoided outbox events are all
        // committed in the same transaction. userId=null = system actor.
        await cancelOrder({ order, crecheId: order.crecheId, userId: null });
        financialLog({ operation: "expired_order_cancelled", orderId: order.id, crecheId: order.crecheId });
      } catch (err) {
        financialLog({
          operation: "expired_order_cancel_failed",
          level: "error",
          orderId: order.id,
          crecheId: order.crecheId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    financialLog({ operation: "expired_order_canceller", level: "error", error: err instanceof Error ? err.message : String(err) });
  } finally {
    expiredOrderCancellerRunning = false;
  }
}

export function startExpiredOrderCanceller() {
  // Runs daily at 02:00 BRT (previously 05:00 UTC)
  registerCronTask(
    cron.schedule("0 2 * * *", async () => {
      console.log("[scheduler] Verificando pedidos expirados...");
      await cancelExpiredOrders();
    }, { timezone: SAO_PAULO_TZ })
  );
  // Also run on startup to catch any orders that expired while server was down
  cancelExpiredOrders();
  console.log(`[scheduler] Expired-order canceller iniciado (graça: ${EXPIRED_ORDER_DAYS} dias).`);
}

// ─── Financial Outbox Worker (Phase 15B) ─────────────────────────────────────
// Runs every minute; fetches up to 50 pending outbox events, processes them
// (no-op stub that writes structured JSON), marks them processed/failed.

let outboxWorkerRunning = false;

/** Events that fail MAX_OUTBOX_RETRIES times are moved to dead-letter (`failed`). */
const MAX_OUTBOX_RETRIES = 3;

/**
 * Processes one pending outbox event in its own transaction.
 * Per-event isolation means a DB failure on one event cannot roll back
 * another event's status update. SKIP LOCKED prevents two concurrent
 * worker ticks from picking up the same event.
 * Returns true when an event was found and processed (or failed), false
 * when there are no more pending events.
 */
async function processOneOutboxEvent(): Promise<boolean> {
  let hadEvent = false;
  await db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(financialOutboxTable)
      .where(eq(financialOutboxTable.status, "pending"))
      .orderBy(financialOutboxTable.id)
      .limit(1)
      .for("update", { skipLocked: true });

    if (!event) return;
    hadEvent = true;

    try {
      // Stub: log the event; no external consumer yet (Phase 15B)
      financialLog({
        operation: "outbox_process",
        eventId: event.id,
        eventType: event.eventType,
        result: "ok",
      });
      await tx
        .update(financialOutboxTable)
        .set({ status: "processed", processedAt: new Date() })
        .where(eq(financialOutboxTable.id, event.id));
    } catch (err: any) {
      // Increment retry count. If this update also fails (DB down),
      // the transaction rolls back and the event stays pending — it
      // will be retried on the next worker tick.
      const newRetryCount = event.retryCount + 1;
      const dead = newRetryCount >= MAX_OUTBOX_RETRIES;
      await tx
        .update(financialOutboxTable)
        .set({ status: dead ? "failed" : "pending", retryCount: newRetryCount })
        .where(eq(financialOutboxTable.id, event.id));
      financialLog({
        operation: dead ? "outbox_dead_letter" : "outbox_retry",
        level: "warn",
        eventId: event.id,
        eventType: event.eventType,
        retryCount: newRetryCount,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
  return hadEvent;
}

export async function processOutbox(): Promise<void> {
  if (outboxWorkerRunning) return;
  outboxWorkerRunning = true;
  try {
    // Process up to 50 events, one per transaction, so failures are isolated.
    for (let i = 0; i < 50; i++) {
      const hadEvent = await processOneOutboxEvent();
      if (!hadEvent) break;
    }
  } catch (err) {
    financialLog({ operation: "outbox_worker", level: "error", error: err instanceof Error ? err.message : String(err) });
  } finally {
    outboxWorkerRunning = false;
  }
}

export function startOutboxWorker(): void {
  registerCronTask(
    cron.schedule("* * * * *", processOutbox, { timezone: SAO_PAULO_TZ })
  );
  console.log("[scheduler] Outbox worker started.");
}

let gatewayRecoveryRunning = false;

export async function processGatewayEventRecovery(): Promise<void> {
  if (gatewayRecoveryRunning) return;
  gatewayRecoveryRunning = true;
  try {
    const result = await recoverAndProcessStaleGatewayEvents(dispatchWebhookBusinessLogic, "stripe");
    if (result.recoveredCount > 0) {
      console.log(
        `[scheduler] Gateway event recovery: ${result.recoveredCount} event(s) claimed, ${result.successCount} succeeded, ${result.failedCount} failed.`,
      );
    }
  } catch (err) {
    console.error("[scheduler] Error during gateway event recovery:", err);
  } finally {
    gatewayRecoveryRunning = false;
  }
}

export function startGatewayEventRecoveryWorker(): void {
  registerCronTask(
    cron.schedule("*/5 * * * *", processGatewayEventRecovery, { timezone: SAO_PAULO_TZ })
  );
  console.log("[scheduler] Gateway event recovery worker started (every 5 minutes).");
}
