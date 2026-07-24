import { sql } from 'drizzle-orm';
import { db } from './src/index.js';

export async function up() {
  console.log("Starting migration...");
  await db.execute(sql`ALTER TYPE item_type ADD VALUE IF NOT EXISTS 'package';`);
  await db.execute(sql`ALTER TABLE catalogue_items ADD COLUMN IF NOT EXISTS credits_amount INTEGER;`);
  console.log('Migration concluída: package type e credits_amount adicionados')
  process.exit(0);
}

up().catch(err => {
  console.error(err);
  process.exit(1);
});
