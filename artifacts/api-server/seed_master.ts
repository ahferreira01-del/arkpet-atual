import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import bcrypt from "bcryptjs";

async function main() {
  const email = "ahferreira01@gmail.com";
  const plainPassword = "@618033Arc*#";
  const name = "Andre Ferreira (Master)";

  const passwordHash = await bcrypt.hash(plainPassword, 10);

  console.log("Inserting master admin...");
  try {
    await db.insert(usersTable).values({
      name,
      email,
      passwordHash,
      role: "master_admin",
      isActive: true,
      mustChangePassword: false,
    });
    console.log("Master admin created successfully!");
  } catch (error) {
    console.error("Error creating master admin:", error);
  }
  process.exit(0);
}

main();
