# Tasks: AI Incident Copilot

**Feature**: 013 | **Date**: 2026-05-19 | **Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

## Phase 1: Setup

- [ ] T001 [SETUP] Install npm dependencies: `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible` in `devops-app/` (requires user approval)
- [ ] T002 [DB] Create migration `devops-app/server/db/migrations/0013_ai_incident_copilot.sql` with all 7 new tables + 2 ALTER TABLE statements per data-model.md
- [ ] T003 [DB] Update Drizzle schema `devops-app/server/db/schema.ts` — add `aiSettings`, `aiProviderKeys`, `aiConversations`, `aiMessages`, `aiToolCalls`, `aiDismissedFindings`, `aiComposeReviewCache` tables + modify `servers` (2 cols) and `scriptRuns` (3 cols)
- [ ] T004 [DB] Update migration journal `devops-app/server/db/migrations/meta/_journal.json` — add entry idx 13 for `0013_ai_incident_copilot`
- [ ] T005 [BE] Add `reversible: boolean` field to `ScriptManifestEntry` type and set explicit values on all 19 entries in `devops-app/server/scripts-manifest.ts` per data-model.md with Zod validation

## Phase 2: Foundational (AI core services)

- [ ] T006 [BE] Create `devops-app/server/services/ai/providers.ts` — `resolveModel()` function mapping provider config to Vercel AI SDK model instances (anthropic/openai/ollama) with typed inputs/outputs
- [ ] T007 [BE] Create `devops-app/server/lib/mask-context-document.ts` — regex-based secret masking + prompt-injection-safe source delimiters for free-text LLM context (sk-*, ghp_*, AKIA*, -----BEGIN*, password=*) with typed inputs/outputs
- [ ] T008 [BE] Create `devops-app/server/lib/ai-tool-registry.ts` — `manifestToAiTools()` converting ScriptManifestEntry[] to Vercel AI SDK tool definitions with dangerLevel/reversible metadata in descriptions
- [ ] T009 [BE] Create `devops-app/server/services/ai/system-prompt.ts` — system prompt resolution logic (DB-first with TS fallback) per §15.1, including untrusted-context instructions, confidence rubric, and tool metadata guidance
- [ ] T010 [BE] Create `devops-app/server/services/ai/budget-enforcer.ts` — monthly token budget check + per-incident cap enforcement + conservative token reservation/reconciliation with typed inputs/outputs
- [ ] T011 [BE] Create `devops-app/server/services/ai/context-aggregator.ts` — read-only query fanout across audit_entries (100), app_health_history (50), script_runs (5), deployments (5), app_cert_events (20) with maskContextDocument() applied before output and token-size truncation metadata
- [ ] T012 [BE] Create `devops-app/server/services/ai/sandbox-fixtures.ts` — `Record<manifestId, CannedResponse>` with generic fallback `{ status: "ok", note: "dry-run", exitCode: 0 }`
- [ ] T013 [BE] Create `devops-app/server/services/ai/incident-analyzer.ts` — core `streamText()` orchestration: create conversation row, aggregate context, retry transient provider errors, stream via WS channel `ai:<conversationId>`, persist messages, handle cap/kill-switch abort with typed inputs/outputs
- [ ] T014 [BE] Extend `devops-app/server/lib/audit-actions.ts` — add 26 new `ai.*` audit action types with Zod payload schemas per data-model.md
- [ ] T015 [BE] Extend `devops-app/server/lib/event-catalogue.ts` — add 6 new notification triggers per data-model.md
- [ ] T016 [BE] Create `devops-app/server/lib/compose-static-lint.ts` — 7 static lint rules (latest tag, reserved ports, missing healthcheck, plaintext secrets, privileged, dangerous mounts, missing depends_on) with typed inputs/outputs
- [ ] T017 [BE] Unit test `devops-app/tests/unit/compose-static-lint.test.ts` — all 7 rules × pass/fail cases
- [ ] T018 [BE] Unit test `devops-app/tests/unit/mask-context-document.test.ts` — secret pattern detection + false-positive safety
- [ ] T019 [BE] Unit test `devops-app/tests/unit/ai-tool-registry.test.ts` — manifest → tool conversion, dangerLevel/reversible in descriptions
- [ ] T020 [BE] Unit test `devops-app/tests/unit/budget-enforcer.test.ts` — monthly cap, per-incident cap, edge cases
- [ ] T021 [BE] Unit test `devops-app/tests/unit/push-subscriber.test.ts` — dedup map 5-min window, absorb in-flight, spawn post-terminal

