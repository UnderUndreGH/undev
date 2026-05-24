# API Contracts: AI Custom Provider

**Date**: 2025-05-24
**Spec**: 020-ai-custom-provider

## POST /api/ai/providers (modified)

Create/update a provider. Now accepts `endpointUrl` and `openai-compatible` type.

**Request**:
```json
{
  "type": "openai-compatible",
  "name": "My OpenRouter",
  "apiKey": "sk-or-v1-...",
  "endpointUrl": "https://openrouter.ai/api/v1",
  "model": "anthropic/claude-3-opus"
}
```

**Response** (201):
```json
{
  "id": 5,
  "type": "openai-compatible",
  "name": "My OpenRouter",
  "endpointUrl": "https://openrouter.ai/api/v1",
  "model": "anthropic/claude-3-opus",
  "isActive": true
}
```

**Error** (400 — missing endpointUrl for openai-compatible):
```json
{
  "error": "endpointUrl is required for openai-compatible providers."
}
```

---

## POST /api/ai/providers/:id/test

Test connectivity to a configured provider.

**Response** (200 — success):
```json
{
  "success": true,
  "latencyMs": 1234,
  "model": "anthropic/claude-3-opus",
  "message": "Connection successful"
}
```

**Response** (200 — failure):
```json
{
  "success": false,
  "latencyMs": 5000,
  "error": "Connection refused: ECONNREFUSED 127.0.0.1:8080"
}
```
