-- Add cpf and phone columns to users table (defined in schema but missing from DB)
-- These store AES-256-GCM encrypted values; nullable by design.
ALTER TABLE users ADD COLUMN IF NOT EXISTS cpf text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;
