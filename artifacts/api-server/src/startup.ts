import { db, usersTable, crechesTable, plansTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { hashPassword } from "./lib/auth.js";

const DEFAULT_PLANS = [
  { name: "Trial", petLimit: 10, priceBrl: 0, description: "Teste grátis por 10 dias" },
  { name: "Starter", petLimit: 15, priceBrl: 7900, description: "Para creches começando" },
  { name: "Básico", petLimit: 35, priceBrl: 14900, description: "Para creches em crescimento" },
  { name: "Profissional", petLimit: 75, priceBrl: 26900, description: "Para creches consolidadas" },
  { name: "Premium", petLimit: 150, priceBrl: 42900, description: "Para grandes creches" },
  { name: "Enterprise", petLimit: 999999, priceBrl: 64900, description: "Capacidade ilimitada" },
];

export async function seedPlans() {
  const [{ total }] = await db.select({ total: count() }).from(plansTable);
  if (Number(total) > 0) return;
  await db.insert(plansTable).values(DEFAULT_PLANS);
  console.log(`[startup] ${DEFAULT_PLANS.length} planos criados.`);
}

export async function initializeDatabase() {
  await seedPlans();

  if (process.env.NODE_ENV !== "production") return;

  console.log("[startup] Verificando banco de dados de produção...");

  const [{ total }] = await db.select({ total: count() }).from(usersTable);

  if (Number(total) > 0) {
    console.log(`[startup] Banco inicializado. ${total} usuário(s) encontrado(s).`);
    return;
  }

  console.log("[startup] Banco vazio — criando usuário master_admin inicial...");

  const masterEmail = process.env.MASTER_ADMIN_EMAIL ?? "master@arkpet.com.br";
  const masterPassword = process.env.MASTER_ADMIN_PASSWORD ?? "ArkPet@2024!";
  const masterName = process.env.MASTER_ADMIN_NAME ?? "Master Admin";

  await db.insert(usersTable).values({
    name: masterName,
    email: masterEmail,
    passwordHash: hashPassword(masterPassword),
    role: "master_admin",
    mustChangePassword: true,
    isActive: true,
  });

  console.log(`[startup] Master admin criado: ${masterEmail}`);
  console.log(`[startup] ATENÇÃO: troque a senha no primeiro acesso.`);
}
