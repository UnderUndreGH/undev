# Implementation Plan: AI Incident Copilot

**Branch**: `013-ai-incident-copilot` | **Date**: 2026-05-19 | **Spec**: [spec.md](spec.md)

## Summary

Add an AI Copilot overlay on the existing DevOps dashboard that aggregates
context from existing data sources (logs, audit, health, deploys, certs,
compose diffs), proposes root-cause hypotheses via LLM inference, and
optionally executes remediation actions through the existing
`scripts-manifest.ts` tool registry — same safety gates, same audit trail.

The story shape is **multi-provider LLM integration + tool-use pipeline +
push/pull trigger system**. The feature is opt-in (`ai_settings.enabled =
false` by default) and adds no runtime overhead when disabled.

Architectural shape:

- **Vercel AI SDK** (`ai` + provider packages) as the LLM abstraction.
  No custom multi-provider wrapper. Tool definitions derived from
  `scripts-manifest.ts` Zod schemas — same type, same validation.
- **No event bus** — push triggers are direct function calls from
  existing event-emitting code (health-poller, deploy failure handlers,
  cert sweep) into `ai-push-subscriber.ts`, following the
  `gate.dispatch()` pattern.
- **Streaming via existing WS** — new channel `ai:<conversationId>`
  broadcasts deltas, tool-call proposals, and completion events.
- **Settings** in a new `ai_settings` singleton table (CHECK id=1),
  following `notification_settings` pattern.
- **Compose reviewer** is hybrid: static lint (zero LLM cost) on
  keystroke + LLM review on explicit button click with content-hash
  cache.
- **Secret masking** extended with regex-based free-text scrubber for
  LLM context payloads plus untrusted-source delimiters to reduce prompt
  injection risk from logs/audit/compose content.

Backwards compatibility: all existing dashboard functionality operates
identically whether AI is enabled or disabled. AI errors never cascade
into deploy, health, or cert subsystems (FR-054).

## Technical Context

**Existing stack** (inherited 001-012):

- Express 5 + React 19 / Vite 8 / Tailwind 4
- drizzle-orm 0.45 + `postgres` 3.4
- `scriptsRunner.runScript(scriptId, serverId, params, userId, opts)`
  (feature 005) — tool-use execution endpoint
- `auditMiddleware` + `audit-actions.ts` catalogue (features 001-012)
- `channelManager.broadcast()` for WS real-time push
- `gate.dispatch()` for TG notifications (feature 011)
- `event-catalogue.ts` for notification event types (feature 011)
- `envelope-cipher.ts` — `seal()`/`open()` for secrets at rest
- `mask-secrets.ts` — Zod-schema-aware secret masking
- `compose-parser.ts` — YAML parse + service detection (feature 009)
- `notification_settings` singleton table pattern (CHECK id=1)
- `app_settings` key-value table
- Pino logger with redact config

**New npm dependencies** (4, pending user approval):

- `ai` — Vercel AI SDK core
- `@ai-sdk/anthropic` — Claude provider
- `@ai-sdk/openai` — GPT provider
- `@ai-sdk/openai-compatible` — Ollama via OpenAI-compat endpoint

**Unknowns resolved in [research.md](research.md)**:

- R-001: Multi-provider abstraction → Vercel AI SDK
- R-002: Settings storage → `ai_settings` singleton table
- R-003: Event bus for push triggers → direct function calls
- R-004: Secret masking for LLM context → regex-based `maskContextDocument()`
  plus untrusted-source delimiting
- R-005: Token counting → Vercel AI SDK unified `usage` property
- R-006: Streaming architecture → existing WS with `ai:<conversationId>` channel
- R-007: Context aggregation → Drizzle queries, no new SSH/probes
- R-008: Sandbox fixtures → TypeScript `Record<manifestId, CannedResponse>`
- R-009: IncidentView placement (OQ-005) → dedicated route `/incidents/:id`

## Project Structure

