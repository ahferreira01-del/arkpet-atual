import { db, usersTable, crechesTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { hashPassword } from "./lib/auth.js";

export async function initializeDatabase() {
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
