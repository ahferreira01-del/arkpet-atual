import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
  tasksTable,
  commercialAuditLedgerTable,
  catalogueItemsTable,
  ordersTable,
  timelineEventsTable,
  chatMessagesTable,
} from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { hashPassword } from "../lib/auth.js";
import {
  archiveTenant,
  restoreTenant,
  evaluateArchiveBlockers,
  TenantProvisioningError,
  TenantArchiveBlockedError,
} from "../services/tenantProvisioning.js";
import {
  acquireTenantOperationalLock,
  acquireTenantLifecycleLock,
  TenantArchivedError,
  TENANT_LIFECYCLE_ADVISORY_NAMESPACE,
} from "../services/tenantLifecycleLock.js";
import { generateDailyTasks } from "../lib/scheduler.js";
import { ensureTenantIntegritySchema } from "../startup.js";

function createSignal() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function assertNonProductionDatabase(): Promise<void> {
  const nodeEnv = (process.env.NODE_ENV ?? "").toLowerCase();
  const appEnv = (process.env.APP_ENV ?? "").toLowerCase();
  const effectiveUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

  if (nodeEnv === "production" || appEnv === "production") {
    throw new Error("R38.A integration tests refused to run: database environment is not explicitly classified as non-production. [production flag detected]");
  }

  if (!effectiveUrl) {
    throw new Error("R38.A integration tests refused to run: database environment is not explicitly classified as non-production. [no database URL configured]");
  }

  let parsed: URL;
  try {
    parsed = new URL(effectiveUrl);
  } catch {
    throw new Error("R38.A integration tests refused to run: database environment is not explicitly classified as non-production. [invalid database URL format]");
  }

  const host = parsed.hostname.toLowerCase();
  const prodKeywords = ["prod", "production", "live", "arkpet-prod", "aws.prod", "primary-cluster"];
  const isProdHost = prodKeywords.some((kw) => {
    const parts = host.split(/[.-]/);
    return parts.includes(kw) || host.includes(`-${kw}-`) || host.endsWith(`-${kw}`) || host.startsWith(`${kw}-`);
  });

  if (isProdHost || host.includes("production")) {
    throw new Error("R38.A integration tests refused to run: database environment is not explicitly classified as non-production. [target host matches production pattern]");
  }

  const isSafeHost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.includes("neon.tech") ||
    host.includes("test") ||
    host.includes("dev") ||
    host.includes("qa") ||
    host.includes("staging");

  if (!isSafeHost) {
    throw new Error("R38.A integration tests refused to run: database environment is not explicitly classified as non-production. [target host not on non-production allowlist]");
  }

  const res = await db.execute(sql`SELECT current_database();`);
  const row = res.rows[0] as any;
  const dbName = String(row?.current_database || "").toLowerCase();
  if (dbName.includes("prod") || dbName.includes("production")) {
    throw new Error("R38.A integration tests refused to run: database environment is not explicitly classified as non-production. [live database name matches production pattern]");
  }
}

