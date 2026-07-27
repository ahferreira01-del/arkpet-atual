-- Performance indexes on foreign key columns
-- Added as part of backend audit to prevent sequential scans on FK joins.
-- These are idempotent (IF NOT EXISTS) and safe to re-run.

-- financial_audit_logs
CREATE INDEX IF NOT EXISTS idx_financial_audit_logs_creche_id ON financial_audit_logs(creche_id);
CREATE INDEX IF NOT EXISTS idx_financial_audit_logs_user_id ON financial_audit_logs(user_id);

-- transactions
CREATE INDEX IF NOT EXISTS idx_transactions_creche_id ON transactions(creche_id);
CREATE INDEX IF NOT EXISTS idx_transactions_invoice_id ON transactions(invoice_id);

-- invoices
CREATE INDEX IF NOT EXISTS idx_invoices_creche_id ON invoices(creche_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tutor_id ON invoices(tutor_id);

-- invoice_items
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);

-- tutor_credits
CREATE INDEX IF NOT EXISTS idx_tutor_credits_creche_id ON tutor_credits(creche_id);
CREATE INDEX IF NOT EXISTS idx_tutor_credits_tutor_id ON tutor_credits(tutor_id);

-- expenses
CREATE INDEX IF NOT EXISTS idx_expenses_creche_id ON expenses(creche_id);

-- catalogue_items
CREATE INDEX IF NOT EXISTS idx_catalogue_items_creche_id ON catalogue_items(creche_id);

-- catalogue_stock_transactions
CREATE INDEX IF NOT EXISTS idx_catalogue_stock_transactions_item_id ON catalogue_stock_transactions(item_id);
CREATE INDEX IF NOT EXISTS idx_catalogue_stock_transactions_creche_id ON catalogue_stock_transactions(creche_id);

-- orders
CREATE INDEX IF NOT EXISTS idx_orders_creche_id ON orders(creche_id);
CREATE INDEX IF NOT EXISTS idx_orders_tutor_id ON orders(tutor_id);

-- order_items
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_catalogue_item_id ON order_items(catalogue_item_id);

-- medical_incidents
CREATE INDEX IF NOT EXISTS idx_medical_incidents_pet_id ON medical_incidents(pet_id);
CREATE INDEX IF NOT EXISTS idx_medical_incidents_creche_id ON medical_incidents(creche_id);

-- subscriptions
CREATE INDEX IF NOT EXISTS idx_subscriptions_creche_id ON subscriptions(creche_id);
