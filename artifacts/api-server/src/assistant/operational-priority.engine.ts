import { AssistantSafeActionRegistry } from "./assistant-safe-action.registry.js";
import type {
  OperationalIssue,
  OperationalIssuePriority,
  OperationalIssueCategory,
  OperationalArrivalItem,
  OperationalTaskItem,
} from "./assistant.types.js";

const PRIORITY_WEIGHTS: Record<OperationalIssuePriority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export interface BuildIssuesInput {
  serverNow: Date;
  businessDate: string;
  arrivals: OperationalArrivalItem[];
  tasks: OperationalTaskItem[];
}

export class OperationalPriorityEngine {
  public static readonly RULE_SOURCE = "ARKPET_CANONICAL_SCHEDULE_AND_STATUS";

  /**
   * Deterministically evaluates operational facts and extracts prioritized issues.
   * Pure function: no database mutations, zero random generation, 100% deterministic output.
   */
  public static evaluate(input: BuildIssuesInput): OperationalIssue[] {
    const { serverNow, arrivals, tasks } = input;
    const issues: OperationalIssue[] = [];

    // 1. Evaluate Tasks (Feedings, Medications, Walks, General Tasks)
    for (const task of tasks) {
      if (task.status !== "pending") {
        // Completed or skipped tasks are never issues (R41F-OPS-004)
        continue;
      }

      const scheduledDate = new Date(task.scheduledFor);
      const isPast = scheduledDate.getTime() < serverNow.getTime();
      const delayMinutes = isPast
        ? Math.max(0, Math.floor((serverNow.getTime() - scheduledDate.getTime()) / 60000))
        : 0;

      const isUnassigned = !task.assignedToId;
      const scheduledTimeStr = scheduledDate.toLocaleTimeString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
      });