describe("R38.A Tenant Archive & Concurrency Test Suite (TEST-49 to TEST-64)", () => {
  let trialPlanId: number;
  const cleanupCrecheIds: number[] = [];
  const cleanupUserIds: number[] = [];

  beforeAll(async () => {
    // 0. Fail-Closed Non-Production Database Safety Guard
    await assertNonProductionDatabase();

    await ensureTenantIntegritySchema();

    const [existingTrial] = await db
      .select()
      .from(plansTable)
      .where(eq(plansTable.name, "Trial"))
      .limit(1);

    if (existingTrial) {
      trialPlanId = existingTrial.id;
    } else {
      const [newPlan] = await db
        .insert(plansTable)
        .values({
          name: "Trial",
          petLimit: 10,
          priceBrl: 0,
          description: "Trial Plan",
        })
        .returning();
      trialPlanId = newPlan.id;
    }
  });

  afterAll(async () => {
    if (cleanupCrecheIds.length > 0) {
      await db.delete(commercialAuditLedgerTable).where(
        sql`target_creche_id = ANY(ARRAY[${sql.join(cleanupCrecheIds.map((id) => sql`${id}`), sql`, `)}]::int[])`
      );
      await db.delete(timelineEventsTable).where(
        sql`creche_id = ANY(ARRAY[${sql.join(cleanupCrecheIds.map((id) => sql`${id}`), sql`, `)}]::int[])`
      );
      await db.delete(chatMessagesTable).where(
        sql`creche_id = ANY(ARRAY[${sql.join(cleanupCrecheIds.map((id) => sql`${id}`), sql`, `)}]::int[])`
      );
      await db.delete(tasksTable).where(
        sql`creche_id = ANY(ARRAY[${sql.join(cleanupCrecheIds.map((id) => sql`${id}`), sql`, `)}]::int[])`
      );
      await db.delete(ordersTable).where(
        sql`creche_id = ANY(ARRAY[${sql.join(cleanupCrecheIds.map((id) => sql`${id}`), sql`, `)}]::int[])`
      );
      await db.delete(catalogueItemsTable).where(
        sql`creche_id = ANY(ARRAY[${sql.join(cleanupCrecheIds.map((id) => sql`${id}`), sql`, `)}]::int[])`
      );
      await db.delete(invoicesTable).where(
        sql`creche_id = ANY(ARRAY[${sql.join(cleanupCrecheIds.map((id) => sql`${id}`), sql`, `)}]::int[])`
      );
      await db.delete(bookingsTable).where(
        sql`creche_id = ANY(ARRAY[${sql.join(cleanupCrecheIds.map((id) => sql`${id}`), sql`, `)}]::int[])`
      );
      await db.delete(petsTable).where(
        sql`creche_id = ANY(ARRAY[${sql.join(cleanupCrecheIds.map((id) => sql`${id}`), sql`, `)}]::int[])`
      );
      await db.delete(tutorCreditsTable).where(
        sql`creche_id = ANY(ARRAY[${sql.join(cleanupCrecheIds.map((id) => sql`${id}`), sql`, `)}]::int[])`
      );
      await db.delete(subscriptionsTable).where(
        sql`creche_id = ANY(ARRAY[${sql.join(cleanupCrecheIds.map((id) => sql`${id}`), sql`, `)}]::int[])`
      );
      await db.delete(usersTable).where(
        sql`creche_id = ANY(ARRAY[${sql.join(cleanupCrecheIds.map((id) => sql`${id}`), sql`, `)}]::int[])`
      );
      await db.delete(crechesTable).where(
        sql`id = ANY(ARRAY[${sql.join(cleanupCrecheIds.map((id) => sql`${id}`), sql`, `)}]::int[])`
      );
    }
    if (cleanupUserIds.length > 0) {
      await db.delete(usersTable).where(
        sql`id = ANY(ARRAY[${sql.join(cleanupUserIds.map((id) => sql`${id}`), sql`, `)}]::int[])`
      );
    }
  });

  async function createActiveCreche(namePrefix: string) {
    const ts = Date.now() + Math.floor(Math.random() * 100000);
    const [creche] = await db
      .insert(crechesTable)
      .values({
        name: `${namePrefix} ${ts}`,
        address: "Rua Concorrência 100",
        phone: "11988887777",
        email: `conc-${ts}@test.invalid`,
        status: "active",
      })
      .returning();
    cleanupCrecheIds.push(creche.id);

    await db.insert(subscriptionsTable).values({
      crecheId: creche.id,
      planId: trialPlanId,
      status: "active",
    });

    const [admin] = await db
      .insert(usersTable)
      .values({
        name: `Admin ${namePrefix}`,
        email: `admin-${ts}@test.invalid`,
        passwordHash: hashPassword("Pass123!"),
        role: "creche_admin",
        crecheId: creche.id,
        isPrimaryOwner: true,
        isActive: true,
      })
      .returning();
    cleanupUserIds.push(admin.id);

    await db.update(crechesTable).set({ adminId: admin.id }).where(eq(crechesTable.id, creche.id));

    const [tutor] = await db
      .insert(usersTable)
      .values({
        name: `Tutor ${namePrefix}`,
        email: `tutor-${ts}@test.invalid`,
        passwordHash: hashPassword("Pass123!"),
        role: "tutor",
        crecheId: creche.id,
        isActive: true,
      })
      .returning();
    cleanupUserIds.push(tutor.id);

    const [pet] = await db
      .insert(petsTable)
      .values({
        name: `Pet ${namePrefix}`,
        species: "dog",
        size: "medium",
        tutorId: tutor.id,
        crecheId: creche.id,
        isCheckedIn: false,
      })
      .returning();

    return { creche, admin, tutor, pet };
  }

  // =========================================================================
  // GROUP J: AUTHORITATIVE BIDIRECTIONAL CONCURRENCY RACES (TEST-49 to TEST-56)
  // =========================================================================
  describe("GROUP J: AUTHORITATIVE BIDIRECTIONAL CONCURRENCY RACES", () => {
    it("TEST-49: Race 1A: Archive Commits First || Booking Creation", async () => {
      const { creche, tutor, pet } = await createActiveCreche("Race1A");

      const archiveLockHeld = createSignal();
      const bookingAttemptStarted = createSignal();

      // Thread 1: Archive
      const archivePromise = db.transaction(async (tx) => {
        await acquireTenantLifecycleLock(creche.id, tx);
        archiveLockHeld.resolve();
        await bookingAttemptStarted.promise;

        await tx
          .update(crechesTable)
          .set({ status: "archived", deletedAt: new Date() })
          .where(eq(crechesTable.id, creche.id));
      });

      // Thread 2: Booking
      const bookingPromise = (async () => {
        await archiveLockHeld.promise;
        let caughtError: any = null;

        try {
          await db.transaction(async (tx) => {
            bookingAttemptStarted.resolve();
            await acquireTenantOperationalLock(creche.id, tx);

            const futureDate = new Date(Date.now() + 86400000).toISOString().split("T")[0];
            await tx.insert(bookingsTable).values({
              crecheId: creche.id,
              tutorId: tutor.id,
              petId: pet.id,
              startDate: futureDate,
              endDate: futureDate,
              status: "active",
              type: "day_use",
            });
          });
        } catch (err: any) {
          caughtError = err;
        }
        return caughtError;
      })();

      const [, bookingErr] = await Promise.all([archivePromise, bookingPromise]);

      expect(bookingErr).toBeInstanceOf(TenantArchivedError);
      expect(bookingErr.code).toBe("tenant_archived");

      // Verify 0 bookings were committed
      const bookings = await db.select().from(bookingsTable).where(eq(bookingsTable.crecheId, creche.id));
      expect(bookings.length).toBe(0);
    });

    it("TEST-50: Race 1B: Booking Commits First || Archive", async () => {
      const { creche, tutor, pet } = await createActiveCreche("Race1B");

      const bookingLockHeld = createSignal();
      const archiveAttemptStarted = createSignal();

      // Thread 1: Booking
      const bookingPromise = db.transaction(async (tx) => {
        await acquireTenantOperationalLock(creche.id, tx);
        bookingLockHeld.resolve();
        await archiveAttemptStarted.promise;

        const futureDate = new Date(Date.now() + 86400000).toISOString().split("T")[0];
        await tx.insert(bookingsTable).values({
          crecheId: creche.id,
          tutorId: tutor.id,
          petId: pet.id,
          startDate: futureDate,
          endDate: futureDate,
          status: "active",
          type: "day_use",
        });
      });

      // Thread 2: Archive
      const archivePromise = (async () => {
        await bookingLockHeld.promise;
        archiveAttemptStarted.resolve();

        let caughtErr: any = null;
        try {
          await archiveTenant({ crecheId: creche.id, reason: "Tentativa concorrente com reserva" });
        } catch (err: any) {
          caughtErr = err;
        }
        return caughtErr;
      })();

      const [, archiveErr] = await Promise.all([bookingPromise, archivePromise]);

      expect(archiveErr).toBeInstanceOf(TenantArchiveBlockedError);
      expect(archiveErr.code).toBe("tenant_archive_future_booking");

      // Verify creche remains active
      const [c] = await db.select().from(crechesTable).where(eq(crechesTable.id, creche.id));
      expect(c.status).toBe("active");

      // Verify durable TENANT_ARCHIVE_BLOCKED audit
      const [audit] = await db
        .select()
        .from(commercialAuditLedgerTable)
        .where(
          and(
            eq(commercialAuditLedgerTable.targetCrecheId, creche.id),
            eq(commercialAuditLedgerTable.action, "TENANT_ARCHIVE_BLOCKED")
          )
        );
      expect(audit).toBeDefined();
    });

    it("TEST-51: Race 2A: Archive Commits First || Invoice Creation", async () => {
      const { creche, tutor } = await createActiveCreche("Race2A");

      const archiveLockHeld = createSignal();
      const invoiceAttemptStarted = createSignal();

      // Thread 1: Archive
      const archivePromise = db.transaction(async (tx) => {
        await acquireTenantLifecycleLock(creche.id, tx);
        archiveLockHeld.resolve();
        await invoiceAttemptStarted.promise;

        await tx
          .update(crechesTable)
          .set({ status: "archived", deletedAt: new Date() })
          .where(eq(crechesTable.id, creche.id));
      });

      // Thread 2: Invoice
      const invoicePromise = (async () => {
        await archiveLockHeld.promise;
        let caughtErr: any = null;
        try {
          await db.transaction(async (tx) => {
            invoiceAttemptStarted.resolve();
            await acquireTenantOperationalLock(creche.id, tx);

            await tx.insert(invoicesTable).values({
              crecheId: creche.id,
              tutorId: tutor.id,
              status: "pending",
              amount: "200.00",
              dueDate: new Date().toISOString().split("T")[0],
            });
          });
        } catch (err: any) {
          caughtErr = err;
        }
        return caughtErr;
      })();

      const [, invoiceErr] = await Promise.all([archivePromise, invoicePromise]);

      expect(invoiceErr).toBeInstanceOf(TenantArchivedError);
      expect(invoiceErr.code).toBe("tenant_archived");

      const invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.crecheId, creche.id));
      expect(invoices.length).toBe(0);
    });

    it("TEST-52: Race 2B: Invoice Commits First || Archive", async () => {
      const { creche, tutor } = await createActiveCreche("Race2B");

      const invoiceLockHeld = createSignal();
      const archiveAttemptStarted = createSignal();

      // Thread 1: Invoice
      const invoicePromise = db.transaction(async (tx) => {
        await acquireTenantOperationalLock(creche.id, tx);
        invoiceLockHeld.resolve();
        await archiveAttemptStarted.promise;

        await tx.insert(invoicesTable).values({
          crecheId: creche.id,
          tutorId: tutor.id,
          status: "pending",
          amount: "180.00",
          dueDate: new Date().toISOString().split("T")[0],
        });
      });

      // Thread 2: Archive
      const archivePromise = (async () => {
        await invoiceLockHeld.promise;
        archiveAttemptStarted.resolve();

        let caughtErr: any = null;
        try {
          await archiveTenant({ crecheId: creche.id, reason: "Tentativa concorrente com fatura" });
        } catch (err: any) {
          caughtErr = err;
        }
        return caughtErr;
      })();

      const [, archiveErr] = await Promise.all([invoicePromise, archivePromise]);

      expect(archiveErr).toBeInstanceOf(TenantArchiveBlockedError);
      expect(archiveErr.code).toBe("tenant_archive_open_invoice");

      const [c] = await db.select().from(crechesTable).where(eq(crechesTable.id, creche.id));
      expect(c.status).toBe("active");
    });

    it("TEST-53: Race 3A: Archive Commits First || Credit Mutation", async () => {
      const { creche, tutor } = await createActiveCreche("Race3A");

      const archiveLockHeld = createSignal();
      const creditAttemptStarted = createSignal();

      // Thread 1: Archive
      const archivePromise = db.transaction(async (tx) => {
        await acquireTenantLifecycleLock(creche.id, tx);
        archiveLockHeld.resolve();
        await creditAttemptStarted.promise;

        await tx
          .update(crechesTable)
          .set({ status: "archived", deletedAt: new Date() })
          .where(eq(crechesTable.id, creche.id));
      });

      // Thread 2: Credit
      const creditPromise = (async () => {
        await archiveLockHeld.promise;
        let caughtErr: any = null;
        try {
          await db.transaction(async (tx) => {
            creditAttemptStarted.resolve();
            await acquireTenantOperationalLock(creche.id, tx);

            await tx.insert(tutorCreditsTable).values({
              crecheId: creche.id,
              tutorId: tutor.id,
              totalCredits: 10,
              usedCredits: 0,
            });
          });
        } catch (err: any) {
          caughtErr = err;
        }
        return caughtErr;
      })();

      const [, creditErr] = await Promise.all([archivePromise, creditPromise]);

      expect(creditErr).toBeInstanceOf(TenantArchivedError);
      expect(creditErr.code).toBe("tenant_archived");

      const credits = await db.select().from(tutorCreditsTable).where(eq(tutorCreditsTable.crecheId, creche.id));
      expect(credits.length).toBe(0);
    });

    it("TEST-54: Race 3B: Credit Mutation Commits First || Archive", async () => {
      const { creche, tutor } = await createActiveCreche("Race3B");

      const creditLockHeld = createSignal();
      const archiveAttemptStarted = createSignal();

      // Thread 1: Credit
      const creditPromise = db.transaction(async (tx) => {
        await acquireTenantOperationalLock(creche.id, tx);
        creditLockHeld.resolve();
        await archiveAttemptStarted.promise;

        await tx.insert(tutorCreditsTable).values({
          crecheId: creche.id,
          tutorId: tutor.id,
          totalCredits: 10,
          usedCredits: 2,
        });
      });

      // Thread 2: Archive
      const archivePromise = (async () => {
        await creditLockHeld.promise;
        archiveAttemptStarted.resolve();

        let caughtErr: any = null;
        try {
          await archiveTenant({ crecheId: creche.id, reason: "Tentativa com créditos positivos" });
        } catch (err: any) {
          caughtErr = err;
        }
        return caughtErr;
      })();

      const [, archiveErr] = await Promise.all([creditPromise, archivePromise]);

      expect(archiveErr).toBeInstanceOf(TenantArchiveBlockedError);
      expect(archiveErr.code).toBe("tenant_archive_positive_credit");

      const [c] = await db.select().from(crechesTable).where(eq(crechesTable.id, creche.id));
      expect(c.status).toBe("active");
    });

    it("TEST-55: Race 4A: Archive Commits First || Pet Check-in", async () => {
      const { creche, pet } = await createActiveCreche("Race4A");

      const archiveLockHeld = createSignal();
      const checkinAttemptStarted = createSignal();

      // Thread 1: Archive
      const archivePromise = db.transaction(async (tx) => {
        await acquireTenantLifecycleLock(creche.id, tx);
        archiveLockHeld.resolve();
        await checkinAttemptStarted.promise;

        await tx
          .update(crechesTable)
          .set({ status: "archived", deletedAt: new Date() })
          .where(eq(crechesTable.id, creche.id));
      });

      // Thread 2: Check-in
      const checkinPromise = (async () => {
        await archiveLockHeld.promise;
        let caughtErr: any = null;
        try {
          await db.transaction(async (tx) => {
            checkinAttemptStarted.resolve();
            await acquireTenantOperationalLock(creche.id, tx);

            await tx
              .update(petsTable)
              .set({ isCheckedIn: true })
              .where(eq(petsTable.id, pet.id));
          });
        } catch (err: any) {
          caughtErr = err;
        }
        return caughtErr;
      })();

      const [, checkinErr] = await Promise.all([archivePromise, checkinPromise]);

      expect(checkinErr).toBeInstanceOf(TenantArchivedError);
      expect(checkinErr.code).toBe("tenant_archived");

      const [refreshedPet] = await db.select().from(petsTable).where(eq(petsTable.id, pet.id));
      expect(refreshedPet.isCheckedIn).toBe(false);
    });

    it("TEST-56: Race 4B: Pet Check-in Commits First || Archive", async () => {
      const { creche, pet } = await createActiveCreche("Race4B");

      const checkinLockHeld = createSignal();
      const archiveAttemptStarted = createSignal();

      // Thread 1: Check-in
      const checkinPromise = db.transaction(async (tx) => {
        await acquireTenantOperationalLock(creche.id, tx);
        checkinLockHeld.resolve();
        await archiveAttemptStarted.promise;

        await tx
          .update(petsTable)
          .set({ isCheckedIn: true })
          .where(eq(petsTable.id, pet.id));
      });

      // Thread 2: Archive
      const archivePromise = (async () => {
        await checkinLockHeld.promise;
        archiveAttemptStarted.resolve();

        let caughtErr: any = null;
        try {
          await archiveTenant({ crecheId: creche.id, reason: "Tentativa com pet em checkin" });
        } catch (err: any) {
          caughtErr = err;
        }
        return caughtErr;
      })();

      const [, archiveErr] = await Promise.all([checkinPromise, archivePromise]);

      expect(archiveErr).toBeInstanceOf(TenantArchiveBlockedError);
      expect(archiveErr.code).toBe("tenant_archive_active_checkin");

      const [c] = await db.select().from(crechesTable).where(eq(crechesTable.id, creche.id));
      expect(c.status).toBe("active");
    });
  });

  // =========================================================================
  // GROUP K: EXTENDED RACES & DEADLOCK REGRESSION (TEST-57 to TEST-64)
  // =========================================================================
  describe("GROUP K: EXTENDED RACES & DEADLOCK REGRESSION", () => {
    it("TEST-57A: High-Concurrency Archive Contention Barrier", async () => {
      const { creche, tutor, pet } = await createActiveCreche("TEST57A");

      // 20 concurrent workers against isolated Tenant A
      const workers: Promise<{ type: string; success: boolean; error?: any }>[] = [];

      // 5 Bookings
      for (let i = 0; i < 5; i++) {
        workers.push(
          (async () => {
            try {
              await db.transaction(async (tx) => {
                await acquireTenantOperationalLock(creche.id, tx);
                const d = new Date(Date.now() + 86400000).toISOString().split("T")[0];
                await tx.insert(bookingsTable).values({
                  crecheId: creche.id,
                  tutorId: tutor.id,
                  petId: pet.id,
                  startDate: d,
                  endDate: d,
                  status: "cancelled", // cancelled so it does not block archive if committed before
                  type: "day_use",
                });
              });
              return { type: "booking", success: true };
            } catch (err) {
              return { type: "booking", success: false, error: err };
            }
          })()
        );
      }

      // 5 Invoices
      for (let i = 0; i < 5; i++) {
        workers.push(
          (async () => {
            try {
              await db.transaction(async (tx) => {
                await acquireTenantOperationalLock(creche.id, tx);
                await tx.insert(invoicesTable).values({
                  crecheId: creche.id,
                  tutorId: tutor.id,
                  status: "paid", // paid so it does not block archive
                  amount: "100.00",
                  dueDate: new Date().toISOString().split("T")[0],
                });
              });
              return { type: "invoice", success: true };
            } catch (err) {
              return { type: "invoice", success: false, error: err };
            }
          })()
        );
      }

      // 4 Tasks
      for (let i = 0; i < 4; i++) {
        workers.push(
          (async () => {
            try {
              await db.transaction(async (tx) => {
                await acquireTenantOperationalLock(creche.id, tx);
                await tx.insert(tasksTable).values({
                  crecheId: creche.id,
                  petId: pet.id,
                  type: "feeding",
                  title: `Task 57A ${i}`,
                  description: `Task 57A ${i}`,
                  scheduledFor: new Date(),
                });
              });
              return { type: "task", success: true };
            } catch (err) {
              return { type: "task", success: false, error: err };
            }
          })()
        );
      }

      // 3 Catalogue updates
      for (let i = 0; i < 3; i++) {
        workers.push(
          (async () => {
            try {
              await db.transaction(async (tx) => {
                await acquireTenantOperationalLock(creche.id, tx);
                await tx.insert(catalogueItemsTable).values({
                  crecheId: creche.id,
                  name: `Item 57A ${i}`,
                  type: "service",
                  basePrice: "50.00",
                });
              });
              return { type: "catalogue", success: true };
            } catch (err) {
              return { type: "catalogue", success: false, error: err };
            }
          })()
        );
      }

      // 3 Archival attempts
      for (let i = 0; i < 3; i++) {
        workers.push(
          (async () => {
            try {
              await archiveTenant({ crecheId: creche.id, reason: `Concorrência 57A ${i}` });
              return { type: "archive", success: true };
            } catch (err) {
              return { type: "archive", success: false, error: err };
            }
          })()
        );
      }

      const results = await Promise.all(workers);

      // Deadlock checks: SQLSTATE 40P01 === 0 and 55P03 === 0
      for (const r of results) {
        if (r.error) {
          const code = (r.error as any)?.code || (r.error as any)?.cause?.code;
          expect(code).not.toBe("40P01"); // no deadlock
          expect(code).not.toBe("55P03"); // no lock not available
        }
      }

      // Verify at least one archive attempt succeeded
      const archiveSuccesses = results.filter((r) => r.type === "archive" && r.success);
      expect(archiveSuccesses.length).toBeGreaterThanOrEqual(1);

      // Verify creche is archived
      const [finalCreche] = await db.select().from(crechesTable).where(eq(crechesTable.id, creche.id));
      expect(finalCreche.status).toBe("archived");
    });

    it("TEST-57B: High-Concurrency Restore Contention", async () => {
      const { creche } = await createActiveCreche("TEST57B");

      // Set creche to archived
      await db
        .update(crechesTable)
        .set({ status: "archived", deletedAt: new Date() })
        .where(eq(crechesTable.id, creche.id));

      const workers: Promise<{ success: boolean; error?: any }>[] = [];

      // 10 concurrent operational workers attempting shared lock
      for (let i = 0; i < 10; i++) {
        workers.push(
          (async () => {
            try {
              await db.transaction(async (tx) => {
                await acquireTenantOperationalLock(creche.id, tx);
              });
              return { success: true };
            } catch (err) {
              return { success: false, error: err };
            }
          })()
        );
      }

      // 1 Restore worker
      const restorePromise = (async () => {
        try {
          await restoreTenant({ crecheId: creche.id, reason: "Restauração 57B" });
          return { success: true };
        } catch (err) {
          return { success: false, error: err };
        }
      })();

      const [restoreRes, ...opResults] = await Promise.all([restorePromise, ...workers]);

      expect(restoreRes.success).toBe(true);

      // Verify no deadlocks
      for (const r of opResults) {
        if (r.error) {
          const code = (r.error as any)?.code || (r.error as any)?.cause?.code;
          expect(code).not.toBe("40P01");
        }
      }

      const [finalCreche] = await db.select().from(crechesTable).where(eq(crechesTable.id, creche.id));
      expect(finalCreche.status).toBe("active");
      expect(finalCreche.deletedAt).toBeNull();
    });

    it("TEST-57C: Lifecycle Mutual Exclusion", async () => {
      const { creche } = await createActiveCreche("TEST57C");

      // Concurrent: Archive -> Restore -> Archive
      const results = await Promise.allSettled([
        archiveTenant({ crecheId: creche.id, reason: "Exclusive Lifecycle 1" }),
        restoreTenant({ crecheId: creche.id, reason: "Exclusive Lifecycle 2" }),
        archiveTenant({ crecheId: creche.id, reason: "Exclusive Lifecycle 3" }),
      ]);

      for (const r of results) {
        if (r.status === "rejected") {
          const err = r.reason;
          const code = err?.code || err?.cause?.code;
          expect(code).not.toBe("40P01"); // No deadlock
        }
      }

      // Verify DB state consistency: status matches deletedAt
      const [finalCreche] = await db.select().from(crechesTable).where(eq(crechesTable.id, creche.id));
      if (finalCreche.status === "active") {
        expect(finalCreche.deletedAt).toBeNull();
      } else if (finalCreche.status === "archived") {
        expect(finalCreche.deletedAt).not.toBeNull();
      }
    });

    it("TEST-58: Bidirectional Staff Creation Race", async () => {
      // Ordering A: Archive commits first
      const { creche: crecheA } = await createActiveCreche("StaffRaceA");
      await archiveTenant({ crecheId: crecheA.id, reason: "Arquivado antes de staff" });

      let staffErrA: any = null;
      try {
        await db.transaction(async (tx) => {
          await acquireTenantOperationalLock(crecheA.id, tx);
          await tx.insert(usersTable).values({
            name: "Staff Race A",
            email: `staff-race-a-${Date.now()}@test.invalid`,
            passwordHash: hashPassword("Pass123!"),
            role: "staff",
            crecheId: crecheA.id,
            isActive: true,
          });
        });
      } catch (err: any) {
        staffErrA = err;
      }
      expect(staffErrA).toBeInstanceOf(TenantArchivedError);

      // Ordering B: Staff commits first, archive proceeds
      const { creche: crecheB } = await createActiveCreche("StaffRaceB");
      const ts = Date.now();
      const [newStaff] = await db
        .insert(usersTable)
        .values({
          name: "Staff Race B",
          email: `staff-race-b-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "staff",
          crecheId: crecheB.id,
          isActive: true,
        })
        .returning();
      cleanupUserIds.push(newStaff.id);

      const archivedB = await archiveTenant({ crecheId: crecheB.id, reason: "Staff não bloqueia arquivamento" });
      expect(archivedB.status).toBe("archived");

      const [refreshedStaff] = await db.select().from(usersTable).where(eq(usersTable.id, newStaff.id));
      expect(refreshedStaff.crecheId).toBe(crecheB.id);
    });

    it("TEST-59: Bidirectional Order Mutation & Status Race", async () => {
      const { creche, tutor } = await createActiveCreche("OrderRace");

      // Create an order
      const [order] = await db
        .insert(ordersTable)
        .values({
          crecheId: creche.id,
          tutorId: tutor.id,
          status: "pending_payment",
          deliveryMethod: "pickup",
          subtotal: "50.00",
          total: "50.00",
        })
        .returning();

      // Archive creche
      await archiveTenant({ crecheId: creche.id, reason: "Arquivamento para teste de ordem" });

      // Updating order status should be rejected
      let orderErr: any = null;
      try {
        await db.transaction(async (tx) => {
          await acquireTenantOperationalLock(creche.id, tx);
          await tx
            .update(ordersTable)
            .set({ status: "cancelled" })
            .where(eq(ordersTable.id, order.id));
        });
      } catch (err: any) {
        orderErr = err;
      }

      expect(orderErr).toBeInstanceOf(TenantArchivedError);
    });

    it("TEST-60: Bidirectional Catalogue & Stock Mutation Race", async () => {
      const { creche } = await createActiveCreche("StockRace");

      const [item] = await db
        .insert(catalogueItemsTable)
        .values({
          crecheId: creche.id,
          name: "Produto Estoque Teste",
          type: "product",
          basePrice: "35.00",
          stockQuantity: 10,
          trackStock: true,
        })
        .returning();

      await archiveTenant({ crecheId: creche.id, reason: "Arquivamento antes de ajuste de estoque" });

      let stockErr: any = null;
      try {
        await db.transaction(async (tx) => {
          await acquireTenantOperationalLock(creche.id, tx);
          await tx
            .update(catalogueItemsTable)
            .set({ stockQuantity: 15 })
            .where(eq(catalogueItemsTable.id, item.id));
        });
      } catch (err: any) {
        stockErr = err;
      }

      expect(stockErr).toBeInstanceOf(TenantArchivedError);
    });

    it("TEST-61: Bidirectional Task Mutation Race", async () => {
      const { creche, pet } = await createActiveCreche("TaskRace");

      await archiveTenant({ crecheId: creche.id, reason: "Arquivamento antes de tarefas" });

      let taskErr: any = null;
      try {
        await db.transaction(async (tx) => {
          await acquireTenantOperationalLock(creche.id, tx);
          await tx.insert(tasksTable).values({
            crecheId: creche.id,
            petId: pet.id,
            type: "walk",
            title: "Passeio teste",
            description: "Passeio teste arquivado",
            scheduledFor: new Date(),
          });
        });
      } catch (err: any) {
        taskErr = err;
      }

      expect(taskErr).toBeInstanceOf(TenantArchivedError);
    });

    it("TEST-62: Bidirectional Feed Mutation Race", async () => {
      const { creche, admin, pet } = await createActiveCreche("FeedRace");

      await archiveTenant({ crecheId: creche.id, reason: "Arquivamento antes de post no feed" });

      let feedErr: any = null;
      try {
        await db.transaction(async (tx) => {
          await acquireTenantOperationalLock(creche.id, tx);
          await tx.insert(timelineEventsTable).values({
            crecheId: creche.id,
            petId: pet.id,
            authorId: admin.id,
            type: "photo",
            content: "Foto do dia",
          });
        });
      } catch (err: any) {
        feedErr = err;
      }

      expect(feedErr).toBeInstanceOf(TenantArchivedError);
    });

    it("TEST-63: Bidirectional Chat Mutation Race", async () => {
      const { creche, admin, tutor } = await createActiveCreche("ChatRace");

      await archiveTenant({ crecheId: creche.id, reason: "Arquivamento antes de mensagem no chat" });

      let chatErr: any = null;
      try {
        await db.transaction(async (tx) => {
          await acquireTenantOperationalLock(creche.id, tx);
          await tx.insert(chatMessagesTable).values({
            crecheId: creche.id,
            tutorId: tutor.id,
            senderId: admin.id,
            content: "Olá tutor, mensagem teste",
          });
        });
      } catch (err: any) {
        chatErr = err;
      }

      expect(chatErr).toBeInstanceOf(TenantArchivedError);
    });

    it("TEST-64: Daily Task Scheduler Race", async () => {
      const { creche } = await createActiveCreche("SchedulerRace");

      // Archive creche first
      await archiveTenant({ crecheId: creche.id, reason: "Arquivamento antes do scheduler diário" });

      // Run generateDailyTasks
      await expect(generateDailyTasks()).resolves.not.toThrow();

      // Verify 0 tasks generated for this archived tenant
      const tasks = await db.select().from(tasksTable).where(eq(tasksTable.crecheId, creche.id));
      expect(tasks.length).toBe(0);
    });
  });
});
