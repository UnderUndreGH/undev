CREATE TABLE IF NOT EXISTS audit_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details TEXT,
  result TEXT NOT NULL DEFAULT 'success',
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_entries_target ON audit_entries(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_entries_action ON audit_entries(action);
CREATE INDEX IF NOT EXISTS idx_audit_entries_timestamp ON audit_entries(timestamp);
