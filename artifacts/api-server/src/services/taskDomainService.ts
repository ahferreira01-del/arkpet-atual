import { db } from "@workspace/db";
import { tasksTable, petsTable, usersTable, medicationsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { sendPushToRole } from "../lib/push.js";
import {
  acquireTenantOperationalLock,
  TenantArchivedError,
} from "./tenantLifecycleLock.js";

function clientError(message: string, status = 400, code?: string): Error & { status: number; statusCode: number; code?: string } {
  const err = new Error(message) as Error & { status: number; statusCode: number; code?: string };
  err.status = status;
  err.statusCode = status;
  if (code) err.code = code;
  return err;
}

export interface ValidateTaskCompletionParams {
  taskId: number;
  crecheId: number;
  expectedType?: string;
  tx?: any;
}

export interface PreviewTaskCompletionParams {
  taskId: number;
  crecheId: number;
  expectedType?: string;
  notes?: string;
  tx?: any;
}

export interface CompleteTaskParams {
  taskId: number;
  crecheId: number;
  actorUserId: number;
  actorName?: string;
  notes?: string;
  tx?: any;
}

export interface RecordMedicationParams {
  taskId: number;
  crecheId: number;
  actorUserId: number;
  actorName?: string;
  medicationId?: number;
  petId?: number;
  notes?: string;
  tx?: any;
}

export class TaskDomainService {
  /**
   * Pure Canonical Task Completion Validation.
   * Single source of truth for task existence, creche isolation, matching type, and pending status.
   * Reused by previewTaskCompletion and safe action orchestration.
   */
  public static async validateTaskCompletion(params: ValidateTaskCompletionParams) {
    const { taskId, crecheId, expectedType, tx } = params;
    const dbHandle = tx || db;

    const conditions: any[] = [
      eq(tasksTable.id, taskId),
      eq(tasksTable.crecheId, crecheId),
    ];
    if (expectedType) {
      conditions.push(eq(tasksTable.type, expectedType as any));
    }

    const [task] = await dbHandle
      .select()
      .from(tasksTable)
      .where(and(...conditions))
      .limit(1);

    if (!task) {
      throw clientError(
        expectedType ? `Tarefa de ${expectedType} não encontrada.` : "Tarefa não encontrada",
        404,
        "target_not_found"
      );
    }

    if (task.status !== "pending") {
      throw clientError(
        `Esta tarefa${expectedType ? " de " + expectedType : ""} já foi concluída.`,
        409,
        "invalid_domain_state"
      );
    }

    return { task };
  }

  /**
   * Pure Canonical Task Completion Preview.
   * Performs zero mutation and delegates 100% of business eligibility to validateTaskCompletion.
   */
  public static async previewTaskCompletion(params: PreviewTaskCompletionParams) {
    const { task } = await this.validateTaskCompletion(params);
    const dbHandle = params.tx || db;

    const [pet] = task.petId
      ? await dbHandle.select({ name: petsTable.name }).from(petsTable).where(eq(petsTable.id, task.petId)).limit(1)
      : [null];
    const petName = pet?.name || "Pet";

    const typeLabels: Record<string, string> = {
      operational: "tarefa operacional",
      feeding: "alimentação",
      medication: "medicação",
      walk: "passeio",
      grooming: "banho/tosa",
      checkup: "avaliação",
      other: "tarefa",
    };
    const label = typeLabels[task.type] ?? task.type;

    return {
      targetId: task.id,
      previewData: {
        taskId: task.id,
        petId: task.petId,
        petName,
        title: task.title,
        scheduledFor: task.scheduledFor,
        description: task.description,
        notes: params.notes || null,
      },
      summary:
        task.type === "operational"
          ? `Concluir tarefa operacional: ${task.title}`
          : `Concluir ${label}: ${task.title} para ${petName}`,
    };
  }

  /**
   * Canonical Task Completion Logic.
   * Shared between REST endpoints (POST /tasks/:taskId/complete) and Assistant Safe Actions.
   * Preserves tenant operational lock, idempotent replay, and non-duplicated notifications.
   */
  public static async completeTask(params: CompleteTaskParams) {
    const { taskId, crecheId, actorName, notes } = params;

    const runInTx = async (tx: any) => {
      // 1. Acquire tenant operational lock (SAFE_ACTION_TENANT_OPERATIONAL_LOCK_PARITY = PASS)
      await acquireTenantOperationalLock(crecheId, tx);

      // 2. Atomic CAS transition: pending -> completed
      const [task] = await tx
        .update(tasksTable)
        .set({
          status: "completed",
          completedAt: new Date(),
          completedBy: actorName || "Staff",
          notes,
        })
        .where(
          and(
            eq(tasksTable.id, taskId),
            eq(tasksTable.crecheId, crecheId),
            eq(tasksTable.status, "pending")
          )
        )
        .returning();

      if (task) {
        // First completion: collect details for notification
        const [details] = await tx
          .select({
            title: tasksTable.title,
            type: tasksTable.type,
            petId: tasksTable.petId,
            assignedToId: tasksTable.assignedToId,
            assignedToName: usersTable.name,
            petName: petsTable.name,
          })
          .from(tasksTable)
          .leftJoin(usersTable, and(eq(tasksTable.assignedToId, usersTable.id), eq(usersTable.crecheId, crecheId)))
          .leftJoin(petsTable, and(eq(tasksTable.petId, petsTable.id), eq(petsTable.crecheId, crecheId)))
          .where(and(eq(tasksTable.id, taskId), eq(tasksTable.crecheId, crecheId)))
          .limit(1);

        return { task, details, isNewCompletion: true };
      }

      // 3. If no row was updated, check if the task already exists (Idempotent Replay)
      const [existing] = await tx
        .select()
        .from(tasksTable)
        .where(and(eq(tasksTable.id, taskId), eq(tasksTable.crecheId, crecheId)))
        .limit(1);

      if (!existing) {
        throw clientError("Tarefa não encontrada", 404, "target_not_found");
      }

      return { task: existing, details: null, isNewCompletion: false };
    };

    const result = params.tx ? await runInTx(params.tx) : await db.transaction(runInTx);

    // 4. Notifications: Sent ONLY on first completion (SAFE_ACTION_REPLAY_DUPLICATE_NOTIFICATION = 0)
    if (result.isNewCompletion && result.details) {
      const details = result.details;
      const typeLabels: Record<string, string> = {
        feeding: "Alimentação",
        medication: "Medicação",
        grooming: "Banho/Tosa",
        walk: "Passeio",
        checkup: "Avaliação",
        other: "Tarefa",
      };
      const label = typeLabels[details.type] ?? "Tarefa";
      const petName = details.petName ? ` (${details.petName})` : "";

      sendPushToRole(crecheId, "creche_admin", {
        title: `✅ Tarefa concluída: ${label}${petName}`,
        body: `${actorName ?? "Staff"} concluiu "${details.title ?? label}".`,
        tag: `task-done-${result.task.id}`,
        data: { type: "task", taskId: result.task.id, petId: details.petId ?? undefined, crecheId },
      }).catch(() => {});
    }

    return result;
  }

  /**
   * Canonical Medication Administration Logic.
   * Scoped to the exact intended medication/task. Zero broad updates (BROAD_MEDICATION_UPDATE = 0).
   */
  public static async recordMedicationAdministration(params: RecordMedicationParams) {
    const { taskId, crecheId, actorUserId, actorName, medicationId, petId, notes, tx } = params;

    const runInTx = async (txHandle: any) => {
      // 1. Complete the task atomically
      const { task, isNewCompletion } = await this.completeTask({
        taskId,
        crecheId,
        actorUserId,
        actorName,
        notes,
        tx: txHandle,
      });

      // 2. Exact medication update scope (BROAD_MEDICATION_UPDATE = 0)
      const targetPetId = petId || task.petId;
      if (targetPetId && isNewCompletion) {
        let exactMedId: number | null = medicationId || null;

        if (!exactMedId) {
          // Look up active medications for this pet to find an exact title/description match
          const activeMeds = await txHandle
            .select({ id: medicationsTable.id, name: medicationsTable.name })
            .from(medicationsTable)
            .where(
              and(
                eq(medicationsTable.petId, targetPetId),
                eq(medicationsTable.crecheId, crecheId),
                eq(medicationsTable.isActive, true)
              )
            );

          // Match by name within task title or description
          const matched = activeMeds.filter((m: any) =>
            task.title?.toLowerCase().includes(m.name.toLowerCase()) ||
            task.description?.toLowerCase().includes(m.name.toLowerCase())
          );

          if (matched.length === 1) {
            exactMedId = matched[0].id;
          }
        }

        // If an exact medication was identified, update ONLY that medication record
        if (exactMedId) {
          await txHandle
            .update(medicationsTable)
            .set({
              lastAdministered: new Date(),
              administeredBy: actorName || "Staff",
            })
            .where(
              and(
                eq(medicationsTable.id, exactMedId),
                eq(medicationsTable.crecheId, crecheId)
              )
            );
        }
      }

      return { task, isNewCompletion };
    };

    return tx ? runInTx(tx) : db.transaction(runInTx);
  }
}