```
undev/
├── specs/013-ai-incident-copilot/
│   ├── spec.md                                  # [EXISTING]
│   ├── plan.md                                  # [NEW — this file]
│   ├── research.md                              # [NEW — R-001..R-009]
│   ├── data-model.md                            # [NEW — schema, audit, WS events]
│   ├── quickstart.md                            # [NEW — operator walkthrough]
│   ├── checklists/
│   │   └── requirements.md                      # [EXISTING]
│   └── contracts/
│       ├── api.md                               # [NEW — HTTP endpoints]
│       └── llm-provider.md                      # [NEW — Vercel AI SDK patterns]
└── devops-app/
    ├── server/
    │   ├── db/
    │   │   ├── schema.ts                        # [MOD — 7 new tables + 2 modified]
    │   │   └── migrations/
    │   │       └── 0013_ai_incident_copilot.sql # [NEW — 7 CREATE + 2 ALTER]
    │   ├── lib/
    │   │   ├── audit-actions.ts                 # [MOD — 26 new AI audit action types]
    │   │   ├── event-catalogue.ts               # [MOD — 6 new notification triggers]
    │   │   ├── compose-static-lint.ts           # [NEW — 7 static lint rules, zero LLM cost]
    │   │   ├── mask-context-document.ts         # [NEW — regex secret masking for free-text]
    │   │   └── ai-tool-registry.ts              # [NEW — manifest → Vercel AI SDK tool defs]
    │   ├── services/
    │   │   ├── ai/
    │   │   │   ├── providers.ts                 # [NEW — resolveModel() per provider]
    │   │   │   ├── context-aggregator.ts        # [NEW — read-only query fanout]
    │   │   │   ├── incident-analyzer.ts         # [NEW — streamText() orchestration]
    │   │   │   ├── push-subscriber.ts           # [NEW — onEvent() + 5-min dedup map]
    │   │   │   ├── tool-call-dispatcher.ts      # [NEW — approval → scriptsRunner bridge]
    │   │   │   ├── budget-enforcer.ts           # [NEW — monthly + per-incident cap checks]
    │   │   │   ├── compose-reviewer.ts          # [NEW — LLM compose review + cache]
    │   │   │   ├── sandbox-fixtures.ts          # [NEW — canned responses per manifest ID]
    │   │   │   ├── system-prompt.ts             # [NEW — prompt template + tool metadata]
    │   │   │   └── archiver.ts                  # [NEW — daily cron, soft-delete old convos]
    │   │   └── scripts-runner.ts                # [MOD — accept initiated_by + AI linkage cols]
    │   ├── routes/
    │   │   ├── ai-settings.ts                   # [NEW — GET/PUT ai settings + kill switch]
    │   │   ├── ai-providers.ts                  # [NEW — CRUD + test connection]
    │   │   ├── ai-conversations.ts              # [NEW — create, list, get, recover]
    │   │   ├── ai-tool-calls.ts                 # [NEW — approve, reject]
    │   │   ├── ai-compose-review.ts             # [NEW — lint + LLM review + dismiss]
    │   │   ├── ai-spend.ts                      # [NEW — cost dashboard endpoints]
    │   │   ├── apps.ts                          # [MOD — "Analyze with AI" context on GET]
    │   │   └── servers.ts                       # [MOD — PATCH gains ai_read/write_access]
    │   └── scripts-manifest.ts                  # [MOD — add `reversible` field to all entries]
    ├── client/
    │   ├── components/
    │   │   ├── ai/
    │   │   │   ├── IncidentView.tsx             # [NEW — full conversation UI]
    │   │   │   ├── AnalyzeButton.tsx            # [NEW — "Analyze with AI" trigger]
    │   │   │   ├── ToolCallCard.tsx             # [NEW — proposal/approval/result card]
    │   │   │   ├── ToolCallApprovalDialog.tsx   # [NEW — danger-tier confirmation modals]
    │   │   │   ├── ActivityTimeline.tsx         # [NEW — chronological event feed]
    │   │   │   ├── ContextSummary.tsx           # [NEW — aggregated source counts]
    │   │   │   ├── HypothesisPanel.tsx          # [NEW — streaming hypothesis + evidence]
    │   │   │   ├── ComposeReviewPanel.tsx       # [NEW — static + LLM findings list]
    │   │   │   ├── ComposeStaticLintInline.tsx  # [NEW — keystroke-triggered lint]
    │   │   │   ├── CostDashboard.tsx            # [NEW — spend overview + per-convo table]
    │   │   │   ├── AiSettingsSection.tsx        # [NEW — settings page AI section]
    │   │   │   ├── ProviderConfigForm.tsx       # [NEW — add/edit provider + test button]
    │   │   │   ├── KillSwitchBanner.tsx         # [NEW — red banner when engaged]
    │   │   │   ├── SandboxBadge.tsx             # [NEW — DRY-RUN label on cards]
    │   │   │   └── AiBadge.tsx                  # [NEW — "AI analyzed" badge on surfaces]
    │   │   ├── apps/
    │   │   │   ├── AppPage.tsx                  # [MOD — mount AnalyzeButton when health RED]
    │   │   │   └── EditAppForm.tsx              # [MOD — mount ComposeReviewPanel]
    │   │   ├── deploy/
    │   │   │   └── RunDetail.tsx                # [MOD — mount AnalyzeButton on failed deploys]
    │   │   └── servers/
    │   │       └── ServerPage.tsx               # [MOD — mount AnalyzeButton + AI policy section]
    │   ├── hooks/
    │   │   ├── useAiConversation.ts             # [NEW — WS subscription + REST fallback]
    │   │   ├── useAiSettings.ts                 # [NEW — fetch + mutate AI settings]
    │   │   ├── useAiProviders.ts                # [NEW — CRUD providers]
    │   │   ├── useComposeReview.ts              # [NEW — lint + LLM review state]
    │   │   ├── useAiSpend.ts                    # [NEW — cost dashboard data]
    │   │   └── useToolCallApproval.ts           # [NEW — approve/reject with confirmations]
    │   └── pages/
    │       ├── IncidentPage.tsx                 # [NEW — /incidents/:id route]
    │       └── IncidentsListPage.tsx            # [NEW — /incidents route with filters]
    └── tests/
        ├── unit/
        │   ├── compose-static-lint.test.ts      # [NEW — 7 rules × pass/fail cases]
        │   ├── mask-context-document.test.ts    # [NEW — secret pattern + source delimiter detection]
        │   ├── ai-tool-registry.test.ts         # [NEW — manifest → tool conversion]
        │   ├── budget-enforcer.test.ts          # [NEW — monthly + per-incident cap logic]
        │   ├── push-subscriber.test.ts          # [NEW — dedup map, 5-min window, absorb/spawn]
        │   └── sandbox-fixtures.test.ts         # [NEW — fallback coverage]
        └── integration/
            ├── ai-settings.test.ts              # [NEW — CRUD + kill switch]
            ├── ai-providers.test.ts             # [NEW — CRUD + test connection (mocked provider)]
            ├── ai-pull-analysis.test.ts         # [NEW — create conversation, stream, complete]
            ├── ai-push-analysis.test.ts         # [NEW — event → auto-conversation]
            ├── ai-tool-call-approval.test.ts    # [NEW — propose → approve → execute → audit]
            ├── ai-tool-call-policy.test.ts      # [NEW — server policy blocks, lock blocks]
            ├── ai-compose-review.test.ts        # [NEW — static lint + LLM review + cache]
            ├── ai-budget-enforcement.test.ts    # [NEW — cap hit → graceful halt]
            ├── ai-kill-switch.test.ts           # [NEW — engage → block → release]
            ├── ai-sandbox.test.ts               # [NEW — dry-run fixture dispatch]
            └── ai-conversation-history.test.ts  # [NEW — list, filter, archive, recover]
```

