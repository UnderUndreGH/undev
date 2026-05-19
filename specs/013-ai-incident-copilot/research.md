# Research: AI Incident Copilot

**Feature**: 013 | **Date**: 2026-05-19 | **Spec**: [spec.md](spec.md)

## R-001: Multi-provider LLM abstraction — build vs. library

**Decision**: Use **Vercel AI SDK** (`ai` + `@ai-sdk/anthropic` + `@ai-sdk/openai` + `@ai-sdk/openai-compatible`).

**Rationale**: Vercel AI SDK provides a unified `streamText()` / `generateText()` interface across Anthropic, OpenAI, and Ollama (via OpenAI-compatible adapter). Tool-use, streaming, and token counting are normalised — one code path regardless of provider. The SDK's `tool()` helper accepts Zod schemas directly, which aligns with the project's Zod-first validation convention.

**Alternatives considered**:
- **Raw SDKs** (`@anthropic-ai/sdk` + `openai`): maximum control, but duplicates tool-loop logic per provider. Maintenance burden multiplied by provider count.
- **LangChain**: heavy dependency tree, abstracts too much, runtime overhead. Overkill for a well-scoped tool-use pipeline.
- **Custom provider interface**: a bespoke abstraction adds no value because
  Vercel AI SDK already supplies the provider boundary.

**Packages required** (4 new deps, pending user approval):
- `ai` — core SDK
- `@ai-sdk/anthropic` — Claude models
- `@ai-sdk/openai` — GPT models
- `@ai-sdk/openai-compatible` — Ollama via `/v1/chat/completions`

## R-002: Settings storage pattern for AI configuration

**Decision**: New **`ai_settings`** singleton table (CHECK `id = 1`) following the `notification_settings` pattern.

**Rationale**: The spec describes 10 new AI configuration columns. The existing `app_settings` table is a key-value store (one row per key), which would scatter AI config across 10 rows and complicate atomic reads. The `notification_settings` table uses a singleton pattern (CHECK `id = 1`) that maps cleanly to a typed Drizzle schema with column-level defaults and type safety. Replicating this pattern for `ai_settings` gives atomic reads, typed columns, and migration-friendly defaults.

**Alternatives considered**:
- **Columns on `notification_settings`**: conflates notification and AI concerns. Table already has 7 columns; adding 10 more makes it an everything-bucket.
- **Key-value in `app_settings`**: no type safety, no atomic multi-field read, no defaults at schema level.
- **JSON blob in `app_settings`**: single key, but loses column-level migration, defaults, and query-ability.

## R-003: Event bus for push triggers

**Decision**: **Direct function calls** from existing event-emitting code paths into a new `ai-push-subscriber.ts` service. No event bus library.

**Rationale**: The codebase has no `EventEmitter`-based application bus. Cross-concern communication uses direct function calls (e.g., `gate.dispatch()` in notification-gate.ts) and WS broadcast via `channelManager.broadcast()`. Introducing `mitt` or `EventEmitter` for 7 push-trigger event types would add an abstraction nobody else uses. Instead, the existing code paths (health-poller RED transition, deploy failure handlers, cert sweep) gain a single `aiPushSubscriber.onEvent(eventType, context)` call — same pattern as `gate.dispatch()`.

**Alternatives considered**:
- **`mitt` / `EventEmitter` bus**: clean decoupling, but inconsistent with codebase. Would require retrofitting existing notification dispatch to use the same bus for consistency — scope creep.
- **Database-backed queue** (pg `LISTEN/NOTIFY`): durable, but adds complexity for a single-process dashboard. Deferred to v2 horizontal-scaling scenario per spec A-006.

## R-004: Secret masking for LLM context payloads

**Decision**: Extend existing `mask-secrets.ts` with a new **`maskContextDocument(text: string): string`** function that applies regex-based redaction to free-text log/audit/compose content before it enters the LLM context.

**Rationale**: The existing `maskSecrets()` operates on Zod-typed schema fields marked `.describe("secret")` — flat, structured data. LLM context aggregation concatenates raw log lines, audit event details, and compose YAML snippets into a free-text document. These may contain leaked secrets (env vars in logs, API keys in compose `environment:` blocks). A regex-based scrubber (matching `sk-...`, `ghp_...`, `AKIA...`, `-----BEGIN ...`, common `password=...` patterns) is the pragmatic approach. False positives are safe (over-mask is better than under-mask). `ai.context_masking_warning` audit fires when a known-secret pattern is detected (per FR-012).

**Alternatives considered**:
- **Rely solely on existing `maskSecrets()`**: doesn't cover free-text content. Leaves logs and compose YAML unmasked.
- **LLM-side redaction** (ask the LLM to not repeat secrets): unreliable — LLMs are not security controls.
- **Per-source masking** (mask before aggregation): correct but scattered. A single post-aggregation pass is simpler and catches cross-source leaks.