      if (task.type === "medication") {
        // Medication is operationally critical
        // Rule: Overdue medication is high priority (or critical if > 60m late)
        let priority: OperationalIssuePriority = "high";
        if (delayMinutes >= 60) {
          priority = "critical";
        } else if (!isPast) {
          priority = "medium";
        }

        const reason = isPast
          ? `Medicação programada para ${task.petName || "pet"} às ${scheduledTimeStr} está atrasada há ${delayMinutes} minuto(s).`
          : `Medicação programada para ${task.petName || "pet"} às ${scheduledTimeStr} está pendente para hoje.`;

        const issue: OperationalIssue = {
          id: `task_medication_${task.id}`,
          category: "medication",
          priority,
          title: `Medicação de ${task.petName || "Pet"} (${task.title})`,
          reason: isUnassigned ? `${reason} (Sem responsável atribuído)` : reason,
          reasonCode: isPast ? "medication_overdue" : "medication_pending",
          targetType: "task",
          targetId: task.id,
          petId: task.petId ?? undefined,
          petName: task.petName ?? undefined,
          scheduledFor: task.scheduledFor,
          delayMinutes: isPast ? delayMinutes : 0,
          detectedAt: serverNow.toISOString(),
          suggestedAction: {
            tool: "record_medication_administration",
            taskId: task.id,
            petId: task.petId ?? undefined,
            targetId: task.id,
            label: `Registrar administração de ${task.title}`,
          },
        };

        this.validateAndAttachAction(issue, "record_medication_administration");
        issues.push(issue);
      } else if (task.type === "feeding") {
        // Feeding tasks
        let priority: OperationalIssuePriority = "high";
        if (delayMinutes >= 90) {
          priority = "critical";
        } else if (!isPast) {
          priority = "medium";
        }

        const reason = isPast
          ? `Alimentação de ${task.petName || "pet"} programada para ${scheduledTimeStr} está atrasada há ${delayMinutes} minuto(s).`
          : `Alimentação de ${task.petName || "pet"} programada para ${scheduledTimeStr} está pendente.`;

        const issue: OperationalIssue = {
          id: `task_feeding_${task.id}`,
          category: "feeding",
          priority,
          title: `Alimentação de ${task.petName || "Pet"} (${task.title})`,
          reason: isUnassigned ? `${reason} (Sem responsável atribuído)` : reason,
          reasonCode: isPast ? "feeding_overdue" : "feeding_pending",
          targetType: "task",
          targetId: task.id,
          petId: task.petId ?? undefined,
          petName: task.petName ?? undefined,
          scheduledFor: task.scheduledFor,
          delayMinutes: isPast ? delayMinutes : 0,
          detectedAt: serverNow.toISOString(),
          suggestedAction: {
            tool: "complete_feeding_task",
            taskId: task.id,
            petId: task.petId ?? undefined,
            targetId: task.id,
            label: `Concluir alimentação de ${task.petName || "pet"}`,
          },
        };

        this.validateAndAttachAction(issue, "complete_feeding_task");
        issues.push(issue);
      } else if (task.type === "walk") {
        // Walk tasks
        // Overdue walk is medium priority (ranks below overdue medication)
        let priority: OperationalIssuePriority = isPast ? "medium" : "low";
        if (delayMinutes >= 120) {
          priority = "high";
        }

        const reason = isPast
          ? `Passeio de ${task.petName || "pet"} agendado para ${scheduledTimeStr} está pendente há ${delayMinutes} minuto(s).`
          : `Passeio de ${task.petName || "pet"} agendado para ${scheduledTimeStr} está pendente.`;

        const issue: OperationalIssue = {
          id: `task_walk_${task.id}`,
          category: "walk",
          priority,
          title: `Passeio de ${task.petName || "Pet"} (${task.title})`,
          reason: isUnassigned ? `${reason} (Sem responsável atribuído)` : reason,
          reasonCode: isPast ? "walk_overdue" : "walk_pending",
          targetType: "task",
          targetId: task.id,
          petId: task.petId ?? undefined,
          petName: task.petName ?? undefined,
          scheduledFor: task.scheduledFor,
          delayMinutes: isPast ? delayMinutes : 0,
          detectedAt: serverNow.toISOString(),
          suggestedAction: {
            tool: "complete_walk_task",
            taskId: task.id,
            petId: task.petId ?? undefined,
            targetId: task.id,
            label: `Concluir passeio de ${task.petName || "pet"}`,
          },
        };

        this.validateAndAttachAction(issue, "complete_walk_task");
        issues.push(issue);
      } else {
        // General or other tasks
        const priority: OperationalIssuePriority = isPast ? "medium" : "low";
        const reason = isPast
          ? `Tarefa "${task.title}" programada para ${scheduledTimeStr} está atrasada há ${delayMinutes} minuto(s).`
          : `Tarefa "${task.title}" programada para ${scheduledTimeStr} está pendente.`;

        const issue: OperationalIssue = {
          id: `task_general_${task.id}`,
          category: "task",
          priority,
          title: `Tarefa: ${task.title}`,
          reason: isUnassigned ? `${reason} (Sem responsável atribuído)` : reason,
          reasonCode: isPast ? "task_overdue" : "task_pending",
          targetType: "task",
          targetId: task.id,
          petId: task.petId ?? undefined,
          petName: task.petName ?? undefined,
          scheduledFor: task.scheduledFor,
          delayMinutes: isPast ? delayMinutes : 0,
          detectedAt: serverNow.toISOString(),
          suggestedAction: {
            tool: "complete_operational_task",
            taskId: task.id,
            targetId: task.id,
            label: `Concluir tarefa ${task.title}`,
          },
        };

        this.validateAndAttachAction(issue, "complete_operational_task");
        issues.push(issue);
      }
    }

    // 2. Evaluate Arrivals (Pending Check-Ins)
    for (const arrival of arrivals) {
      if (arrival.status === "confirmed") {
        // Confirmed booking for today that hasn't checked in yet
        const isOnTheWay = Boolean(arrival.onTheWayAt || arrival.onTheWayType);
        const priority: OperationalIssuePriority = isOnTheWay ? "high" : "medium";

        const reason = isOnTheWay
          ? `${arrival.petName} está a caminho (${arrival.onTheWayEtaMinutes ?? "?"} min) e aguarda check-in na chegada.`
          : `${arrival.petName} possui reserva confirmada para hoje e ainda não realizou check-in.`;

        const issue: OperationalIssue = {
          id: `arrival_${arrival.bookingId}`,
          category: "arrival",
          priority,
          title: `Check-in pendente: ${arrival.petName}`,
          reason,
          reasonCode: "arrival_pending",
          targetType: "pet",
          targetId: arrival.petId,
          petId: arrival.petId,
          petName: arrival.petName,
          detectedAt: serverNow.toISOString(),
          suggestedAction: {
            tool: "check_in_pet",
            petId: arrival.petId,
            bookingId: arrival.bookingId,
            targetId: arrival.petId,
            label: `Realizar check-in de ${arrival.petName}`,
          },
        };

        this.validateAndAttachAction(issue, "check_in_pet");
        issues.push(issue);
      }
    }

    // 3. Deterministic Sorting & Ranking (R41F-PRIORITY-002)
    // Primary: priority weight (critical > high > medium > low)
    // Secondary: lateness / delayMinutes descending (longest overdue first)
    // Tertiary: stable identifier alphabetically
    return issues.sort((a, b) => {
      const weightDiff = PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority];
      if (weightDiff !== 0) return weightDiff;

      const delayDiff = (b.delayMinutes || 0) - (a.delayMinutes || 0);
      if (delayDiff !== 0) return delayDiff;

      return a.id.localeCompare(b.id);
    });
  }

  /**
   * Enforces UNREGISTERED_RECOMMENDED_ACTION = 0.
   * If a suggested tool is not registered in SAFE_ACTION_REGISTRY, removes the suggestedAction.
   */
  private static validateAndAttachAction(issue: OperationalIssue, toolName: string) {
    if (!AssistantSafeActionRegistry.isRegistered(toolName)) {
      delete issue.suggestedAction;
    }
  }

  /**
   * Helper to validate external action recommendation against registered tools (R41F-ACTION-006 / 007).
   */
  public static isSafeActionValid(toolName: string): boolean {
    return AssistantSafeActionRegistry.isRegistered(toolName);
  }
}
