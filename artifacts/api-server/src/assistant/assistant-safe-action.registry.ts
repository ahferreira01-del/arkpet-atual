import { z } from "zod";
import type { AssistantRole, AssistantSafeActionRiskLevel } from "./assistant.types.js";

export interface SafeActionDefinition<TInput = any, TPreview = any, TResult = any> {
  actionType: string;
  mode: "mutation";
  targetType: "booking" | "pet" | "task" | "medication";
  allowedRoles: AssistantRole[];
  riskLevel: AssistantSafeActionRiskLevel;
  requiresConfirmation: true; // Strict invariant: ALL mutations require explicit confirmation
  description: string;
  inputSchema: z.ZodType<TInput>;
}

export const CANONICAL_MUTATION_TOOL_NAMES = [
  "cancel_my_booking",
  "check_in_pet",
  "check_out_pet",
  "complete_operational_task",
  "complete_feeding_task",
  "record_medication_administration",
  "complete_walk_task",
] as const;

export type CanonicalMutationToolName = (typeof CANONICAL_MUTATION_TOOL_NAMES)[number];

export const SAFE_ACTION_REGISTRY: Record<CanonicalMutationToolName, SafeActionDefinition> = {
  cancel_my_booking: {
    actionType: "cancel_my_booking",
    mode: "mutation",
    targetType: "booking",
    allowedRoles: ["tutor"],
    riskLevel: "medium",
    requiresConfirmation: true,
    description: "Cria uma proposta de cancelamento para uma reserva elegível pertencente ao tutor autenticado.",
    inputSchema: z.object({
      bookingId: z.number().int().positive("ID da reserva deve ser um inteiro positivo"),
      reason: z.string().max(500, "Motivo deve ter no máximo 500 caracteres").optional(),
    }),
  },

  check_in_pet: {
    actionType: "check_in_pet",
    mode: "mutation",
    targetType: "pet",
    allowedRoles: ["staff", "creche_admin"],
    riskLevel: "medium",
    requiresConfirmation: true,
    description: "Cria uma proposta de check-in para um pet com reserva confirmada na creche.",
    inputSchema: z.object({
      petId: z.number().int().positive("ID do pet deve ser um inteiro positivo"),
      bookingId: z.number().int().positive("ID da reserva deve ser um inteiro positivo").optional(),
      notes: z.string().max(500).optional(),
    }),
  },

  check_out_pet: {
    actionType: "check_out_pet",
    mode: "mutation",
    targetType: "pet",
    allowedRoles: ["staff", "creche_admin"],
    riskLevel: "medium",
    requiresConfirmation: true,
    description: "Cria uma proposta de check-out para um pet com reserva ativa na creche.",
    inputSchema: z.object({
      petId: z.number().int().positive("ID do pet deve ser um inteiro positivo"),
      bookingId: z.number().int().positive("ID da reserva deve ser um inteiro positivo").optional(),
      notes: z.string().max(500).optional(),
    }),
  },

  complete_feeding_task: {
    actionType: "complete_feeding_task",
    mode: "mutation",
    targetType: "task",
    allowedRoles: ["staff", "creche_admin"],
    riskLevel: "low",
    requiresConfirmation: true,
    description: "Cria uma proposta para marcar uma tarefa de alimentação agendada como concluída.",
    inputSchema: z.object({
      taskId: z.number().int().positive().optional(),
      petId: z.number().int().positive().optional(),
      notes: z.string().max(500).optional(),
    }),
  },

  record_medication_administration: {
    actionType: "record_medication_administration",
    mode: "mutation",
    targetType: "task",
    allowedRoles: ["staff", "creche_admin"],
    riskLevel: "high",
    requiresConfirmation: true,
    description: "Cria uma proposta para registrar a administração de um medicamento previamente agendado no prontuário.",
    inputSchema: z.object({
      taskId: z.number().int().positive().optional(),
      petId: z.number().int().positive().optional(),
      medicationId: z.number().int().positive().optional(),
      notes: z.string().max(500).optional(),
      // CRITICAL: Dosage overrides from model/user are strictly prohibited (MODEL_OVERRIDES_MEDICATION_DOSAGE = 0).
    }),
  },

  complete_walk_task: {
    actionType: "complete_walk_task",
    mode: "mutation",
    targetType: "task",
    allowedRoles: ["staff", "creche_admin"],
    riskLevel: "low",
    requiresConfirmation: true,
    description: "Cria uma proposta para marcar uma tarefa de passeio agendada como concluída.",
    inputSchema: z.object({
      taskId: z.number().int().positive().optional(),
      petId: z.number().int().positive().optional(),
      notes: z.string().max(500).optional(),
    }),
  },

  complete_operational_task: {
    actionType: "complete_operational_task",
    mode: "mutation",
    targetType: "task",
    allowedRoles: ["staff", "creche_admin"],
    riskLevel: "low",
    requiresConfirmation: true,
    description: "Cria uma proposta para marcar uma tarefa operacional agendada como concluída.",
    inputSchema: z.object({
      taskId: z.number().int().positive("ID da tarefa deve ser um inteiro positivo"),
      notes: z.string().max(500).optional(),
    }),
  },
};

export class AssistantSafeActionRegistry {
  public static getDefinition(actionType: string): SafeActionDefinition | null {
    if (Object.prototype.hasOwnProperty.call(SAFE_ACTION_REGISTRY, actionType)) {
      return SAFE_ACTION_REGISTRY[actionType as CanonicalMutationToolName];
    }
    return null;
  }

  public static isRegistered(actionType: string): boolean {
    return Boolean(this.getDefinition(actionType));
  }

  public static getAllActions(): SafeActionDefinition[] {
    return Object.values(SAFE_ACTION_REGISTRY);
  }

  public static getAllActionTypes(): CanonicalMutationToolName[] {
    return [...CANONICAL_MUTATION_TOOL_NAMES];
  }

  public static getActionsForRole(role: AssistantRole): SafeActionDefinition[] {
    return Object.values(SAFE_ACTION_REGISTRY).filter((def) => def.allowedRoles.includes(role));
  }
}
