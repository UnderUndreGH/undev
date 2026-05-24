# Feature Specification: AI Copilot Custom OpenAI-Compatible Provider

**Feature Branch**: `020-ai-custom-provider`  
**Created**: 2025-05-24  
**Status**: Draft  
**Input**: Add OpenAI-compatible provider type to AI Copilot so users can plug in Azure OpenAI, OpenRouter, LM Studio, vLLM, llama.cpp server, etc. via custom baseURL. Support custom baseURL for Anthropic as well.

## Context

The AI Copilot already has a pluggable provider architecture at the service layer with support for Anthropic, OpenAI, and Ollama. The settings UI (`AiSettingsSection.tsx`) already supports CRUD operations for provider keys, test connectivity, and budget controls. Encryption for API keys uses AES-256-GCM (same pattern as `ai_provider_keys` table).

However, users who run local models (LM Studio, llama.cpp), use proxy services (OpenRouter), or connect to enterprise deployments (Azure OpenAI, vLLM) cannot configure these endpoints because the current provider types are hardcoded to official API endpoints.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure a Local LLM Provider (Priority: P1)

A user running LM Studio or llama.cpp server locally wants to use their local model with the AI Copilot for incident analysis and chat. They navigate to Settings, add a new provider, select "OpenAI-Compatible", enter their local endpoint URL (e.g., `http://localhost:1234/v1`), and test connectivity.

**Why this priority**: Local/self-hosted LLM usage is growing rapidly. This unlocks the largest set of new users.

**Independent Test**: Start a local OpenAI-compatible server, configure it in Settings, run test connectivity, verify round-trip success.

**Acceptance Scenarios**:

1. **Given** a local OpenAI-compatible server is running, **When** the user adds an "OpenAI-Compatible" provider with the local URL and model name, **Then** test connectivity succeeds.
2. **Given** a configured OpenAI-Compatible provider, **When** the user triggers an AI Copilot chat, **Then** the response comes from the local model.
3. **Given** the local server is unreachable, **When** test connectivity is run, **Then** a clear error message indicates the endpoint is unreachable.

---

### User Story 2 - Configure a Cloud Proxy Service (Priority: P2)

A user wants to use OpenRouter or Azure OpenAI as their provider. They enter the provider-specific baseURL, their API key, and the model identifier. The system connects and works identically to the built-in OpenAI provider.

**Why this priority**: Cloud proxy services offer access to many models through a single endpoint. Common enterprise use case.

**Independent Test**: Configure OpenRouter endpoint with valid credentials, verify chat completion works.

**Acceptance Scenarios**:

1. **Given** the user has an OpenRouter API key, **When** they add an "OpenAI-Compatible" provider with OpenRouter's base URL and a model ID, **Then** test connectivity succeeds and chat works.
2. ~~**Given** the user has Azure OpenAI credentials~~ — **DEFERRED**: Azure OpenAI requires a dedicated provider type (separate auth model). Will be addressed in a future spec.

---

### User Story 3 - Use Anthropic with Custom Base URL (Priority: P3)

A user running an Anthropic-compatible proxy or enterprise gateway wants to use it with a custom base URL while keeping the Anthropic protocol behavior.

**Why this priority**: Extends existing Anthropic support to enterprise/proxy scenarios. Lower priority because official Anthropic API already works.

**Independent Test**: Configure Anthropic provider with a custom gateway URL, verify requests route correctly.

**Acceptance Scenarios**:

1. **Given** an Anthropic-compatible proxy is running, **When** the user configures the Anthropic provider with the proxy URL, **Then** requests are routed through the proxy.
2. **Given** the custom Anthropic endpoint is down, **When** a request is made, **Then** the error is clearly attributed to the custom endpoint.

---

### Edge Cases

- What happens if the baseURL is malformed? — Validate URL format on save; reject with clear error message.
- What happens if the custom endpoint returns non-OpenAI-format responses? — Graceful error: "Provider returned unexpected response format. Verify endpoint compatibility."
- What happens if the API key is empty (for local endpoints that don't require auth)? — Allow empty API key for OpenAI-Compatible type; do not require it.
- What happens if two providers share the same model name? — Provider selection is explicit; model name alone does not determine routing.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support a new provider type "OpenAI-Compatible" that accepts a custom base URL.
- **FR-002**: System MUST allow empty/optional API keys for OpenAI-Compatible providers (local endpoints). API key is OPTIONAL for openai-compatible providers — some local endpoints (LM Studio, Ollama) accept any value or empty string. UI displays apikey field as optional with help text "Required for cloud providers, optional for local". `api_key_encrypted` column is nullable.
- **FR-003**: System MUST validate the base URL format when saving provider configuration.
- **FR-003a (SSRF Protection)**: `endpointUrl` MUST be validated against a denylist of private/internal addresses. Block: IPv4 private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), link-local (169.254.0.0/16, fe80::/10), loopback (127.0.0.0/8, ::1), CGNAT (100.64.0.0/10), and DNS hostnames resolving to any of the above (re-validate at request time, not just config time, to prevent DNS rebinding). Reject `localhost`, `*.local`, `*.internal`. Override available via `ALLOW_LOCAL_AI_ENDPOINTS=true` server env var with mandatory audit log entry per request when the override is in effect.
- **FR-004**: System MUST support custom base URL for existing Anthropic provider type.
- **FR-005**: System MUST include a "Test Connectivity" action for custom providers that sends a lightweight request and reports success/failure.
- **FR-006**: System MUST encrypt API keys at rest using AES-256-GCM (same as existing provider keys).
- **FR-007**: System MUST show a custom "Endpoint URL" field in the provider configuration form when OpenAI-Compatible or custom-base-URL Anthropic is selected.
- **FR-008**: System MUST pass the custom base URL and API key to the provider at invocation time for chat completions and tool calls.

### Key Entities

- **Provider Configuration (extended)**: Gains an optional `endpointUrl` field and a new provider type value `openai-compatible`. Existing encryption and budget controls apply unchanged.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: User can configure and test a custom OpenAI-compatible endpoint within 2 minutes.
- **SC-002**: Chat completion round-trip through a custom provider completes within the same latency bounds as built-in providers (plus network overhead).
- **SC-003**: Test connectivity provides a clear pass/fail result within 10 seconds.
- **SC-004**: Existing built-in providers (OpenAI, Anthropic, Ollama) continue to work without any changes.

## Assumptions

- The `@ai-sdk/openai-compatible` package (or equivalent) supports custom base URLs and is compatible with the existing Vercel AI SDK integration.
- Azure OpenAI uses a slightly different URL pattern (`/openai/deployments/{deployment}`) that the OpenAI-compatible SDK handles or can be configured for.
- **Azure OpenAI is OUT OF SCOPE for this spec.** The `openai-compatible` type targets OpenAI-API-compatible servers using standard `Authorization: Bearer` auth (OpenAI, OpenRouter, vLLM, LM Studio, Ollama with OpenAI-compat mode, llama.cpp server). Azure OpenAI support requires a separate `azure-openai` provider type using `@ai-sdk/azure` with `resourceName`+`apiKey`+`apiVersion` fields — deferred to future spec. Users attempting Azure OpenAI URLs will receive a helpful error message directing them to the future provider type.
- Budget controls and rate limiting apply identically to custom providers.
