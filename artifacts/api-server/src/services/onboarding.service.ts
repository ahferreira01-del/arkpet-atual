import { db } from "@workspace/db";
import {
  crechesTable,
  usersTable,
  petsTable,
  bookingsTable,
} from "@workspace/db/schema";
import { eq, and, sql, count } from "drizzle-orm";

export type CanonicalOnboardingStepId =
  | "creche_details"
  | "staff"
  | "tutors"
  | "pets"
  | "bookings";

export interface CanonicalOnboardingStep {
  id: CanonicalOnboardingStepId;
  title: string;
  description: string;
  completed: boolean;
  route: string;
  actionLabel: string;
}

export interface CanonicalOnboardingStatus {
  crecheId: number;
  isComplete: boolean;
  completedCount: number;
  totalSteps: number;
  steps: CanonicalOnboardingStep[];
}

export const CANONICAL_ONBOARDING_STEP_IDS: readonly CanonicalOnboardingStepId[] = [
  "creche_details",
  "staff",
  "tutors",
  "pets",
  "bookings",
] as const;

/**
 * Single server-side source of truth for canonical onboarding status calculation.
 * Owns domain-derived completion rules (R40.E compliant):
 * 1. creche_details: Boolean(phone && address)
 * 2. staff: staffMembersCount > 1 (creche_admin + staff)
 * 3. tutors: tutorsCount > 0
 * 4. pets: petsCount > 0
 * 5. bookings: bookingsCount > 0
 */
export async function getCanonicalOnboardingStatus(
  crecheId: number,
  dbInstance: any = db
): Promise<CanonicalOnboardingStatus | null> {
  const [creche] = await dbInstance
    .select()
    .from(crechesTable)
    .where(eq(crechesTable.id, crecheId))
    .limit(1);

  if (!creche) {
    return null;
  }

  const [staffMembersCount] = await dbInstance
    .select({ count: count() })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.crecheId, crecheId),
        sql`role IN ('creche_admin', 'staff')`
      )
    );

  const [tutorsCount] = await dbInstance
    .select({ count: count() })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.crecheId, crecheId),
        eq(usersTable.role, "tutor")
      )
    );

  const [petsCount] = await dbInstance
    .select({ count: count() })
    .from(petsTable)
    .where(eq(petsTable.crecheId, crecheId));

  const [bookingsCount] = await dbInstance
    .select({ count: count() })
    .from(bookingsTable)
    .where(eq(bookingsTable.crecheId, crecheId));

  const steps: CanonicalOnboardingStep[] = [
    {
      id: "creche_details",
      title: "Completar dados da creche",
      description: "Informe telefone e endereço da creche",
      completed: Boolean(creche.phone && creche.address),
      route: "/settings",
      actionLabel: "Configurar",
    },
    {
      id: "staff",
      title: "Cadastrar equipe",
      description: "Convide ou adicione membros da equipe",
      completed: (staffMembersCount?.count || 0) > 1,
      route: "/staff/manage",
      actionLabel: "Equipe",
    },
    {
      id: "tutors",
      title: "Cadastrar tutor",
      description: "Cadastre seu primeiro tutor",
      completed: (tutorsCount?.count || 0) > 0,
      route: "/tutors",
      actionLabel: "Tutores",
    },
    {
      id: "pets",
      title: "Cadastrar primeiro pet",
      description: "Cadastre um pet vinculado a um tutor",
      completed: (petsCount?.count || 0) > 0,
      route: "/pets",
      actionLabel: "Pets",
    },
    {
      id: "bookings",
      title: "Conhecer reservas",
      description: "Crie sua primeira reserva ou veja a agenda",
      completed: (bookingsCount?.count || 0) > 0,
      route: "/bookings",
      actionLabel: "Reservas",
    },
  ];

  const completedCount = steps.filter((s) => s.completed).length;
  const isComplete = completedCount === steps.length;

  return {
    crecheId,
    isComplete,
    completedCount,
    totalSteps: steps.length,
    steps,
  };
}
