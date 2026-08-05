/**
 * Test fixture helpers — direct-DB helpers for creating isolated test data.
 *
 * All helpers use a high-entropy timestamp so parallel test files don't
 * collide on unique constraints (email, invoice cycle, etc.).
 * bcrypt cost factor is set to 4 (minimum) to keep test suite fast.
 */

import { db } from "@workspace/db";
import {
  usersTable,
  catalogueItemsTable,
  financialOutboxTable,
} from "@workspace/db/schema";
import { gte, desc } from "drizzle-orm";
import bcrypt from "bcryptjs";

/** Creates an isolated tutor user in the given creche. */
export async function createTestTutor(crecheId: number) {
  const ts = `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
  const [user] = await db
    .insert(usersTable)
    .values({
      name: `Tutor Teste ${ts}`,
      email: `tutor-${ts}@test.invalid`,
      passwordHash: bcrypt.hashSync("Test1234!", 4),
      role: "tutor",
      crecheId,
      isActive: true,
      mustChangePassword: false,
    })
    .returning();
  return user;
}

/**
 * Creates a catalogue item directly in the DB.
 * Defaults to a service item at R$50.00.
 */
export async function createCatalogueItem(
  crecheId: number,
  overrides: Record<string, any> = {},
) {
  const ts = Date.now();
  const [item] = await db
    .insert(catalogueItemsTable)
    .values({
      crecheId,
      name: `Item Teste ${ts}`,
      type: "service",
      basePrice: "50.00",
      isActive: true,
      stockQuantity: 0,
      maxPetsPerDay: 1,
      ...overrides,
    } as any)
    .returning();
  return item;
}

/**
 * Returns the highest outbox ID before the current operation starts.
 * Use this to "bookmark" the outbox so you can find only events inserted
 * during the test.
 */
export async function bookmarkOutboxId(): Promise<number> {
  const [row] = await db
    .select({ id: financialOutboxTable.id })
    .from(financialOutboxTable)
    .orderBy(desc(financialOutboxTable.id))
    .limit(1);
  return row?.id ?? 0;
}

/**
 * Returns outbox rows with id > sinceId, optionally filtered by eventType.
 * Events are returned newest-first.
 */
export async function getOutboxEventsSince(sinceId: number, eventType?: string) {
  const rows = await db
    .select()
    .from(financialOutboxTable)
    .where(gte(financialOutboxTable.id, sinceId + 1))
    .orderBy(desc(financialOutboxTable.id));

  return eventType ? rows.filter((r) => r.eventType === eventType) : rows;
}
