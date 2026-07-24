import { sql } from 'drizzle-orm';
import { db } from '@workspace/db';

async function up() {
  console.log("Creating financial indexes...");
  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS 
    idx_invoices_creche_id ON invoices(creche_id);
    
    CREATE INDEX CONCURRENTLY IF NOT EXISTS 
    idx_invoices_tutor_id ON invoices(tutor_id);
    
    CREATE INDEX CONCURRENTLY IF NOT EXISTS 
    idx_invoices_status ON invoices(status);
    
    CREATE INDEX CONCURRENTLY IF NOT EXISTS 
    idx_invoices_due_date ON invoices(due_date);
    
    CREATE INDEX CONCURRENTLY IF NOT EXISTS 
    idx_transactions_creche_id ON transactions(creche_id);
    
    CREATE INDEX CONCURRENTLY IF NOT EXISTS 
    idx_booking_consumables_booking_id 
    ON booking_consumables(booking_id);
    
    CREATE INDEX CONCURRENTLY IF NOT EXISTS 
    idx_tutor_credits_tutor_id ON tutor_credits(tutor_id);
    
    CREATE INDEX CONCURRENTLY IF NOT EXISTS 
    idx_audit_logs_creche_id ON financial_audit_logs(creche_id);

    CREATE INDEX CONCURRENTLY IF NOT EXISTS 
    idx_transactions_creche_date 
    ON transactions(creche_id, transaction_date);
    
    CREATE INDEX CONCURRENTLY IF NOT EXISTS 
    idx_invoices_creche_status 
    ON invoices(creche_id, status);
  `);
  console.log("Indexes created successfully.");
  process.exit(0);
}

up().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
