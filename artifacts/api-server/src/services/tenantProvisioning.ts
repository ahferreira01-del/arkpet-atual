import { db } from "@workspace/db";
import {
  crechesTable,
  usersTable,
  subscriptionsTable,
  plansTable,
  invoicesTable,
  bookingsTable,
  petsTable,
  tutorCreditsTable,
  tutorServiceCreditsTable,
  type Creche,
  type User,
  type Subscription,
  type CommercialAuditActorType,
} from "@workspace/db/schema";
import { eq, and, sql, isNotNull, inArray, gte } from "drizzle-orm";
import { hashPassword } from "../lib/auth.js";
import { encrypt } from "../lib/crypto.js";
import { logCommercialAudit } from "./commercialAudit.js";
import { acquireTenantLifecycleLock } from "./tenantLifecycleLock.js";

export class TenantProvisioningError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "TenantProvisioningError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class TenantArchiveBlockedError extends Error {
  statusCode = 409;
  code: string;
  blockers: ArchiveBlocker[];

  constructor(blockers: ArchiveBlocker[]) {
    const primary = blockers[0] || {
      code: "tenant_archive_blocked",
      message: "Arquivamento bloqueado por pré-requisitos pendentes.",
    };
    super(primary.message);
    this.name = "TenantArchiveBlockedError";
    this.code = primary.code;
    this.blockers = blockers;
  }
}

export interface ArchiveBlocker {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ProvisionTenantParams {
  name: string;
  address?: string | null;
  phone?: string | null;
  email: string;
  maxCapacity?: number;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  adminCpf?: string | null;
  adminPhone?: string | null;
  reason?: string;
  actorType?: CommercialAuditActorType;
  actorId?: number | null;
  actorRole?: string | null;
  actorEmail?: string | null;
}

export interface ProvisionTenantResult {
  creche: Creche;
  user: User;
  subscription: Subscription;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const TRIAL_DURATION_DAYS = 14;

/**
 * Atomic Tenant Provisioning Pipeline (DEC-01, DEC-05, DEC-08, DEC-26)
 *
 * Atomically creates:
 *   1. Creche (status: 'active')
 *   2. Initial creche_admin user with isPrimaryOwner = true
 *   3. 14-day trial subscription
 *   4. Commercial audit ledger entry (TENANT_PROVISIONED)
 *
 * If any step fails, the entire transaction rolls back cleanly.
 */
export async function provisionTenant(
  params: ProvisionTenantParams,
  externalTx?: any
): Promise<ProvisionTenantResult> {
  const {
    name,
    address,
    phone,
    email,
    maxCapacity,
    adminName,
    adminEmail,
    adminPassword,
    adminCpf,
    adminPhone,
    reason,
    actorType = "system",
    actorId = null,
    actorRole = null,
    actorEmail = null,
  } = params;

  // Validation
  if (!name?.trim()) {
    throw new TenantProvisioningError(400, "invalid_creche_name", "O nome da creche é obrigatório.");
  }
  if (!email?.trim() || !EMAIL_RE.test(email.trim())) {
    throw new TenantProvisioningError(400, "invalid_creche_email", "O e-mail da creche é obrigatório e deve ser válido.");
  }
  if (!adminName?.trim()) {
    throw new TenantProvisioningError(400, "invalid_admin_name", "O nome do administrador responsável é obrigatório.");
  }
  if (!adminEmail?.trim() || !EMAIL_RE.test(adminEmail.trim())) {
    throw new TenantProvisioningError(400, "invalid_admin_email", "O e-mail do administrador responsável é obrigatório e deve ser válido.");
  }
  if (!adminPassword || String(adminPassword).length < 6) {
    throw new TenantProvisioningError(400, "invalid_admin_password", "A senha do administrador deve ter no mínimo 6 caracteres.");
  }

  const normalizedAdminEmail = adminEmail.trim().toLowerCase();
  const normalizedCrecheEmail = email.trim().toLowerCase();

  // Check email uniqueness before starting transaction
  const [existingUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, normalizedAdminEmail))
    .limit(1);

  if (existingUser) {
    throw new TenantProvisioningError(409, "email_conflict", "Este e-mail de administrador já está cadastrado.");
  }

