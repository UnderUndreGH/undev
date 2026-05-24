ALTER TABLE servers ADD COLUMN IF NOT EXISTS "deletedAt" TEXT;

CREATE INDEX IF NOT EXISTS idx_servers_deleted_at ON servers("deletedAt") WHERE "deletedAt" IS NOT NULL;
