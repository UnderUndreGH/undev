-- Feature 013 (H3): GIN index for full-text search on ai_conversations.hypothesis
CREATE INDEX IF NOT EXISTS idx_ai_conversations_hypothesis_fts ON ai_conversations USING GIN (to_tsvector('english', hypothesis));
