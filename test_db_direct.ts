import { Pool } from "pg";
const pool = new Pool({
  connectionString: "postgresql://neondb_owner:npg_qP7b6xSrEZnj@ep-hidden-mud-acza1574.sa-east-1.aws.neon.tech/neondb?sslmode=require",
});
async function main() {
  try {
    const res = await pool.query("SELECT * FROM bookings LIMIT 1");
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  }
  pool.end();
}
main();
