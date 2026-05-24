-- Feature 020: AI Copilot Custom OpenAI-Compatible Provider

-- Make api_key_encrypted nullable (openai-compatible providers may not need an API key)
ALTER TABLE ai_provider_keys ALTER COLUMN api_key_encrypted DROP NOT NULL;

-- Add 'openai-compatible' to provider CHECK constraint
ALTER TABLE ai_provider_keys DROP CONSTRAINT ai_provider_keys_provider_check;
ALTER TABLE ai_provider_keys ADD CONSTRAINT ai_provider_keys_provider_check
  CHECK ("provider" IN ('anthropic', 'openai', 'ollama', 'openai-compatible'));