  // Query trial plan
  const [trialPlan] = await db
    .select()
    .from(plansTable)
    .where(eq(plansTable.name, "Trial"))
    .limit(1);

  if (!trialPlan) {
    throw new TenantProvisioningError(500, "trial_plan_missing", "Plano de trial não configurado no sistema. Contate o suporte.");
  }

  const executePipeline = async (tx: any): Promise<ProvisionTenantResult> => {
    // 1. Insert Creche
    const [creche] = await tx
      .insert(crechesTable)
      .values({
        name: name.trim(),
        address: address?.trim() || "",
        phone: phone?.trim() || "",
        email: normalizedCrecheEmail,
        maxCapacity: maxCapacity || 20,
        status: "active",
      })
      .returning();

    // 2. Insert Initial creche_admin user with isPrimaryOwner = true
    const [user] = await tx
      .insert(usersTable)
      .values({
        name: adminName.trim(),
        email: normalizedAdminEmail,
        passwordHash: hashPassword(adminPassword),
        role: "creche_admin",
        crecheId: creche.id,
        isPrimaryOwner: true,
        isActive: true,
        mustChangePassword: false,
        cpf: adminCpf ? encrypt(adminCpf) : null,
        phone: adminPhone ? encrypt(adminPhone) : null,
      })
      .returning();

    // 3. Update creche adminId
    await tx
      .update(crechesTable)
      .set({ adminId: user.id })
      .where(eq(crechesTable.id, creche.id));

    // 4. Create 14-day trial subscription (DEC-01)
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);

    const [subscription] = await tx
      .insert(subscriptionsTable)
      .values({
        crecheId: creche.id,
        planId: trialPlan.id,
        status: "trial",
        trialEndsAt,
        currentPeriodEnd: trialEndsAt,
      })
      .returning();

    // 5. Commercial Audit Ledger (Durable audit)
    const effectiveReason = reason?.trim() || "Criação direta de creche pelo Master Admin";
    await logCommercialAudit(
      {
        targetCrecheId: creche.id,
        actorType,
        actorId,
        actorRole,
        actorEmail,
        action: "TENANT_PROVISIONED",
        reason: effectiveReason,
        requiresReason: false,
        afterState: {
          crecheId: creche.id,
          crecheName: creche.name,
          adminId: user.id,
          adminEmail: user.email,
          isPrimaryOwner: true,
          planId: trialPlan.id,
          trialEndsAt: trialEndsAt.toISOString(),
        },
      },
      tx
    );

    return { creche, user, subscription };
  };

  if (externalTx) {
    return await executePipeline(externalTx);
  }

  return await db.transaction(executePipeline);
}

/**
 * Evaluates SAAS-BR-003 Deterministic Preconditions for Tenant Archival.
 */