## Phase 3: US1 — Configure LLM Provider and Budget (P1)

**Goal**: Operator can configure AI provider, API key, model, budget limits. Feature-flagged off by default.

- [ ] T022 [BE] [US1] Create route `devops-app/server/routes/ai-settings.ts` — GET/PUT `/api/ai/settings` + PUT `/api/ai/settings/kill-switch` with Zod validation, `requireAuth`, and `ai:admin` mutation role checks
- [ ] T023 [BE] [US1] Create route `devops-app/server/routes/ai-providers.ts` — CRUD `/api/ai/providers`, POST `/api/ai/providers/:id/test` (health probe ≤10 tokens) with Zod validation and `ai:admin` mutation role checks. API keys write-only (never returned), sealed via envelope-cipher; unavailable master key returns structured error and audit
- [ ] T024 [FE] [US1] Create `devops-app/client/components/ai/AiSettingsSection.tsx` — settings page AI Copilot section: enable toggle, budget inputs, tool-use toggle, sandbox default, retention days
- [ ] T025 [FE] [US1] Create `devops-app/client/components/ai/ProviderConfigForm.tsx` — add/edit provider modal: provider dropdown, model input, API key masked input (or endpoint URL for ollama), rate card inputs, "Test Connection" button with inline result
- [ ] T026 [FE] [US1] Create `devops-app/client/hooks/useAiSettings.ts` — fetch + mutate AI settings
- [ ] T027 [FE] [US1] Create `devops-app/client/hooks/useAiProviders.ts` — CRUD providers + test connection
- [ ] T028 [FE] [US1] Create `devops-app/client/components/ai/KillSwitchBanner.tsx` — red dashboard-wide banner when kill switch engaged
- [ ] T029 [BE] [US1] Integration test `devops-app/tests/integration/ai-settings.test.ts` — CRUD settings + kill switch toggle + audit trail verification
- [ ] T030 [BE] [US1] Integration test `devops-app/tests/integration/ai-providers.test.ts` — CRUD providers, key rotation audit, test connection (mocked provider)

## Phase 4: US2 — On-demand "Analyze with AI" (P1)

**Goal**: Operator clicks "Analyze with AI" on any failure surface, gets streaming hypothesis + evidence in IncidentView.

- [ ] T031 [BE] [US2] Create route `devops-app/server/routes/ai-conversations.ts` — POST `/api/ai/conversations` (create + start inference, returns existing in-flight for same target), GET list with filters (trigger, targetKind, status, date, full-text), GET latest-by-target, GET `/:id` with messages + tool calls, PATCH `/:id` sandboxMode, POST `/:id/recover` with Zod validation and structured error handling
- [ ] T032 [FE] [US2] Create `devops-app/client/pages/IncidentPage.tsx` — `/incidents/:id` route, full IncidentView layout
- [ ] T033 [FE] [US2] Create `devops-app/client/components/ai/IncidentView.tsx` — main conversation UI: context summary, streaming hypothesis, evidence, activity timeline
- [ ] T034 [FE] [US2] Create `devops-app/client/components/ai/ContextSummary.tsx` — display aggregated source counts (N log lines, M audit events, etc.)
- [ ] T035 [FE] [US2] Create `devops-app/client/components/ai/HypothesisPanel.tsx` — streaming text display with confidence badge
- [ ] T036 [FE] [US2] Create `devops-app/client/components/ai/AnalyzeButton.tsx` — "Analyze with AI" button, shown on AppPage (health RED), RunDetail (failed), ServerPage (any RED app), cert-expiring banner
- [ ] T037 [FE] [US2] Create `devops-app/client/hooks/useAiConversation.ts` — WS subscription to `ai:<conversationId>` channel + REST fallback on reconnect
- [ ] T038 [FE] [US2] Mount AnalyzeButton on `devops-app/client/components/apps/AppPage.tsx` (when health RED or last deploy failed)
- [ ] T039 [FE] [US2] Mount AnalyzeButton on `devops-app/client/components/deploy/RunDetail.tsx` (when run failed)
- [ ] T039a [FE] [US2] Mount AnalyzeButton on AuditPage high/failure rows, ServerPage when any app is RED, and cert-expiring banner
- [ ] T040 [BE] [US2] Integration test `devops-app/tests/integration/ai-pull-analysis.test.ts` — create conversation, mock provider streaming, verify messages persisted, WS events emitted, audit trail

