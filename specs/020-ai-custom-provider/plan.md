# Implementation Plan: AI Copilot Custom OpenAI-Compatible Provider

**Branch**: `020-ai-custom-provider` | **Date**: 2025-05-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/020-ai-custom-provider/spec.md`

## Summary

Add an `openai-compatible` provider type to the AI Copilot's pluggable provider system, allowing users to connect any OpenAI-compatible API (Azure OpenAI, OpenRouter, LM Studio, vLLM, llama.cpp server, etc.) via a custom `baseURL`. Also support custom `baseURL` for the existing Anthropic provider. The feature extends the existing provider configuration entity with an optional `endpointUrl` field and adds UI fields for base URL configuration.

## Technical Context

**Language/Version**: TypeScript (Node.js)
**Primary Dependencies**: Vercel AI SDK (`ai` package), `@ai-sdk/openai` (or `@ai-sdk/openai-compatible`), `@ai-sdk/anthropic`
**Storage**: PostgreSQL — existing `ai_provider_keys` table gains `endpointUrl` column
**Testing**: Test connectivity endpoint; manual verification with multiple providers
**Target Platform**: Web dashboard (AI Copilot settings)
**Project Type**: Web application
**Performance Goals**: Same latency as built-in providers + network overhead; connectivity test <10s
**Constraints**: Zero regression on existing built-in providers (OpenAI, Anthropic, Ollama)
**Scale/Scope**: 2 user stories, ~6-8 files touched

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Operator safety first | PASS | Test connectivity before saving; no destructive ops |
| II. Secrets never leak | PASS | API keys already encrypted at rest in `ai_provider_keys` |
| III. Reviewable database changes | PASS | Migration as .sql file |
| IV. Typed boundaries | PASS | Zod validation on provider config; new provider type enum |
| V. Feature flags and rollback posture | PASS | New provider type is additive; existing providers unaffected |
| VI. Independent review gate | DEFERRED | Required before implement |
| VII. Snapshot stages | N/A | No snapshot tooling |

## Project Structure

### Documentation (this feature)

```text
specs/020-ai-custom-provider/
├── plan.md              # This file
├── research.md          # SDK compatibility research
├── data-model.md        # Schema extension
├── contracts/           # API specs
│   └── provider-config.md
└── tasks.md             # Task breakdown
```

### Source Code (repository root)

```text
server/
├── db/
│   └── migrations/
│       └── 020-add-endpoint-url.sql        # endpointUrl column
├── routes/
│   └── ai-providers.ts                     # Provider CRUD + test connectivity
├── services/
│   └── ai-provider-factory.ts              # Provider instantiation with custom baseURL
└── lib/
    └── provider-types.ts                   # Provider type enum + validation

client/
├── components/
│   └── ai/
│       ├── ProviderSettings.tsx             # Settings form with baseURL field
│       └── ProviderTestButton.tsx           # Test connectivity button
└── lib/
    └── ai-api.ts                           # Provider CRUD + test hooks
```

**Structure Decision**: Existing web app. Provider factory pattern already exists — extend with new type.

## Research Decisions

### OpenAI-Compatible SDK
- `@ai-sdk/openai` supports custom `baseURL` parameter out of the box
- For full OpenAI-compatible (not just OpenAI), may need `@ai-sdk/openai-compatible` or just configure `baseURL` on the existing OpenAI provider
- Azure OpenAI uses different URL pattern: `{resource}.openai.azure.com/openai/deployments/{deployment}`
- Both patterns can be handled by a single `baseURL` field

### Anthropic Custom BaseURL
- `@ai-sdk/anthropic` supports custom `baseURL` via constructor option
- Useful for Anthropic API proxies or regional endpoints

### Test Connectivity
- Send a minimal chat completion request (e.g., "Hi" with max_tokens=1)
- Parse response for success/error
- Return pass/fail with latency measurement

## Complexity Tracking

No constitution violations. Small-medium feature (~100-200 LOC). Extends existing patterns.