export async function evaluateArchiveBlockers(
  crecheId: number,
  tx: any
): Promise<ArchiveBlocker[]> {
  const blockers: ArchiveBlocker[] = [];

  // Check 1: Active recurring Stripe subscription (LOCAL_CONSERVATIVE_CHECK)
  const [activeStripeSub] = await tx
    .select({
      id: subscriptionsTable.id,
      status: subscriptionsTable.status,
      stripeSubscriptionId: subscriptionsTable.stripeSubscriptionId,
    })
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.crecheId, crecheId),
        isNotNull(subscriptionsTable.stripeSubscriptionId),
        inArray(subscriptionsTable.status, ["active", "trial", "past_due"])
      )
    )
    .limit(1);

  if (activeStripeSub && activeStripeSub.stripeSubscriptionId) {
    blockers.push({
      code: "stripe_subscription_active",
      message: "A creche possui assinatura Stripe ativa. Cancele a assinatura no Stripe antes de arquivar.",
      details: {
        subscriptionId: activeStripeSub.id,
        stripeSubscriptionId: activeStripeSub.stripeSubscriptionId,
        status: activeStripeSub.status,
      },
    });
  }

  // Check 2: Open tutor invoices (pending)
  const [openInvoices] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.crecheId, crecheId),
        eq(invoicesTable.status, "pending")
      )
    );

  if (openInvoices && openInvoices.count > 0) {
    blockers.push({
      code: "tenant_archive_open_invoice",
      message: "A creche possui faturas em aberto com tutores. Regularize ou cancele todas as faturas antes de arquivar.",
      details: { openInvoiceCount: openInvoices.count },
    });
  }

  // Check 3: Future operational bookings (startDate >= CURRENT_DATE and status not cancelled/completed)
  const [futureBookings] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.crecheId, crecheId),
        gte(bookingsTable.startDate, sql`CURRENT_DATE`),
        sql`${bookingsTable.status} NOT IN ('cancelled', 'completed')`
      )
    );

  if (futureBookings && futureBookings.count > 0) {
    blockers.push({
      code: "tenant_archive_future_booking",
      message: "A creche possui reservas futuras agendadas. Cancele ou conclua todas as reservas antes de arquivar.",
      details: { futureBookingCount: futureBookings.count },
    });
  }

  // Check 4: Active pet check-ins (isCheckedIn = true)
  const [activeCheckins] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(petsTable)
    .where(
      and(
        eq(petsTable.crecheId, crecheId),
        eq(petsTable.isCheckedIn, true)
      )
    );

  if (activeCheckins && activeCheckins.count > 0) {
    blockers.push({
      code: "tenant_archive_active_checkin",
      message: "Existem pets com check-in ativo na creche. Realize o check-out de todos os pets antes de arquivar.",
      details: { activeCheckinCount: activeCheckins.count },
    });
  }

  // Check 5: Positive tutor credits (unspent package credits or service credits)
  const [unspentPackageCredits] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(tutorCreditsTable)
    .where(
      and(
        eq(tutorCreditsTable.crecheId, crecheId),
        sql`${tutorCreditsTable.totalCredits} > ${tutorCreditsTable.usedCredits}`
      )
    );

  const [unspentServiceCredits] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(tutorServiceCreditsTable)
    .where(
      and(
        eq(tutorServiceCreditsTable.crecheId, crecheId),
        sql`${tutorServiceCreditsTable.totalCredits} > ${tutorServiceCreditsTable.usedCredits}`
      )
    );

  const totalCreditHolders = (unspentPackageCredits?.count || 0) + (unspentServiceCredits?.count || 0);
  if (totalCreditHolders > 0) {
    blockers.push({
      code: "tenant_archive_positive_credit",
      message: "Existem tutores com saldo de créditos positivo. Zere ou estorne os créditos antes de arquivar.",
      details: { unspentCreditRecords: totalCreditHolders },
    });
  }

  return blockers;
}

export interface ArchiveTenantParams {
  crecheId: number;
  reason: string;
  actorId?: number | null;
  actorRole?: string | null;
  actorEmail?: string | null;
  actorType?: CommercialAuditActorType;
}

/**
 * Tenant Archival Pipeline (GAP-02, SAAS-BR-003)
 *
 * 1. Acquires Level 1 Exclusive Advisory Lock (-9812, crecheId)
 * 2. Re-reads creche row FOR UPDATE
 * 3. Evaluates deterministic archive blockers
 * 4. If blocked: commits durable TENANT_ARCHIVE_BLOCKED audit log, leaves creche active, throws TenantArchiveBlockedError (409)
 * 5. If eligible: transitions status to 'archived', sets deletedAt = NOW(), suspends local subscription, commits TENANT_ARCHIVED audit log
 */