## Phase 5: US3 — Auto-analyze on High-severity Event (P1)

**Goal**: Push triggers automatically start AI analysis on qualifying events. 5-min dedup window.

- [ ] T041 [BE] [US3] Create `devops-app/server/services/ai/push-subscriber.ts` — `onEvent(eventType, context)` with settings/preferences/kill-switch/system-rate-limit checks, 5-min rolling dedup map per `(target_kind, target_id, event_class)`, absorb-in-flight vs spawn-new-post-terminal logic per FR-017
- [ ] T042 [BE] [US3] Wire push subscriber calls into existing event-emitting code paths: health-poller RED transition, deploy failure handlers, cert sweep, script failure (dangerLevel ≥ medium) — add `aiPushSubscriber.onEvent()` calls at each site
- [ ] T043 [FE] [US3] Create `devops-app/client/components/ai/AiBadge.tsx` — "AI analyzed — click to view" badge linking to `/incidents/:id`
- [ ] T044 [FE] [US3] Mount AiBadge on AppPage, ServerPage, RunDetail when a push-triggered conversation exists for the target
- [ ] T045 [BE] [US3] Integration test `devops-app/tests/integration/ai-push-analysis.test.ts` — event → auto-conversation creation, dedup absorb, dedup spawn-new, kill-switch mid-push, budget skip

## Phase 6: US4 — Tool-Call Approval and Execution (P1)

**Goal**: LLM proposes tool-calls, operator approves with danger-tier confirmation, execution via scriptsRunner.

- [ ] T046 [BE] [US4] Create `devops-app/server/services/ai/tool-call-dispatcher.ts` — validate params via manifest Zod schema, check server policy, dispatch via scriptsRunner with `initiated_by='ai_proposal'` + AI linkage columns, feed result back to LLM conversation
- [ ] T047 [BE] [US4] Create route `devops-app/server/routes/ai-tool-calls.ts` — POST `/api/ai/tool-calls/:id/challenge`, POST `/api/ai/tool-calls/:id/approve` (with optional param override), POST `/:id/reject` with Zod validation and structured error handling; server-side danger-tier enforcement (low=direct, medium=ackText, high=typedTarget+challenge cooldown)
- [ ] T048 [BE] [US4] Modify `devops-app/server/services/scripts-runner.ts` — accept `initiatedBy`, `aiConversationId`, `aiToolCallId` params and persist to script_runs row
- [ ] T049 [FE] [US4] Create `devops-app/client/components/ai/ToolCallCard.tsx` — proposal card: action name, editable params form (derived from Zod), target server dropdown, dangerLevel badge, reversible badge, Approve/Edit/Reject buttons
- [ ] T050 [FE] [US4] Create `devops-app/client/components/ai/ToolCallApprovalDialog.tsx` — danger-tier confirmation modals: low=immediate, medium=type "approve", high=type app/server name + 5s cooldown
- [ ] T051 [FE] [US4] Create `devops-app/client/components/ai/ActivityTimeline.tsx` — chronological event feed of tool-call state transitions in IncidentView
- [ ] T052 [FE] [US4] Create `devops-app/client/hooks/useToolCallApproval.ts` — approve/reject mutations with optimistic updates
- [ ] T053 [BE] [US4] Integration test `devops-app/tests/integration/ai-tool-call-approval.test.ts` — propose → approve → execute → audit trail complete (SC-003)
- [ ] T054 [BE] [US4] Integration test `devops-app/tests/integration/ai-tool-call-policy.test.ts` — server policy blocks, deploy lock blocks, invalid params rejected, sandbox dry-run