## Migration plan

`devops-app/server/db/migrations/0013_ai_incident_copilot.sql` — see
[data-model.md](data-model.md) for full SQL.

Summary:
- 7 new tables: `ai_settings`, `ai_provider_keys`, `ai_conversations`,
  `ai_messages`, `ai_tool_calls`, `ai_dismissed_findings`,
  `ai_compose_review_cache`
- 2 modified tables: `servers` (2 cols), `script_runs` (3 cols)
- 3 indexes on `ai_conversations`, 1 on `ai_tool_calls`
- Singleton seed: `INSERT INTO ai_settings (id) VALUES (1)`

## Constitution Check

No `.specify/memory/constitution.md` in repo. CLAUDE.md Standing Orders +
AGCG serve as proxy (same convention as features 010-012).

| Rule (CLAUDE.md) | Status | Notes |
|---|---|---|
| #1 Never commit/push without request | PASS | Plan is files only |
| #2 Never install packages without approval | PASS | 4 new deps identified, awaiting approval |
| #3 Never use `--force / --yes / -y` | PASS | All destructive flows require typed-confirm |
| #4 Never put secrets in code/commits/logs | PASS | API keys sealed via envelope-cipher; never logged; write-only in UI |
| #5 Never run migrations directly | PASS | `0013` ships as reviewable SQL |
| #6 No destructive without 3x consent | PASS | Tool-call tiers: low=1-click, medium=server-validated typed-ack, high=server-issued challenge + typed-id + 5s cooldown |
| #7 Never read .env unless asked | PASS | Master key consumed via existing boot pattern |
| AGCG: no `as any` | PASS | All types derived from Drizzle schema + Zod |
| AGCG: no `throw new Error()` raw | PASS | Use `AppError.*` factories |
| AGCG: no `console.log` | PASS | Pino with `ctx` |
| AGCG: no swallowed `catch (e) { }` | PASS | All catches log + typed result |
| AGCG: no `req.body.field` without Zod | PASS | Every new route validates body |

