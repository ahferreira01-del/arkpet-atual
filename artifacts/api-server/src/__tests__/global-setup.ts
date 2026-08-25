/**
 * Vitest global setup – runs once before any test file.
 *
 * Inserts the test user + creche directly into the database so the
 * sensitiveLimiter on /auth/register-creche is never hit.
 * Then logs in via HTTP to get a real JWT for use in the tests.
 *
 * `provide` is received as a parameter (not imported); `inject` is used
 * in test files via `import { inject } from "vitest"`.
 */

import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

const PORT = process.env["API_TEST_PORT"] ?? "8080";
const BASE = `http://localhost:${PORT}/api`;

async function apiPost(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, ok: res.ok, body: json as any };
}

export async function setup({
  provide,
}: {
  provide: (key: string, value: unknown) => void;
}) {
  const { db } = await import("@workspace/db");
  const {
    usersTable,
    crechesTable,
    subscriptionsTable,
    plansTable,
  } = await import("@workspace/db/schema");

  const ts = Date.now();
  const email = `e2e-db-${ts}@test.invalid`;
  const password = "Test1234!";
  const passwordHash = bcrypt.hashSync(password, 10);

  // Find the Trial plan (required for subscription row)
  const [trialPlan] = await db
    .select()
    .from(plansTable)
    .where(eq(plansTable.name, "Trial"))
    .limit(1);

  if (!trialPlan) {
    throw new Error(
      "[global-setup] Trial plan not found. Run the seed/migration first.",
    );
  }

  // Insert user
  const [user] = await db
    .insert(usersTable)
    .values({
      name: `E2E Admin ${ts}`,
      email,
      passwordHash,
      role: "creche_admin",
      isActive: true,
      mustChangePassword: false,
    })
    .returning();

  // Insert creche
  const [creche] = await db
    .insert(crechesTable)
    .values({
      name: `Creche E2E ${ts}`,
      address: "Rua de Teste 0",
      phone: "11000000000",
      email,
      adminId: user.id,
      status: "active",
    })
    .returning();

  // Link user → creche
  await db
    .update(usersTable)
    .set({ crecheId: creche.id })
    .where(eq(usersTable.id, user.id));

  // Subscription row (trial)
  const trialEndsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  await db.insert(subscriptionsTable).values({
    crecheId: creche.id,
    planId: trialPlan.id,
    status: "active",
    trialEndsAt,
    currentPeriodEnd: trialEndsAt,
  });

  // Log in via HTTP to get a real JWT
  const login = await apiPost("/auth/login", { email, password });
  if (!login.ok) {
    throw new Error(
      `[global-setup] login failed (${login.status}): ${JSON.stringify(login.body)}`,
    );
  }

  const ctx = {
    token: login.body.token as string,
    userId: login.body.user.id as number,
    crecheId: login.body.user.crecheId as number,
    email,
    password,
  };

  provide("e2eCtx", ctx);

  console.log(
    `[global-setup] Created test creche ${ctx.crecheId} (user ${ctx.userId}) via direct DB insert.`,
  );
}