## Phase 7: US5 — Sandbox/Dry-run Mode (P2)

**Goal**: Conversations can run in sandbox mode where tool-calls return canned responses.

- [ ] T055 [BE] [US5] Integrate sandbox mode in `tool-call-dispatcher.ts` — intercept execution, return fixture from `sandbox-fixtures.ts`, tag audit with `dry_run=true`
- [ ] T056 [FE] [US5] Create `devops-app/client/components/ai/SandboxBadge.tsx` — "DRY-RUN" label on tool-call cards and IncidentView header
- [ ] T057 [FE] [US5] Add sandbox toggle to IncidentView — per-conversation override, defaults per `ai_settings.default_sandbox`
- [ ] T058 [BE] [US5] Integration test `devops-app/tests/integration/ai-sandbox.test.ts` — sandbox dispatch returns fixture, audit tagged, toggle mid-conversation

## Phase 8: US6 — Compose Reviewer (P2)

**Goal**: Static lint on keystroke + LLM review on button click in EditAppPage.

- [ ] T059 [BE] [US6] Create route `devops-app/server/routes/ai-compose-review.ts` — POST `/api/ai/compose-lint` (static only), POST `/api/ai/compose-review` (static + LLM with content-hash cache), POST/DELETE dismiss endpoints with Zod validation
- [ ] T060 [BE] [US6] Create `devops-app/server/services/ai/compose-reviewer.ts` — LLM review orchestration + `ai_compose_review_cache` lookup/store, 24h TTL or content-change invalidation
- [ ] T061 [FE] [US6] Create `devops-app/client/components/ai/ComposeStaticLintInline.tsx` — keystroke-debounced (300ms) static lint results inline
- [ ] T062 [FE] [US6] Create `devops-app/client/components/ai/ComposeReviewPanel.tsx` — "Review with AI" button + findings list with severity/line/finding/suggestion + Dismiss links
- [ ] T063 [FE] [US6] Create `devops-app/client/hooks/useComposeReview.ts` — static lint state + LLM review state + dismiss mutations
- [ ] T064 [FE] [US6] Mount ComposeStaticLintInline + ComposeReviewPanel on `devops-app/client/components/apps/EditAppForm.tsx`
- [ ] T065 [BE] [US6] Integration test `devops-app/tests/integration/ai-compose-review.test.ts` — static lint rules, LLM review (mocked), cache hit, dismiss/un-dismiss

## Phase 9: US7 — Kill Switch / Per-server AI Disable (P2)

**Goal**: Per-server AI access controls + global kill switch.

- [ ] T066 [BE] [US7] Extend PATCH `/api/servers/:id` in `devops-app/server/routes/servers.ts` — accept `aiReadAccess`, `aiWriteAccess` fields with Zod validation, emit `ai.server_policy_changed` audit
- [ ] T067 [FE] [US7] Add AI Copilot Access section to ServerPage settings tab — read access toggle, write access dropdown (enabled/sandbox-only/disabled)
- [ ] T068 [BE] [US7] Integration test `devops-app/tests/integration/ai-kill-switch.test.ts` — engage → block new inference and new tool-call execution, in-flight finishes chunk + halts, release → resume, per-server policy enforcement

## Phase 10: US8 — Cost Dashboard and Budget Enforcement (P3)

**Goal**: Visible spend tracking + hard-stop when budget exhausted.

