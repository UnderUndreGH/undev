-- Feature 021: Add explicit `kind` column to servers table.
-- Backfill from vpnStatus, then NOT NULL + default + index.

ALTER TABLE servers ADD COLUMN IF NOT EXISTS kind VARCHAR(20);

UPDATE servers SET kind = 'vpn' WHERE vpn_status IS NOT NULL AND vpn_status != 'uninstalled';
UPDATE servers SET kind = 'general' WHERE kind IS NULL;

ALTER TABLE servers ALTER COLUMN kind SET NOT NULL;
ALTER TABLE servers ALTER COLUMN kind SET DEFAULT 'general';

CREATE INDEX IF NOT EXISTS idx_servers_kind ON servers(kind);
