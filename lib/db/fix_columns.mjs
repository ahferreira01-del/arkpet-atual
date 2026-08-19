import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    await pool.query(`ALTER TABLE bookings ALTER COLUMN type TYPE text`);
    await pool.query(`ALTER TABLE catalogue_items ALTER COLUMN type TYPE text`);
    console.log("Columns altered successfully");
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