- [ ] T069 [BE] [US8] Create route `devops-app/server/routes/ai-spend.ts` — GET `/api/ai/spend` (monthly/today aggregates), GET `/api/ai/spend/conversations` (per-conversation breakdown with pagination)
- [ ] T070 [FE] [US8] Create `devops-app/client/components/ai/CostDashboard.tsx` — spend overview (this month tokens in/out, USD estimate, budget progress bar) + per-conversation table
- [ ] T071 [FE] [US8] Create `devops-app/client/hooks/useAiSpend.ts` — fetch spend data with period selector
- [ ] T072 [BE] [US8] Integration test `devops-app/tests/integration/ai-budget-enforcement.test.ts` — monthly budget exhaustion (pull=402, push=skip+audit), per-incident cap mid-conversation halt

## Phase 11: US9 — Conversation History and Search (P3)

**Goal**: List page with filters + history replay + soft-delete retention.

- [ ] T073 [FE] [US9] Create `devops-app/client/pages/IncidentsListPage.tsx` — `/incidents` route with filters (trigger, targetKind, status, date range, full-text search), paginated table
- [ ] T074 [BE] [US9] Create `devops-app/server/services/ai/archiver.ts` — daily cron soft-deletes conversations older than `conversation_retention_days`, sets `archived_at`
- [ ] T075 [BE] [US9] Integration test `devops-app/tests/integration/ai-conversation-history.test.ts` — list with filters, archive cron, recover endpoint

## Phase 12: Polish & Cross-cutting

- [ ] T076 [BE] Wire all new route files into Express app (`devops-app/server/index.ts`) — ai-settings, ai-providers, ai-conversations, ai-tool-calls, ai-compose-review, ai-spend; gate all behind `ai_settings.enabled` check middleware
- [ ] T077 [FE] Add `/incidents` and `/incidents/:id` routes to client router
- [ ] T078 [FE] Mount KillSwitchBanner in root layout (shows when `ai_settings.global_kill_switch_engaged = true`)
- [ ] T079 [BE] Rate-limit middleware on inference-creating endpoints: 10/min per user per FR-052
- [ ] T080 [SEC] Security review: verify API keys never returned in any GET response, AI endpoint role checks are enforced, `maskContextDocument()` covers all aggregation paths with untrusted-source delimiters, no secret patterns in `ai_messages` content_text, and direct API calls cannot bypass danger-tier confirmations
- [ ] T081 [E2E] End-to-end test: full pull-trigger flow — configure provider → analyze app → approve tool-call → verify audit trail completeness (SC-003, SC-004)

## Dependency Graph

```
T001 → T002, T003, T004, T005
T002 + T003 + T004 → T006
T001 → T006
T005 → T008
T001 → T007, T008, T010, T012, T014, T015, T016
T006 → T009
T007 → T011
T008 → T009
T009 + T010 + T011 + T014 → T013
T007 → T018
T008 → T019
T010 → T020
T014 → T022, T023
T015 → T022
T016 → T017
T006 → T022, T023
T022 → T024, T026
T023 → T025, T027
T024 + T025 → T028
T026 + T027 → T029, T030
T013 → T031
T022 → T031
T031 → T032, T037
T032 → T033
T033 → T034, T035, T036
T037 → T033
T036 → T038, T039, T039a
T031 → T040
T013 → T041
T041 → T042, T021
T041 → T043
T043 → T044
T041 → T045
T013 → T046
T046 → T047
T048 → T046
T005 → T048
T047 → T049, T050, T051, T052
T046 → T053, T054
T046 → T055
T055 → T056, T057
T055 → T058
T016 → T059
T013 → T060
T059 → T061, T062, T063
T063 → T064
T059 → T065
T022 → T066
T066 → T067
T066 → T068
T010 → T069
T069 → T070, T071
T069 → T072
T031 → T073
T074 → T075
T013 → T074
T022 + T023 + T031 + T047 + T059 + T069 → T076
T032 + T073 → T077
T028 → T078
T076 → T079
T076 → T080
T040 + T053 + T068 → T081
```

## Parallel Lanes

