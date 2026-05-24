-- ============================================================
-- Feature 018: Amnezia VPN Install Completion
-- Migration: 0018_add_vpn_config_column.sql
-- ============================================================

ALTER TABLE servers ADD COLUMN IF NOT EXISTS vpn_config_encrypted TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS vpn_config_format VARCHAR(10);
