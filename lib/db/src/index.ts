import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  keepAlive: true,
});

// CRITICAL: idle clients in the pool can emit 'error' when the database
// terminates the connection (idle timeout, maintenance, failover, or an
// admin "terminating connection due to administrator command"). Without a
// listener, Node treats this as an unhandled 'error' event and CRASHES the
// entire process — taking the whole API (and every user's login) down until
// the deployment restarts. Handling it here lets the pool quietly discard the
// dead client and create a fresh one on the next query.
pool.on("error", (err) => {
  console.error("[db] idle client error (recovered, pool continues):", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./billing";