## R-005: Token counting and cost estimation

**Decision**: Use Vercel AI SDK's `usage` property from `streamText()` result. Normalised to `{ inputTokens, outputTokens, totalTokens }` across all providers.

**Rationale**: The SDK handles provider-specific response parsing (Anthropic's `input_tokens`/`output_tokens`, OpenAI's `prompt_tokens`/`completion_tokens`) and exposes a unified shape. Cost estimation computed at conversation completion using the rate-card snapshot from `ai_provider_keys` (or a new `ai_rate_cards` config). Per spec FR-041, trust provider header; mark deltas in audit if drift > 5%.

**Alternatives considered**:
- **Manual tiktoken counting**: client-side token estimation. Inaccurate for Anthropic (different tokeniser). Provider response is ground truth.
- **Separate billing SDK**: no such thing exists for multi-provider. Manual rate-card multiplication is sufficient.

## R-006: Streaming architecture — WS channel reuse

**Decision**: Reuse existing `channelManager.broadcast()` with a new channel pattern `ai:<conversationId>`. Each streaming delta broadcasted as `{ type: "delta", content: string }`. Final message includes `{ type: "complete", usage: {...} }`.

**Rationale**: Existing WS infrastructure supports subscribe/unsubscribe per channel, auth via session cookie, and broadcast to all subscribers. The `job:<jobId>` pattern for script-run streaming is directly analogous. No new WS infrastructure needed.

**Alternatives considered**:
- **SSE (Server-Sent Events)**: simpler protocol, but the codebase is WS-first. Adding SSE creates a second real-time transport to maintain.
- **REST polling**: defeats the purpose of streaming. Acceptable as fallback (per spec — "re-fetches on WS reconnect via REST").

## R-007: Context aggregation — data source access patterns

**Decision**: Context aggregator reads from existing DB tables via Drizzle queries. No new SSH calls, no new probes. Sources and their access patterns:

| Source | Access | Limit |
|---|---|---|
| `audit_entries` | `SELECT ... WHERE targetId = ? ORDER BY timestamp DESC LIMIT 100` | Last 100 for target |
| `app_health_history` | `SELECT ... WHERE appId = ? ORDER BY checkedAt DESC LIMIT 50` | Last 50 points |
| `script_runs` | `SELECT ... WHERE serverId = ? OR appId = ? ORDER BY startedAt DESC LIMIT 5` | Last 5 runs |
| `deployments` | `SELECT ... WHERE appId = ? ORDER BY createdAt DESC LIMIT 5` | Last 5 |
| Compose diff | Bootstrap-orchestrator's existing read-only API (HTTP GET) | Current vs. last-deployed |
| `app_cert_events` | `SELECT ... WHERE appId = ? ORDER BY createdAt DESC LIMIT 20` | Last 20 |

**Rationale**: FR-011 explicitly states "no new probes, no new SSH calls beyond what existing services perform". All data is already in the DB or accessible via existing internal APIs. Aggregation is a read-only query fanout.

## R-008: Sandbox fixture format

**Decision**: TypeScript `Record<string, CannedResponse>` in `server/services/ai/sandbox-fixtures.ts`, keyed by manifest ID (e.g., `"deploy/server-rollback"`). Each entry is a JSON object matching the shape that `scriptsRunner` would return.

**Rationale**: Simple, type-safe, version-controlled. The fixture file ships with the codebase; operators don't configure it. Initial coverage: top manifest entries by expected AI use (`deploy/server-rollback`, `deploy/logs`, `server-ops/health-check`, `db/backup`, `docker/cleanup`, `bootstrap/hard-delete`). Generic fallback: `{ status: "ok", note: "dry-run", exitCode: 0 }`.

**Alternatives considered**:
- **Database-stored fixtures**: overkill for ~20 entries. Adds migration complexity for fixture data.
- **External JSON file**: loses type safety. No benefit over `.ts` export.

## R-009: IncidentView placement (OQ-005)

**Decision**: **Dedicated route `/incidents/:id`** (full-page) + **inline "Analyze with AI" button opens the route in a new tab / navigates**. No modal overlay, no inline panel.

**Rationale**: Incident analysis involves multi-turn conversation, tool-call approval cards, activity timeline — too much UI real estate for an inline panel. A dedicated route gives room for the full IncidentView layout. The `/incidents` list page (US9) becomes the natural home. Consistent with existing patterns: `RunDetail.tsx` is a full-page route, not a panel.

**Alternatives considered**:
- **Inline panel** (sidebar): insufficient space for tool-call cards + timeline + chat. Would cram too much into AppPage/DeploymentDetail.
- **Modal overlay**: blocks interaction with the underlying page. Operator may want to cross-reference other dashboard surfaces while reading the analysis.
