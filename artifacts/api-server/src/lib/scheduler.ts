import cron from "node-cron";
import { db } from "@workspace/db";
import { tasksTable, petsTable, usersTable, bookingsTable, subscriptionsTable } from "@workspace/db/schema";
import { medicationsTable } from "@workspace/db/schema";
import { and, eq, gte, lte, isNotNull, inArray, or, isNull } from "drizzle-orm";
import { sendPushToUser, sendPushToRole } from "./push.js";

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

export function startScheduler() {
  deduplicateTasks();
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
    // Busca todos os tutores ativos com data de vencimento configurada,
    // incluindo o crecheId para notificar o admin da creche também.
    const tutors = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        crecheId: usersTable.crecheId,
        mensalidadeDia: usersTable.mensalidadeDia,
      })
      .from(usersTable)
      .where(and(eq(usersTable.role, "tutor"), eq(usersTable.isActive, true), isNotNull(usersTable.mensalidadeDia)));

    if (!tutors.length) return;

    // Dispara lembretes em 4 momentos: 7 dias antes, 3 dias antes,
    // 1 dia antes e no próprio dia de vencimento.
    const INTERVALS_DAYS = [7, 3, 1, 0];

    for (const daysAhead of INTERVALS_DAYS) {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + daysAhead);
      const targetDay = futureDate.getDate();

      const matching = tutors.filter(
        (t) => t.mensalidadeDia === targetDay && t.crecheId != null,
      );
      if (!matching.length) continue;

      console.log(
        `[scheduler] Mensalidade: ${matching.length} tutor(s) com vencimento ` +
        `${daysAhead === 0 ? "HOJE" : `em ${daysAhead} dia(s)`} (dia ${targetDay})`,
      );

      const daysLabel =
        daysAhead === 0 ? "HOJE" :
        daysAhead === 1 ? "amanhã" :
        `em ${daysAhead} dias`;

      for (const tutor of matching) {
        // ── Notificação para o TUTOR ────────────────────────────────────
        const tutorTitle = daysAhead === 0
          ? "⚠️ Mensalidade vence hoje!"
          : "📅 Lembrete de mensalidade";
        const tutorBody = daysAhead === 0
          ? `Sua mensalidade vence HOJE (dia ${tutor.mensalidadeDia}). Entre em contato com a creche.`
          : `Sua mensalidade vence ${daysLabel} (dia ${tutor.mensalidadeDia}). Entre em contato com a creche.`;

        await sendPushToUser(tutor.id, {
          title: tutorTitle,
          body: tutorBody,
          tag: `mensalidade-tutor-${tutor.id}-d${daysAhead}`,
          data: { type: "mensalidade" },
        }).catch(() => {});

        // ── Notificação para o ADMIN da creche ──────────────────────────
        const adminTitle = daysAhead === 0
          ? "⚠️ Mensalidade vence hoje"
          : "📅 Mensalidade de tutor";
        const adminBody = daysAhead === 0
          ? `A mensalidade de ${tutor.name} vence HOJE (dia ${tutor.mensalidadeDia}).`
          : `A mensalidade de ${tutor.name} vence ${daysLabel} (dia ${tutor.mensalidadeDia}).`;

        await sendPushToRole(tutor.crecheId!, "creche_admin", {
          title: adminTitle,
          body: adminBody,
          tag: `mensalidade-creche-${tutor.id}-d${daysAhead}`,
          data: { type: "mensalidade", tutorId: tutor.id },
        }).catch(() => {});
      }
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

// ─── Scheduled plan changes ───────────────────────────────────────────────────
// Runs daily at 03:00 BRT. For every subscription whose currentPeriodEnd has
// passed and has a pending scheduledPlanId, applies the queued plan change.

async function applyScheduledPlanChanges() {
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
  cron.schedule("0 6 * * *", async () => {
    console.log("[scheduler] Verificando mudanças de plano agendadas...");
    await applyScheduledPlanChanges();
  });
  // Also apply on startup in case the server was down when a change was due.
  applyScheduledPlanChanges();
  console.log("[scheduler] Scheduled plan change applicator started.");
}

// ─── Auto-suspend past_due ────────────────────────────────────────────────────

const PAST_DUE_GRACE_DAYS = 7;

async function suspendOverduePastDueSubscriptions(): Promise<void> {
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
  // Runs daily at 07:00 BRT (after the plan-change applicator at 06:00).
  cron.schedule("0 7 * * *", async () => {
    console.log("[scheduler] Verificando assinaturas em atraso para suspensão...");
    await suspendOverduePastDueSubscriptions();
  });
  suspendOverduePastDueSubscriptions();
  console.log(`[scheduler] Past-due suspender iniciado (graça: ${PAST_DUE_GRACE_DAYS} dias).`);
}

// ─── Auto-delete old Pix receipts (90 days LGPD) ──────────────────────────────
import { ObjectStorageService } from "./objectStorage.js";
import { invoicesTable } from "@workspace/db/schema";

async function deleteOldReceipts() {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    const oldInvoices = await db
      .select({ id: invoicesTable.id, receiptPhotoPath: invoicesTable.receiptPhotoPath })
      .from(invoicesTable)
      .where(
        and(
          isNotNull(invoicesTable.receiptPhotoPath),
          lte(invoicesTable.updatedAt, cutoff)
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
  }
}

export function startReceiptCleanupJob() {
  // Runs daily at 04:00 BRT
  cron.schedule("0 4 * * *", async () => {
    console.log("[scheduler] Verificando comprovantes antigos para deleção...");
    await deleteOldReceipts();
  });
  console.log("[scheduler] Receipt cleanup job iniciado.");
}