export async function archiveTenant(params: ArchiveTenantParams): Promise<Creche> {
  const {
    crecheId,
    reason,
    actorId = null,
    actorRole = null,
    actorEmail = null,
    actorType = "user",
  } = params;

  if (!reason || !reason.trim()) {
    throw new TenantProvisioningError(400, "missing_reason", "O motivo do arquivamento é obrigatório.");
  }

  const result = await db.transaction(async (tx) => {
    // Level 1: Exclusive advisory lock
    await acquireTenantLifecycleLock(crecheId, tx);

    const [creche] = await tx
      .select()
      .from(crechesTable)
      .where(eq(crechesTable.id, crecheId))
      .for("update");

    if (!creche) {
      throw new TenantProvisioningError(404, "not_found", "Creche não encontrada");
    }
    if (creche.status === "archived") {
      throw new TenantProvisioningError(409, "already_archived", "Creche já se encontra arquivada.");
    }

    // Evaluate SAAS-BR-003 blockers
    const blockers = await evaluateArchiveBlockers(crecheId, tx);

    if (blockers.length > 0) {
      // Persist durable TENANT_ARCHIVE_BLOCKED audit entry
      await logCommercialAudit(
        {
          targetCrecheId: crecheId,
          actorType,
          actorId,
          actorRole,
          actorEmail,
          action: "TENANT_ARCHIVE_BLOCKED",
          reason: reason.trim(),
          requiresReason: false,
          beforeState: { status: creche.status },
          afterState: { status: creche.status, blockers },
        },
        tx
      );

      // Return blocked outcome so transaction commits the audit row
      return { success: false as const, blockers };
    }

    // Success: Soft-delete tenant
    const now = new Date();
    const [archivedCreche] = await tx
      .update(crechesTable)
      .set({
        status: "archived",
        deletedAt: now,
      })
      .where(eq(crechesTable.id, crecheId))
      .returning();

    // Soft-delete local subscription: transition to 'suspended'
    const [sub] = await tx
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.crecheId, crecheId))
      .limit(1);

    let subBeforeStatus: string | null = null;
    let subAfterStatus: string | null = null;
    if (sub && sub.status !== "suspended") {
      subBeforeStatus = sub.status;
      subAfterStatus = "suspended";
      await tx
        .update(subscriptionsTable)
        .set({ status: "suspended" })
        .where(eq(subscriptionsTable.id, sub.id));
    }

    // Commit TENANT_ARCHIVED audit entry
    await logCommercialAudit(
      {
        targetCrecheId: crecheId,
        actorType,
        actorId,
        actorRole,
        actorEmail,
        action: "TENANT_ARCHIVED",
        reason: reason.trim(),
        requiresReason: true,
        beforeState: {
          status: creche.status,
          deletedAt: creche.deletedAt,
          subscriptionStatus: subBeforeStatus,
        },
        afterState: {
          status: "archived",
          deletedAt: now.toISOString(),
          subscriptionStatus: subAfterStatus,
        },
      },
      tx
    );

    return { success: true as const, creche: archivedCreche };
  });

  if (!result.success) {
    throw new TenantArchiveBlockedError(result.blockers);
  }

  return result.creche;
}

export interface RestoreTenantParams {
  crecheId: number;
  reason?: string;
  actorId?: number | null;
  actorRole?: string | null;
  actorEmail?: string | null;
  actorType?: CommercialAuditActorType;
}

/**
 * Tenant Restoration Pipeline (INVARIANT-R38A-02)
 *
 * Restores an archived tenant back to 'active'.
 * CRITICAL INVARIANT: Restore modifies ONLY tenant state (status = 'active', deletedAt = NULL).
 * It NEVER creates a subscription, extends a trial, or modifies subscription status.
 */
export async function restoreTenant(params: RestoreTenantParams): Promise<Creche> {
  const {
    crecheId,
    reason = "Reativação de creche pelo Master Admin",
    actorId = null,
    actorRole = null,
    actorEmail = null,
    actorType = "user",
  } = params;

  return await db.transaction(async (tx) => {
    // Level 1: Exclusive advisory lock
    await acquireTenantLifecycleLock(crecheId, tx);

    const [creche] = await tx
      .select()
      .from(crechesTable)
      .where(eq(crechesTable.id, crecheId))
      .for("update");

    if (!creche) {
      throw new TenantProvisioningError(404, "not_found", "Creche não encontrada");
    }
    if (creche.status !== "archived") {
      throw new TenantProvisioningError(409, "not_archived", "A creche não está arquivada.");
    }

    const [restoredCreche] = await tx
      .update(crechesTable)
      .set({
        status: "active",
        deletedAt: null,
      })
      .where(eq(crechesTable.id, crecheId))
      .returning();

    // Record TENANT_RESTORED in commercial audit ledger
    await logCommercialAudit(
      {
        targetCrecheId: crecheId,
        actorType,
        actorId,
        actorRole,
        actorEmail,
        action: "TENANT_RESTORED",
        reason: reason.trim(),
        requiresReason: true,
        beforeState: {
          status: creche.status,
          deletedAt: creche.deletedAt ? creche.deletedAt.toISOString() : null,
        },
        afterState: {
          status: "active",
          deletedAt: null,
        },
      },
      tx
    );

    return restoredCreche;
  });
}
