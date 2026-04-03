import { Router } from "express";
import { db } from "@workspace/db";
import { tasksTable, petsTable, usersTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { sendPushToUser, sendPushToRole } from "../lib/push.js";

const router = Router({ mergeParams: true });
router.use(authenticate);

router.get("/", async (req: AuthRequest, res) => {
  const crecheId = parseInt(req.params.crecheId);
  const { status, assignedTo } = req.query;
  let conditions: any[] = [eq(tasksTable.crecheId, crecheId)];
  if (status) conditions.push(eq(tasksTable.status, status as any));
  if (assignedTo) conditions.push(eq(tasksTable.assignedToId, parseInt(assignedTo as string)));

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
  const crecheId = parseInt(req.params.crecheId);
  const { petId, assignedToId, type, title, description, scheduledFor, priority } = req.body;
  const [task] = await db.insert(tasksTable).values({
    crecheId, petId, assignedToId, type, title, description,
    scheduledFor: new Date(scheduledFor), priority: priority || "medium",
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
      data: { type: "task", taskId: task.id, crecheId },
    }).catch(() => {});
  }

  res.status(201).json({ ...task, petName: null, assignedToName: null });
});

router.post("/:taskId/complete", async (req: AuthRequest, res) => {
  const crecheId = parseInt(req.params.crecheId);
  const taskId = parseInt(req.params.taskId);
  const { notes } = req.body || {};

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
      data: { type: "task", taskId: task.id, crecheId },
    }).catch(() => {});
  }

  res.json({ ...task, petName: null, assignedToName: null });
});

export default router;