**Gate status: PASS.** No waivers.

## Phase 0: Outline & Research

Output: [research.md](research.md). Resolves R-001 through R-009.

Key resolutions:
- **R-001** Vercel AI SDK as multi-provider abstraction — unified
  `streamText()` with tool-use, streaming, and token counting.
- **R-002** `ai_settings` singleton table following `notification_settings`
  pattern — atomic reads, typed columns, migration-friendly defaults.
- **R-003** Direct function calls for push triggers — no event bus library,
  consistent with existing `gate.dispatch()` pattern.
- **R-004** `maskContextDocument()` regex scrubber for free-text — extends
  existing `mask-secrets.ts` for unstructured log/compose content and wraps
  untrusted source blocks so the prompt treats them as evidence, not
  instructions.
- **R-009** IncidentView as dedicated route `/incidents/:id` — sufficient
  real estate for multi-turn conversation + tool-call cards + timeline.

## Phase 1: Design & Contracts

Outputs:

- [data-model.md](data-model.md) — 7 new tables, 2 modified tables, audit
  events, notification triggers, in-memory dedup map, WS channel convention.
- [contracts/api.md](contracts/api.md) — 16 HTTP endpoints across 6 route
  files, WS event types, error codes.
- [contracts/llm-provider.md](contracts/llm-provider.md) — Vercel AI SDK
  patterns: `resolveModel()`, `manifestToAiTools()`, system prompt template,
  token budget enforcement, health probe.
- [quickstart.md](quickstart.md) — 8-step operator walkthrough with
  smoke-checks mapped to SC-001..SC-007.

### Agent context update

The repo has no `.specify/scripts/powershell/update-agent-context.ps1`.
Per convention carried from features 010-012, CLAUDE.md is **not** modified
by this plan.

## Re-evaluate Constitution Check post-design

| Rule | Status |
|---|---|
| All Standing Orders + AGCG | PASS |
| Migration is additive | PASS (CREATE + ALTER ADD only) |
| API keys never in cleartext | PASS (envelope-cipher sealed, write-only UI) |
| LLM context masked before leaving host | PASS (maskContextDocument + source delimiters + audit/block on detection) |
| Tool-call execution uses existing safety gates | PASS (scriptsRunner, deploy_lock, audit, server-side approval challenges) |
| Feature-flagged off by default | PASS (`ai_settings.enabled = false`) |

**Gate status: PASS post-design.** No re-design required.

## Cross-feature coordination

- **Migration sequence**: feature 012 → 0012, this feature → 0013. Merge
  order: `0012 → 0013`.
- **`scripts-manifest.ts`**: this feature adds `reversible: boolean` field
  to `ScriptManifestEntry` type and explicit values to all 19 entries.
- **`audit-actions.ts` catalogue**: this feature adds 26 new `ai.*` event
  types. After merge with features 010-012, total catalogue ≈ 65 events.
- **`event-catalogue.ts`**: this feature adds 6 notification triggers.
- **`script_runs` table**: this feature adds 3 columns (`initiated_by`,
  `ai_conversation_id`, `ai_tool_call_id`). No conflict with features
  005-012 (they don't touch `script_runs` schema).
- **Feature 005 scope lift**: spec 005 declared "no LLM-driven action
  dispatch". This feature lifts that limitation. When shipping, feature
  005's spec.md should be amended with a cross-reference in "Out of Scope".
- **Feature 011 dependency**: `envelope-cipher.ts` master-key seal +
  `notification_preferences` catalogue. Must be merged before 013.
- **Feature 006/008/012 push trigger sources**: these features emit events
  that 013's push subscriber listens to. No code changes to those features
  — 013 adds the subscriber calls.

## Open dependencies

- **Features 005-012 must ship before 013** (or in same merge group):
  013 references `scripts-manifest.ts`, `envelope-cipher.ts`,
  `notification-gate.ts`, `event-catalogue.ts`, `compose-parser.ts`,
  `channelManager`, health-poller, deploy failure handlers, cert sweep.
- **4 new npm packages** require user approval before implementation:
  `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`.

## Stop point

Plan ends at Phase 2. Implementation tasks (Phase 3) are produced by
`/speckit.tasks` from this plan + the spec.

## Generated artifacts

- [plan.md](plan.md) (this file)
- [research.md](research.md)
- [data-model.md](data-model.md)
- [contracts/api.md](contracts/api.md)
- [contracts/llm-provider.md](contracts/llm-provider.md)
- [quickstart.md](quickstart.md)

Suggested next: `/speckit.tasks`.
