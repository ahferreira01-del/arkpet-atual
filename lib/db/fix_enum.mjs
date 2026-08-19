import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    await pool.query(`ALTER TYPE item_type ADD VALUE IF NOT EXISTS 'day_use'`);
    console.log("Enum altered successfully");
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
