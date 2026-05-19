-- Feature 013 (H1): Add per-conversation system prompt override column
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS system_prompt_override TEXT;
