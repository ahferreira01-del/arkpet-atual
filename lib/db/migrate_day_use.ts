import { sql } from 'drizzle-orm';
import { db } from './src/index.js';

export async function up() {
  console.log("Starting migration: add day_use to item_type enum...");
  await db.execute(sql`ALTER TYPE item_type ADD VALUE IF NOT EXISTS 'day_use';`);
  console.log('Migration concluída: day_use adicionado ao item_type enum');
  process.exit(0);
}

up().catch(err => {
  console.error(err);
  process.exit(1);
});