| Lane | Agent | Tasks | Start After |
|---|---|---|---|
| DB Setup | [DB] | T002, T003, T004 | T001 |
| BE Core | [BE] | T005, T006-T015, T016 | T001 |
| BE Unit Tests | [BE] | T017-T021 | respective service tasks |
| BE US1 Routes | [BE] | T022, T023 | T014 |
| FE US1 | [FE] | T024-T028 | T022, T023 |
| BE US2 Routes | [BE] | T031 | T013, T022 |
| FE US2 | [FE] | T032-T039a | T031 |
| BE US3 | [BE] | T041, T042 | T013 |
| FE US3 | [FE] | T043, T044 | T041 |
| BE US4 | [BE] | T046-T048 | T013, T005 |
| FE US4 | [FE] | T049-T052 | T047 |
| BE US5 | [BE] | T055 | T046 |
| FE US5 | [FE] | T056, T057 | T055 |
| BE US6 | [BE] | T059, T060 | T016, T013 |
| FE US6 | [FE] | T061-T064 | T059 |
| BE US7 | [BE] | T066 | T022 |
| FE US7 | [FE] | T067 | T066 |
| BE US8 | [BE] | T069 | T010 |
| FE US8 | [FE] | T070, T071 | T069 |
| BE US9 | [BE] | T074 | T013 |
| FE US9 | [FE] | T073 | T031 |
| Integration Tests | [BE] | T029, T030, T040, T045, T053, T054, T058, T065, T068, T072, T075 | respective route/service |
| Polish | [BE]/[FE]/[SEC]/[E2E] | T076-T081 | all US phases |

## Agent Summary

| Agent | Task Count | First Task | Blocked By |
|---|---|---|---|
| [SETUP] | 1 | T001 | — |
| [DB] | 3 | T002 | T001 |
| [BE] | 52 | T005 | T001 |
| [FE] | 23 | T024 | T022 |
| [SEC] | 1 | T080 | T076 |
| [E2E] | 1 | T081 | T040+T053+T068 |

**Total**: 82 tasks

## Critical Path

```
T001 → T002+T003+T004 → T006 → T009 → T013 → T031 → T032 → T033 → T036 → T038
                       ↘ T007 → T011 ↗        ↓
                         T010 + T014 ↗     T041 → T042
                                             ↓
                                         T046 → T047 → T049
```

Longest chain: **T001 → T003 → T006 → T009 → T013 → T031 → T032 → T033 → T036 → T038** (10 tasks)

## Tasks Per User Story

| Story | Tasks | Priority |
|---|---|---|
| US1 (Configure) | T022-T030 | P1 |
| US2 (Pull analysis) | T031-T040 incl. T039a | P1 |
| US3 (Push analysis) | T041-T045 | P1 |
| US4 (Tool-call approval) | T046-T054 | P1 |
| US5 (Sandbox) | T055-T058 | P2 |
| US6 (Compose reviewer) | T059-T065 | P2 |
| US7 (Kill switch) | T066-T068 | P2 |
| US8 (Cost dashboard) | T069-T072 | P3 |
| US9 (History) | T073-T075 | P3 |
| Setup/Foundation | T001-T021 | — |
| Polish | T076-T081 | — |

## Implementation Strategy

1. **MVP**: US1 + US2 (configure provider + pull-trigger analysis). Operator can configure and manually trigger AI analysis. ~30 tasks.
2. **Core loop**: Add US3 + US4 (push triggers + tool-call approval). Full incident response loop. ~19 more tasks.
3. **Safety layer**: US5 + US7 (sandbox + kill switch). Defence-in-depth before production use. ~7 more tasks.
4. **Enhancements**: US6 + US8 + US9 (compose reviewer + cost + history). ~14 more tasks.
5. **Polish**: Wire routes, rate-limit, security review, E2E. ~6 tasks.

**Parallel agent strategy**: [BE] and [FE] lanes can run concurrently within each US phase after the route tasks complete. [DB] tasks (T002-T004) are a one-time setup barrier. Integration tests run after their respective route/service pairs.
