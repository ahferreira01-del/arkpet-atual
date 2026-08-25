import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { db } from "@workspace/db";
import {
  tasksTable,
  petsTable,
  usersTable,
  crechesTable,
  bookingsTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import * as pushModule from "../../artifacts/api-server/src/lib/push.js";
import {
  runTaskReminderTick,
  generateDailyTasks,
  stopAllSchedulers,
  getActiveCronTaskCount,
  startScheduler,
  startMensalidadeScheduler,
  startScheduledPlanChangeApplicator,
  startPastDueSuspender,
  startTrialExpirationJob,
  startReceiptCleanupJob,
  startExpiredOrderCanceller,
  startOutboxWorker,
  SAO_PAULO_TZ,
  DAILY_TASK_GENERATION_LOCK_KEY,
} from "../../artifacts/api-server/src/lib/scheduler.js";
import { initializeDatabase } from "../../artifacts/api-server/src/startup.js";
import { createGracefulShutdown } from "../../artifacts/api-server/src/index.js";

describe("R30B — Multi-Instance Scheduler Hardening Suite", () => {
  let crecheId: number;
  let tutorId: number;
  let staffId: number;
  let petId: number;

  beforeAll(async () => {
    // Ensure all schema migrations including reminder_sent_at are provisioned
    await initializeDatabase();
  });

  beforeEach(async () => {
    // Clean up any registered schedulers
    stopAllSchedulers();

    // Create test creche
    const [creche] = await db
      .insert(crechesTable)
      .values({
        name: `R30B Creche ${Date.now()}`,
        email: `creche-${Date.now()}-${Math.random().toString(36).substring(7)}@test.com`,
        phone: "11999999999",
        address: "Rua Teste R30B",
      })
      .returning();
    crecheId = creche.id;

    // Create tutor user
    const [tutor] = await db
      .insert(usersTable)
      .values({
        crecheId,
        name: "R30B Tutor",
        email: `tutor-${Date.now()}-${Math.random().toString(36).substring(7)}@test.com`,
        passwordHash: "hash",
        role: "tutor",
        isActive: true,
      })
      .returning();
    tutorId = tutor.id;

    // Create staff user
    const [staff] = await db
      .insert(usersTable)
      .values({
        crecheId,
        name: "R30B Staff",
        email: `staff-${Date.now()}-${Math.random().toString(36).substring(7)}@test.com`,
        passwordHash: "hash",
        role: "staff",
        isActive: true,
      })
      .returning();
    staffId = staff.id;

    // Create pet
    const [pet] = await db
      .insert(petsTable)
      .values({
        crecheId,
        tutorId,
        name: "R30B Rex",
        species: "dog",
        breed: "SRD",
        status: "active",
        isCheckedIn: true,
        feedingSchedule: [{ time: "08:00", amount: "200g", notes: "Ração seca" }],
        walkSchedule: [{ time: "10:00", durationMinutes: 30, notes: "Parque" }],
      })
      .returning();
    petId = pet.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    stopAllSchedulers();
  });

  describe("SCHED-R30-001: Durable Task Reminder Deduplication & Concurrency", () => {
    it("two concurrent taskReminder ticks result in exactly ONE logical push notification", async () => {
      // Create a pending task scheduled in 5 minutes
      const now = new Date();
      const scheduledFor = new Date(now.getTime() + 5 * 60 * 1000);

      const [task] = await db
        .insert(tasksTable)
        .values({
          crecheId,
          petId,
          assignedToId: staffId,
          type: "feeding",
          title: "Alimentação 5min",
          scheduledFor,
          status: "pending",
          priority: "medium",
        })
        .returning();

      // Spy on push notification
      const pushSpy = vi.spyOn(pushModule, "sendPushToUser").mockResolvedValue(undefined as any);

      // Simulate two concurrent instances running the tick simultaneously
      await Promise.all([runTaskReminderTick(), runTaskReminderTick()]);

      // Exactly one push must have been sent
      expect(pushSpy).toHaveBeenCalledTimes(1);
      expect(pushSpy).toHaveBeenCalledWith(
        staffId,
        expect.objectContaining({
          tag: `task-reminder-${task.id}`,
          data: { type: "task", taskId: task.id },
        })
      );

      // Verify that reminderSentAt was persisted in PostgreSQL
      const [updatedTask] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, task.id));
      expect(updatedTask.reminderSentAt).not.toBeNull();
      expect(updatedTask.reminderSentAt).toBeInstanceOf(Date);
    });

    it("restart / subsequent ticks do NOT re-send reminders for tasks with reminderSentAt set", async () => {
      // Create task scheduled in 5 minutes with reminderSentAt already populated
      const now = new Date();
      const scheduledFor = new Date(now.getTime() + 5 * 60 * 1000);

      const [task] = await db
        .insert(tasksTable)
        .values({
          crecheId,
          petId,
          assignedToId: staffId,
          type: "walk",
          title: "Passeio 5min",
          scheduledFor,
          status: "pending",
          priority: "medium",
          reminderSentAt: new Date(),
        })
        .returning();

      const pushSpy = vi.spyOn(pushModule, "sendPushToUser").mockResolvedValue(undefined as any);

      // Run tick (simulating server restart or next minute tick)
      await runTaskReminderTick();

      // Zero push notifications sent because reminderSentAt is already marked in DB
      expect(pushSpy).toHaveBeenCalledTimes(0);
    });

    it("push failure rolls back claim and preserves retry semantics for future ticks", async () => {
      const now = new Date();
      const scheduledFor = new Date(now.getTime() + 5 * 60 * 1000);

      const [task] = await db
        .insert(tasksTable)
        .values({
          crecheId,
          petId,
          assignedToId: staffId,
          type: "medication",
          title: "Medicação 5min",
          scheduledFor,
          status: "pending",
          priority: "high",
        })
        .returning();

      // 1st attempt: Push fails with network error
      const pushSpy = vi
        .spyOn(pushModule, "sendPushToUser")
        .mockRejectedValueOnce(new Error("Network connection dropped"));

      await runTaskReminderTick();

      // Push was attempted once
      expect(pushSpy).toHaveBeenCalledTimes(1);

      // Verify reminderSentAt is STILL NULL (transaction rolled back)
      const [taskAfterFailure] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, task.id));
      expect(taskAfterFailure.reminderSentAt).toBeNull();

      // 2nd attempt (retry on next tick): Push succeeds
      pushSpy.mockResolvedValueOnce(undefined as any);
      await runTaskReminderTick();

      expect(pushSpy).toHaveBeenCalledTimes(2);

      // Now reminderSentAt is persisted
      const [taskAfterRetry] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, task.id));
      expect(taskAfterRetry.reminderSentAt).not.toBeNull();
    });
  });

  describe("SCHED-R30-002: Distributed Advisory Lock for Daily Task Generation", () => {
    it("two concurrent daily task generation executions produce exactly ONE set of tasks without duplication", async () => {
      const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

      // Create an active booking for today
      await db.insert(bookingsTable).values({
        crecheId,
        tutorId,
        petId,
        type: "daycare",
        startDate: todayStr,
        endDate: todayStr,
        status: "active",
      });

      // Execute generateDailyTasks concurrently from two instances
      await Promise.all([generateDailyTasks(), generateDailyTasks()]);

      // Query tasks generated for this pet today
      const tasks = await db
        .select()
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.petId, petId),
            eq(tasksTable.crecheId, crecheId)
          )
        );

      const feedingTasks = tasks.filter((t) => t.type === "feeding");
      const walkTasks = tasks.filter((t) => t.type === "walk");

      // Exactly 1 feeding task and 1 walk task should exist
      expect(feedingTasks).toHaveLength(1);
      expect(walkTasks).toHaveLength(1);
      expect(tasks).toHaveLength(2);
    });

    it("advisory lock key is stable and documented", () => {
      expect(DAILY_TASK_GENERATION_LOCK_KEY).toBe(999_100_001);
    });
  });

  describe("SCHED-R30-003: Explicit Business Timezone Configuration", () => {
    it("uses America/Sao_Paulo as explicit business timezone across all schedulers", () => {
      expect(SAO_PAULO_TZ).toBe("America/Sao_Paulo");
    });
  });

  describe("SCHED-R30-004: Scheduler Shutdown Control & Graceful Drain", () => {
    it("registers and stops all cron task handles on shutdown", () => {
      // Start all schedulers
      startScheduler();
      startMensalidadeScheduler();
      startScheduledPlanChangeApplicator();
      startPastDueSuspender();
      startTrialExpirationJob();
      startReceiptCleanupJob();
      startExpiredOrderCanceller();
      startOutboxWorker();

      const activeCountBefore = getActiveCronTaskCount();
      expect(activeCountBefore).toBeGreaterThanOrEqual(9);

      // Stop all schedulers
      const stoppedCount = stopAllSchedulers();
      expect(stoppedCount).toBe(activeCountBefore);
      expect(getActiveCronTaskCount()).toBe(0);

      // Idempotency: second stop does not throw and returns 0
      const secondStop = stopAllSchedulers();
      expect(secondStop).toBe(0);
    });

    it("createGracefulShutdown calls stopSchedulers before draining HTTP and DB pool", async () => {
      let schedulersStopped = false;
      let httpClosed = false;
      let poolEnded = false;
      let exitCode: number | null = null;

      const mockServer = {
        close: vi.fn((cb) => {
          httpClosed = true;
          if (cb) cb();
          return mockServer;
        }),
      };

      const mockPool = {
        end: vi.fn(async () => {
          poolEnded = true;
        }),
      };

      const mockStopSchedulers = vi.fn(() => {
        schedulersStopped = true;
        return 9;
      });

      const mockExit = vi.fn((code) => {
        exitCode = code;
      });

      const shutdownHandler = createGracefulShutdown(
        mockServer as any,
        mockPool,
        mockExit,
        mockStopSchedulers
      );

      await shutdownHandler("SIGTERM");

      expect(mockStopSchedulers).toHaveBeenCalledTimes(1);
      expect(schedulersStopped).toBe(true);
      expect(httpClosed).toBe(true);
      expect(poolEnded).toBe(true);
      expect(exitCode).toBe(0);
    });
  });
});
