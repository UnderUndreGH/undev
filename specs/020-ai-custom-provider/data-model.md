# Data Model: AI Custom Provider

**Date**: 2025-05-24
**Spec**: 020-ai-custom-provider

## Schema Changes

### `ai_provider_keys` table — add `endpointUrl`

```sql
ALTER TABLE ai_provider_keys ADD COLUMN "endpointUrl" TEXT;
```

- `endpointUrl IS NULL` → use provider's default API endpoint
- `endpointUrl IS NOT NULL` → use custom base URL for API calls

### Provider Type Enum Extension

```typescript
type ProviderType = 
  | "openai"
  | "anthropic" 
  | "ollama"
  | "openai-compatible";  // NEW
```

## Validation Rules

- `endpointUrl` must be a valid URL (https:// or http:// for local services)
- When `providerType = "openai-compatible"`, `endpointUrl` is REQUIRED
- When `providerType = "openai" | "anthropic"`, `endpointUrl` is OPTIONAL (overrides default)
- When `providerType = "ollama"`, `endpointUrl` is OPTIONAL (defaults to localhost:11434)

## Migration

```sql
-- 020-add-endpoint-url.sql
ALTER TABLE ai_provider_keys ADD COLUMN IF NOT EXISTS "endpointUrl" TEXT;
```
