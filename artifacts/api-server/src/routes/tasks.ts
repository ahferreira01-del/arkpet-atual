import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { tasksTable, petsTable, usersTable } from "@workspace/db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { requireCrecheMembership } from "../middlewares/requireCrecheMembership.js";
import { sendPushToUser, sendPushToRole } from "../lib/push.js";

const completeTaskSchema = z.object({
  notes: z.string().optional().nullable(),
});

const createTaskSchema = z.object({
  type: z.enum(["feeding", "medication", "grooming", "walk", "play", "health_check", "other"]),
  title: z.string().min(1, "title é obrigatório"),
  scheduledFor: z.coerce.date({ errorMap: () => ({ message: "scheduledFor deve ser uma data válida" }) }),
  petId: z.number().int().positive().optional().nullable(),
  assignedToId: z.number().int().positive().optional().nullable(),
  description: z.string().optional().nullable(),
  priority: z.enum(["low", "medium", "high"]).optional(),
});

/** Today's date string and day boundaries in Brasilia time (UTC-3). */
function brazilToday() {
  const dateStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return {
    dateStr,
    startOfDay: new Date(`${dateStr}T00:00:00-03:00`),
    endOfDay: new Date(`${dateStr}T23:59:59-03:00`),
  };
}

const router = Router({ mergeParams: true });
router.use(authenticate);
router.use(requireCrecheMembership);

router.get("/", async (req: AuthRequest, res) => {
  // Tutors do not have access to the internal task list
  if (req.user?.role === "tutor") { res.json([]); return; }
  const crecheId = parseInt(String(req.params.crecheId));
  const { status, assignedTo, date } = req.query;
  let conditions: any[] = [eq(tasksTable.crecheId, crecheId)];
  if (status) conditions.push(eq(tasksTable.status, status as any));
  if (assignedTo) conditions.push(eq(tasksTable.assignedToId, parseInt(assignedTo as string)));
  if (date) {
    const startOfDay = new Date((date as string) + "T00:00:00");
    const endOfDay = new Date((date as string) + "T23:59:59");
    conditions.push(gte(tasksTable.scheduledFor, startOfDay));
    conditions.push(lte(tasksTable.scheduledFor, endOfDay));
  }

  const tasks = await db.select({
    id: tasksTable.id,
    crecheId: tasksTable.crecheId,
    petId: tasksTable.petId,
    petName: petsTable.name,
    petIsCheckedIn: petsTable.isCheckedIn,
    assignedToId: tasksTable.assignedToId,
    assignedToName: usersTable.name,
    type: tasksTable.type,
    title: tasksTable.title,
    description: tasksTable.description,
    scheduledFor: tasksTable.scheduledFor,
    completedAt: tasksTable.completedAt,
    completedBy: tasksTable.completedBy,
    status: tasksTable.status,
    notes: tasksTable.notes,
    priority: tasksTable.priority,
    createdAt: tasksTable.createdAt,
  })
    .from(tasksTable)
    .leftJoin(petsTable, eq(tasksTable.petId, petsTable.id))
    .leftJoin(usersTable, eq(tasksTable.assignedToId, usersTable.id))
    .where(and(...conditions))
    .orderBy(tasksTable.scheduledFor);
  res.json(tasks);
});

router.post("/", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten().fieldErrors });
    return;
  }
  const { petId, assignedToId, type, title, description, scheduledFor, priority } = parsed.data;
  const [task] = await db.insert(tasksTable).values({
    crecheId, petId, assignedToId, type, title, description,
    scheduledFor, priority: priority || "medium",
  }).returning();

  // Notify assigned staff member
  if (assignedToId && assignedToId !== req.user?.id) {
    const typeLabels: Record<string, string> = {
      feeding: "Alimentação",
      medication: "Medicação",
      grooming: "Banho/Tosa",
      walk: "Passeio",
      checkup: "Avaliação",
      other: "Tarefa",
    };
    const label = typeLabels[type] ?? "Tarefa";
    sendPushToUser(assignedToId, {
      title: `📋 Nova tarefa: ${label}`,
      body: title || `Você recebeu uma nova tarefa de ${label}.`,
      tag: `task-assigned-${task.id}`,
      data: { type: "task", taskId: task.id, petId: task.petId ?? undefined, crecheId },
    }).catch(() => {});
  }

  res.status(201).json({ ...task, petName: null, assignedToName: null });
});

// Batch-complete all pending tasks for a specific pet on today's date only.
// We intentionally scope to today so that tasks pre-generated for future days
// (e.g. a multi-day stay) are NOT marked done when the pet checks out today.
router.post("/complete-by-pet/:petId", async (req: AuthRequest, res) => {
  // No body fields used; validate that nothing unexpected causes issues
  z.object({}).passthrough().safeParse(req.body ?? {});
  const crecheId = parseInt(String(req.params.crecheId));
  const petId = parseInt(String(req.params.petId));
  const { startOfDay, endOfDay } = brazilToday();

  const updated = await db.update(tasksTable).set({
    status: "completed",
    completedAt: new Date(),
    completedBy: req.user?.name,
    notes: "Concluído automaticamente no check-out.",
  }).where(
    and(
      eq(tasksTable.crecheId, crecheId),
      eq(tasksTable.petId, petId),
      eq(tasksTable.status, "pending"),
      gte(tasksTable.scheduledFor, startOfDay),
      lte(tasksTable.scheduledFor, endOfDay),
    )
  ).returning({ id: tasksTable.id });

  res.json({ completed: updated.length });
});

router.post("/:taskId/complete", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const taskId = parseInt(String(req.params.taskId));
  const parsedComplete = completeTaskSchema.safeParse(req.body ?? {});
  if (!parsedComplete.success) {
    res.status(400).json({ error: "Dados inválidos", details: parsedComplete.error.flatten().fieldErrors });
    return;
  }
  const { notes } = parsedComplete.data;

  const [before] = await db.select({
    title: tasksTable.title,
    type: tasksTable.type,
    petId: tasksTable.petId,
    assignedToId: tasksTable.assignedToId,
    assignedToName: usersTable.name,
  }).from(tasksTable)
    .leftJoin(usersTable, eq(tasksTable.assignedToId, usersTable.id))
    .where(and(eq(tasksTable.id, taskId), eq(tasksTable.crecheId, crecheId)))
    .limit(1);

  const [task] = await db.update(tasksTable).set({
    status: "completed",
    completedAt: new Date(),
    completedBy: req.user?.name,
    notes,
  }).where(and(eq(tasksTable.id, taskId), eq(tasksTable.crecheId, crecheId))).returning();

  // Notify creche admins that task was completed
  if (before) {
    const typeLabels: Record<string, string> = {
      feeding: "Alimentação", medication: "Medicação", grooming: "Banho/Tosa",
      walk: "Passeio", checkup: "Avaliação", other: "Tarefa",
    };
    const label = typeLabels[before.type] ?? "Tarefa";
    let petName = "";
    if (before.petId) {
      const [pet] = await db.select({ name: petsTable.name }).from(petsTable).where(eq(petsTable.id, before.petId)).limit(1);
      petName = pet?.name ? ` (${pet.name})` : "";
    }
    sendPushToRole(crecheId, "creche_admin", {
      title: `✅ Tarefa concluída: ${label}${petName}`,
      body: `${before.assignedToName ?? "Staff"} concluiu "${before.title ?? label}".`,
      tag: `task-done-${task.id}`,
      data: { type: "task", taskId: task.id, petId: before.petId ?? undefined, crecheId },
    }).catch(() => {});
  }

  res.json({ ...task, petName: null, assignedToName: null });
});

export default router;
