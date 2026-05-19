# Feature Specification: AI Incident Copilot

**Version**: 1.0 | **Status**: Draft | **Date**: 2026-05-18

> **Sequence note**: 012 (blue-green-deploy) reserves `0012_blue_green_deploy.sql`.
> This feature reserves `0013_ai_incident_copilot.sql`.

> **Spec lifts and extensions**: Feature 005 (universal-script-runner) declared
> "no LLM-driven action dispatch built on top of the runner". This feature
> lifts that limitation — adds a `tool-use` driver that consumes the manifest
> the same way the operator UI does, with the SAME safety gates (lock,
> dangerLevel, audit). Manifest stays the single source of truth.
>
> Feature 011 (zero-touch-onboarding) `notification_preferences` catalogue is
> extended with new AI-class events (operator opt-in or opt-out per type).
>
> Feature 010 (operational-maturity) FailureCard vocabulary is extended with
> two new states: `ai_analysis_in_progress`, `ai_proposed_remediation`.
>
> Feature 006 (app-health-monitoring) health-poller and feature 012's
> blue-green failure phases become **push triggers** for AI analysis via
> explicit direct calls into the AI push subscriber, following the existing
> notification-gate dispatch pattern. No external queue or application event
> bus is added in v1.

## Clarifications

### Session 2026-05-18

- Q: Push-trigger debounce — when `health-poller` emits 5 RED events in
  30s for the same app, do we run 5 analyses, 1 batched, or 1 with
  rolling-update window? → A: **Rolling-update window, 5-minute scope**.
  The first qualifying event creates an `ai_conversations` row immediately
  and starts inference. Subsequent events sharing
  `(target_kind, target_id, event_class)` within a 5-minute rolling
  window from the first event's `created_at`:
  - If first conversation is still `pending` or `streaming` → the new
    event is appended to the existing context as an additional `tool` /
    `user` message turn (the live conversation absorbs the update) AND
    the LLM gets a "new evidence" prompt addition; status remains
    streaming through to completion.
  - If first conversation has reached terminal status (`completed`,
    `error`, `cap_exhausted`, `aborted_by_kill_switch`) → a NEW
    conversation is created with `prior_conversation_id` pointing to the
    earlier one, fresh context aggregation, fresh budget.
  - Window is computed from the FIRST event's `created_at`, not the
    most recent — prevents runaway extension if events keep arriving.
  - After 5 minutes, dedup expires; the next matching event always
    creates a fresh conversation.

  Audit `ai.push_event_absorbed_by_in_flight` emitted on the absorb
  path; `ai.push_event_new_conversation_post_dedup` on the
  post-window-fresh path. Both carry `{ prior_conversation_id,
  window_start_at, time_since_window_start_ms }` so cost-attribution
  queries can correlate cluster behaviour.

- Q: Compose-reviewer trigger frequency — keystroke vs. save vs.
  hybrid? → A: **Hybrid — cheap static lint on keystroke + LLM on
  explicit "Review with AI" click**. Static lint is regex/AST-based,
  zero LLM cost, surfaces obvious risks inline as operator types
  (image tag `latest`, ports exposing reserved ranges like 22/5432/27017,
  missing healthcheck, plaintext secrets matching common patterns,
  bind-mount to host root path, privileged: true, etc.). Static-lint
  catalogue lives in `server/lib/compose-static-lint.ts` (new file)
  with a curated rule set. LLM review is OPT-IN per edit session —
  operator clicks the "Review with AI" button when they want deeper
  semantic analysis. LLM review caches per-app keyed by content hash
  so re-clicking on unchanged content returns cached findings without
  re-spending tokens. Cache TTL: 24 hours OR until app's compose
  content changes (whichever first).

- Q: Mid-stream visibility of approved/executed `dangerLevel: low`
  tool-calls (e.g., `logs/tail`, `health-check`)? → A: **Log-only in
  IncidentView**. Tool-calls (proposed + executed + completed) stream
  into the IncidentView's "Activity" timeline in real time via the
  existing WS channel. NO global toast, NO dashboard-wide banner. The
  operator sees AI activity ONLY when they have the IncidentView open.
  This minimises notification fatigue while maintaining full
  transparency — if operator wants to know what AI is doing, they
  open the incident; otherwise the activity is silent. Audit trail
  is unchanged (every tool-call audited regardless of UI surface).
  Exception: `dangerLevel ≥ medium` tool-calls DO emit a TG message
  (per `ai.tool_call_executed_destructive` notification trigger,
  default ON in feature 011 catalogue) — that surface is
  unconditional because destructive actions warrant proactive
  visibility, not opt-in.

## Problem Statement

The dashboard already collects everything needed to debug a typical incident:
container logs (via `logs.ts` route + ssh-pool tails), per-app health
timeline (`app_health_history` from feature 006), audit events (`audit_entries`
across all features), recent compose diffs (git ref deltas from
`bootstrap-orchestrator`), cert lifecycle events (`app_cert_events` from
feature 008), blue-green phase history (feature 012's `deploy_state`
transitions), and scripts-runner stdout/stderr captures. The data is rich.

What's missing is **synthesis**. When something fails — a deploy stuck in
`FAILED_CANDIDATE_HEALTHCHECK`, an app whose health probe just turned RED, a
cert nearing expiry without ACME refresh, a database backup that exited
non-zero last night — the operator must:

1. Notice the failure (currently: scan dashboard, read TG alert, check audit).
2. Open ~3 different pages: AppPage logs, RunsPage for the last related run,
   AuditPage for surrounding events.
3. Mentally cross-reference timeline, error strings, recent changes.
4. Pattern-match against memory of similar incidents.
5. Pick a remediation from `scripts-manifest.ts` (rollback? retry? edit
   compose? force-stop? hard-delete?).
6. Run it with the right parameters.

Time-to-root-cause varies from seconds (obvious — image build failed in
visible log) to hours (subtle — cert ACME failure cascading through health
checks that emit confusing "container unhealthy" alerts). Operators with
recent memory of the codebase outperform infrequent operators by a wide
margin. The dashboard has no institutional memory.

**This feature adds an AI Copilot that performs steps 2–5 automatically**:
aggregates context from existing data sources, proposes a root-cause
hypothesis with confidence, proposes a remediation tied to an existing
manifest entry, optionally executes the remediation under the same safety
gates a human operator uses (dangerLevel-tier authorization, deploy_lock,
audit trail, typed-confirm for destructive).

The copilot's value proposition is **not** "AI replaces operator" — it's
**operator-assisted incident response**: faster mean time to diagnosis,
consistent quality across operator experience levels, and an audit trail
that captures what was tried and why.

The architectural differentiator vs. competing OSS panels: `scripts-manifest.ts`
is already a typed action catalogue (Zod-validated params, `dangerLevel`
tier, `requiresLock`, `outputArtifact`). LLM tool-use becomes native — the
tool registry is derived from the manifest, so every existing safety
discipline (deploy_lock, audit middleware, path-jail, validate-compose-path)
applies to LLM-initiated actions identically. No bespoke "AI mode" parallel
codepath. The blast-radius story is therefore credible from day 1.

## User Scenarios & Testing

### User Story 1 — Configure LLM provider and budget (Priority: P1)

As an operator setting up AI Copilot for the first time, I want to choose
which AI provider to use, enter my API key, and set a monthly spend cap so
the feature doesn't burn through my budget on a runaway conversation loop.

**Acceptance**:

- Settings page surfaces a new "AI Copilot" section with controls:
  - **Provider** dropdown: `anthropic | openai | ollama | disabled`. Default
    `disabled` — feature is opt-in.
  - **API key** masked input (or **endpoint URL** + optional auth header when
    provider is `ollama`).
  - **Default model** text input (preset suggestions per provider).
  - **Monthly token budget** integer (default: 5_000_000 input + 1_000_000
    output tokens).
  - **Per-incident token cap** integer (default: 100_000 in + 20_000 out).
  - **Allow LLM tool-use** boolean toggle (default `true`; when `false`,
    LLM is restricted to read-only context, no tool-calls offered).
- API key persisted via existing `envelope-cipher` infrastructure (same
  encryption-at-rest pattern as `ai_provider_keys` parent — feature 011
  master-key seal applies).
- "Test connection" button issues a 1-token health probe against the
  provider; success/failure surfaced inline.
- Save persists; `audit_entries` row `ai.provider_configured` emitted with
  payload `{ provider, model, budgetTokens, toolUseEnabled }`. Key VALUE
  never logged.
- Provider-key rotation: changing the API key emits `ai.provider_key_rotated`
  audit; prior conversations retain their archived inputs/outputs but new
  inferences use the new key.
- Provider-key lifecycle: rotation marks the old key `inactive` but retained
  and decryptable for in-flight conversations that already reference it.
  Deletion/revocation is blocked while any conversation using the key is
  `pending` or `streaming`.

### User Story 2 — On-demand "Analyze with AI" (pull trigger) (Priority: P1)

As an operator looking at a failed deploy, an unhealthy app, a cert
nearing expiry, or any audit-event row, I want to click "Analyze with AI"
and receive a root-cause hypothesis + suggested next-action within ~30
seconds, in a panel I can read inline without leaving the page I'm on.

**Acceptance**:

- "Analyze with AI" button appears on these surfaces (when AI Copilot is
  configured + enabled per US1):
  - AppPage when health is RED or last deploy failed
  - DeploymentDetail (RunDetail.tsx + DeployLog) for failed runs
  - AuditPage rows with `severity = high` or `class = failure`
  - ServerPage when any of its apps is RED
  - Cert-expiring banner (already surfaced by feature 008's cert sweep)
- Clicking opens an `IncidentView` panel inline (or full-page route
  `/incidents/:incidentId`) and starts a streaming inference. The panel
  shows:
  - **Context summary**: which sources were aggregated (counts: N log lines,
    M audit events, K health-history points, recent compose diff).
  - **Hypothesis**: 1–3 sentence root-cause string + confidence label
    (`high | medium | low`).
  - **Evidence**: bulleted citations of specific log lines / audit IDs /
    health points the LLM referenced.
  - **Proposed remediation** (when present): named manifest action with
    parameter values pre-filled, plus a free-text rationale.
- First token of LLM response arrives within 3 seconds (provider-dependent;
  budget per US2 acceptance is 30 seconds to full response).
- Streaming uses the existing WS channel (reuse feature 005 / 009 streaming
  pattern); a partial response surfaces incrementally so operator isn't
  staring at a spinner.
- The conversation row (`ai_conversations`) is created on click with
  `trigger = 'pull'`, `target_kind` matching the surface (`'deployment'`,
  `'app'`, `'audit_event'`, `'cert'`, `'server'`), `target_id` set.
- Audit `ai.analysis_started` emitted with `{ trigger, target_kind,
  target_id }`.

### User Story 3 — Auto-analyze on high-severity event (push trigger) (Priority: P1)

As an operator who returns to the dashboard 10 minutes after a production
incident, I want the dashboard to have already started analyzing
high-severity events without my involvement, so the incident view is
populated and ready to read when I open it.

**Acceptance**:

- Existing event-emitting code paths call the AI push subscriber directly
  (post-feature 011) to trigger AI analysis automatically when these events fire AND the
  trigger's `notification_preferences` row is enabled AND AI Copilot is
  enabled (US1):
  - `app.health_red` (feature 006's first-RED transition after debounce)
  - `deploy.candidate_failed_rollback` (feature 012)
  - `deploy.caddy_admin_failure_post_switch` (feature 012)
  - `deploy.failed` (any non-blue/green deploy failure path)
  - `app.cert_expiring_soon` (feature 008's cert sweep, 7-day window)
  - `app.cert_renewal_failed` (feature 008)
  - `script.failed` (feature 005 with `dangerLevel ≥ medium`)
- Push trigger creates `ai_conversations` row with `trigger = 'push'`,
  populates context, and runs inference in the background.
- On completion, the operator sees a badge on the relevant dashboard
  surface ("AI analyzed — click to view") and an optional TG notification
  (feature 006 dispatch) if the trigger event's TG preference is enabled.
- Per Session 2026-05-18 (Q1) — rolling-update window 5 minutes:
  in-flight conversation absorbs additional events sharing
  `(target_kind, target_id, event_class)`; terminal conversations
  spawn a NEW conversation with `prior_conversation_id` linkage. See
  Clarifications + FR-017 for full semantics.
- Push analysis MUST respect the per-incident token cap (US1). If cap is
  hit, conversation stops, partial result persisted, badge labeled
  "partial" so operator knows to re-run with higher budget or read
  partial.

### User Story 4 — LLM proposes a remediation; operator approves (Priority: P1)

As an operator reviewing an AI-proposed remediation, I want to see exactly
what the LLM is asking to execute (which manifest action, what parameters,
what target server) and explicitly approve it before anything runs.
Destructive actions require a typed-confirm (same discipline as today's
hard-delete UI).

**Acceptance**:

- LLM proposing a remediation produces a `tool_call_proposed` event +
  `ai_tool_calls` row with status `proposed`. The IncidentView surfaces a
  card per proposal:
  - **Action name**: `<category>/<name>` from manifest.
  - **Parameters**: form pre-filled from LLM's structured output, but
    EDITABLE by operator before approval.
  - **Target server** (when applicable).
  - **Danger label**: badge color reflecting `dangerLevel` (`low` =
    green, `medium` = amber, `high` = red).
  - **Reversibility**: badge from new manifest field `reversible: boolean`.
  - **Approve / Edit & Approve / Reject** buttons. Reject closes the card
    and emits `ai.tool_call_rejected` audit.
- Authorization gates per `dangerLevel`:
  - `low`: single-click "Approve" → execute via existing scripts-runner.
  - `medium`: single-click "Approve" → typed-acknowledgement modal
    (operator types "approve") → execute.
  - `high`: typed-id modal — operator types the app name OR server
    hostname (matching existing hard-delete pattern) → execute. ADDITIONAL
    requirement: 5-second cooldown after typing before "Execute" button
    enables, to deter muscle-memory clicks on impulse.
- Sandbox/dry-run toggle (per IncidentView) when ON: tool-calls return
  mocked outputs to the LLM (sourced from a small library of canned
  responses keyed by manifest id); no SSH command executed; audit records
  the dry-run with `dry_run = true`.
- Execution dispatch reuses existing `scriptsRunner` machinery. From the
  manifest entry's perspective, an LLM-initiated run is indistinguishable
  from a UI-initiated run — same lock semantics, same SSH dispatch, same
  audit middleware, same `script_runs` row insert.
- The `script_runs` row gains a new column `initiated_by` with values
  `'operator' | 'ai_proposal'`; when set to `ai_proposal`, also records
  `ai_conversation_id` and `ai_tool_call_id` for forensic linking.
- Post-execution result (stdout, exit code, artifact path) is streamed
  back into the LLM conversation as the next turn so the LLM can read it
  and decide whether further action is needed.

### User Story 5 — Sandbox/dry-run mode for evaluating prompts (Priority: P2)

As an operator who has just configured AI Copilot for the first time, or
who wants to test a new provider/model combo, I want to run a full
incident analysis in dry-run mode where the LLM proposes actions but
nothing actually executes — so I can build confidence in the model's
behaviour against my real incidents before granting it write access.

**Acceptance**:

- Each IncidentView has a "Sandbox" toggle defaulting per global setting
  but overridable per-conversation. When ON:
  - LLM context unchanged (real data).
  - Tool-call dispatch is intercepted; instead of executing, a canned
    output is returned to the LLM (per-manifest-id default; falls back to
    `{"status":"ok","note":"dry-run"}` for entries without a canned
    response).
  - UI labels every proposal card with a "DRY-RUN" banner.
  - Audit entries tagged `dry_run = true`.
- The sandbox library of canned responses lives in a manifest-side
  fixtures file. Initial coverage: top 10 manifest entries by historical
  use frequency. Coverage expands over time; entries without a canned
  response use the generic fallback.
- A per-server "default-to-sandbox" flag is available (US7); on by default
  for new servers added after this feature ships, to enforce
  least-privilege onboarding.

### User Story 6 — Inline compose-file reviewer (Priority: P2)

As an operator editing an application's compose configuration in
EditAppPage, I want the LLM to flag suspicious or risky configuration
choices inline as I type — like a syntax highlighter, but for operational
concerns (port exposed publicly when it shouldn't be, healthcheck
missing, secrets in plaintext env, image tag set to `latest`).

**Acceptance**:

- EditAppPage's compose-content textarea grows a "Review with AI" panel
  alongside (or below). Panel surfaces LLM findings as a list of
  annotations:
  - **Severity**: `info | warn | error`.
  - **Line reference**: 1-based line number in the compose YAML.
  - **Finding**: short string ("`ports` exposes 5432 publicly — Postgres?").
  - **Suggestion**: 1-sentence recommendation.
- Per Session 2026-05-18 (Q2) — hybrid: cheap static lint
  (regex/AST-based, zero LLM cost) surfaces obvious risks inline as the
  operator types; LLM review is opt-in via a "Review with AI" button.
  Per-app content-hash cache (24h TTL) avoids re-paying tokens for
  unchanged content. Static-lint catalogue lives at
  `server/lib/compose-static-lint.ts`.
- LLM context for review is the FULL compose YAML, NOT just the diff
  vs. the saved version. Findings reference absolute line numbers in the
  in-edit text.
- Each finding has a "Dismiss" link; dismissed findings persist per app
  in `ai_dismissed_findings` keyed by `(app_id, finding_hash)` so they
  don't re-surface every edit.
- Findings flagged `error` severity surface a non-blocking warning above
  the Save button; operator may save anyway (no veto — the LLM is
  advisory).

### User Story 7 — Kill switch / per-server AI disable (Priority: P2)

As an operator who's worried about giving AI write access to a critical
production server, I want a per-server toggle that disables ALL AI
tool-use on that server while still allowing read-only AI analysis of
its incidents.

**Acceptance**:

- ServerPage settings tab gains a section "AI Copilot Access":
  - **Read access**: `enabled | disabled` (default `enabled` for new
    servers added before this feature; configurable for existing).
  - **Write access (tool-use)**: `enabled | sandbox-only | disabled`
    (default `sandbox-only` for new servers added AFTER this feature
    ships).
- Global kill switch in Settings: "Disable AI Copilot system-wide" — when
  on, ALL inference is rejected (in-flight conversations finish their
  current streaming chunk and then halt; no new ones start). Visual
  banner at top of dashboard.
- Per-server write disable: when an LLM proposes a tool-call against a
  disabled server, the proposal card surfaces with a "Server policy
  disallows execution" badge instead of an Approve button. Operator may
  re-target the proposal to a different server (when applicable) or
  reject.
- Sandbox-only on a server: tool-call proposals execute against that
  server's sandbox canned responses regardless of operator selection (no
  "execute for real" affordance for that server). Operator must change
  server policy in ServerPage to grant write access.

### User Story 8 — Cost dashboard and budget enforcement (Priority: P3)

As an operator paying per-token for a hosted LLM provider, I want a
visible dashboard of my spend (this month, today, per-conversation) and
hard-stop behavior when my budget is exhausted, so I never get a surprise
bill.

**Acceptance**:

- Settings → AI Copilot section adds a "Spend" sub-section:
  - **This month**: input tokens, output tokens, computed USD estimate (per
    provider rate-card, configurable per provider).
  - **Today**: same shape.
  - **Per-conversation breakdown**: table of recent conversations with
    columns `created_at`, `trigger`, `target`, `tokens_in`, `tokens_out`,
    `est_cost_usd`, `status`.
- When monthly budget exhausts:
  - Pull-trigger analyses surface an inline error "Monthly token budget
    exhausted; raise budget in settings or wait for next month".
  - Push-trigger analyses silently skip; an audit row
    `ai.budget_exhausted_skipped_push` emitted with the target context.
  - Operator sees a banner at top of dashboard explaining the state.
- When per-incident cap exhausts mid-conversation: conversation halts at
  current turn, partial output persisted, status set to `cap_exhausted`,
  banner shown in IncidentView.

### User Story 9 — Conversation history and search (Priority: P3)

As an operator dealing with a recurring incident class (e.g., "this app's
healthcheck flaps every Tuesday"), I want to see how the LLM analyzed
this situation last time + last 10 times, so I can spot if the AI is
giving consistent advice and learn from accumulated context.

**Acceptance**:

- New page `/incidents` lists all conversations chronologically with
  filters: trigger (pull/push), target type (app/server/deployment/cert),
  status (completed/cap_exhausted/error), date range, hypothesis-text
  full-text-search.
- Each row shows: timestamp, target (linked), trigger, hypothesis summary
  (first 80 chars), confidence, whether any tool-call was approved and
  executed, total tokens / cost.
- Clicking opens the IncidentView in read-only history mode.
- Retention: conversations retained 90 days by default; configurable per
  global setting. Older conversations soft-deleted (kept in DB with
  `archived_at`, NOT shown in `/incidents`, recoverable via direct
  query).

## Edge Cases

### US1 (Configure)

- **Operator enters wrong API key**: "Test connection" fails inline; save
  is permitted (operator may save and retry later); status banner shows
  "AI Copilot configured but unreachable" until next successful inference
  or test. No tool-calls run against an unreachable provider.
- **Provider returns 429 rate-limit**: in-flight conversation enters
  `provider_rate_limited` status; UI surfaces "Provider rate-limited —
  retry in N seconds" with countdown if `retry-after` header present.
  Auto-retry once after the header window.
- **Provider returns transient 5xx / timeout**: analyzer retries with
  exponential backoff (max 2 attempts, provider-specific timeout budget).
  If all retries fail, status becomes `error`, audit `ai.analysis_failed`
  includes `{ provider, model, errorClass }`, and no fallback provider is
  used in v1 (provider failover remains out of scope).
- **Operator changes provider mid-conversation**: in-flight conversations
  continue with the old provider key (stored on `ai_conversations` row at
  creation). New conversations use new provider. Audit
  `ai.provider_configured` emitted with prev/next provider names.
- **Operator deletes API key**: provider drops to `disabled`; existing
  archived conversations remain readable (data persisted); no new
  inference possible.
- **Master key unavailable**: saving or testing a hosted provider key fails
  with a structured configuration error; the key is not persisted and audit
  `ai.provider_configure_failed` records `{ provider, errorClass:
  'master_key_unavailable' }` without key material.

### US2 (On-demand analysis)

- **Operator clicks "Analyze" twice on same target**: second click does
  NOT create a duplicate conversation if first is still streaming;
  instead surfaces the in-flight conversation. If first completed, second
  creates a new conversation tagged with `prior_conversation_id` so
  operator can compare.
- **Operator clicks "Analyze" while push analysis is in-flight for the
  same `(target_kind, target_id)`**: the pull request returns the existing
  in-flight conversation (HTTP 409 with existing conversation id in API
  terms) rather than starting a competing analysis. If the push analysis is
  terminal, pull creates a new linked conversation.
- **Context aggregation finds zero relevant data**: rare (audit log
  always has SOMETHING), but if all sources empty for the target window,
  surface "Insufficient context — try widening the time window" with a
  control to expand from default 1h to 24h or 7d.
- **WS connection drops during streaming**: client re-fetches the
  conversation on reconnect via REST; persisted-so-far portion is shown;
  if not yet complete, polling resumes until done.
- **WS drops mid-tool-call proposal**: client discards any partial streaming
  UI state on reconnect and rehydrates from the REST snapshot ordered by
  `seq` / tool-call `created_at`. Partial tool JSON is never rendered as an
  actionable proposal.

### US3 (Push trigger)

- **Same event fires twice within the dedup window**: rolling-update
  semantics apply per Session 2026-05-18 (Q1) — see FR-017.
  In-flight conversation absorbs the second event as a new `tool`
  message turn; terminal conversation spawns a successor with
  `prior_conversation_id` linkage.
- **Operator disables AI mid-push-analysis**: in-flight conversation
  finishes its current streaming chunk and halts gracefully. Status set
  to `aborted_by_kill_switch`.
- **Push subscriber crashes mid-dispatch**: existing
  `notification-gate.ts` resilience patterns apply (failure does NOT
  rollback the original event; the analysis simply doesn't happen and
  the operator can `pull` later).

### US4 (Tool-call approval)

- **LLM proposes a tool with invalid params**: server-side validation
  (existing Zod schemas on manifest entries) rejects; rejection reason
  surfaces in the IncidentView card; LLM gets the rejection in its next
  context turn and may propose corrected params.
- **LLM proposes an action against a server that disallows write
  (US7)**: card surfaces with "Server policy disallows execution" badge,
  cannot be approved; LLM gets a deflection message in its next context
  turn ("Cannot execute on server X due to policy; consider alternative
  remediation").
- **Operator approves, but `deploy_lock` is held by another deploy**:
  execution waits on lock per existing semantics (queues with timeout);
  audit `ai.tool_call_blocked_by_lock` emitted; LLM informed.
- **Operator approves at near-cap budget**: tool-call execution itself
  doesn't consume LLM tokens (it's an external action); however the
  result feedback to LLM may exceed the cap. Result surfaced in
  IncidentView regardless; if LLM cannot read it, conversation halts
  with `cap_exhausted` and a clearly-labelled "Result not fed to AI"
  badge on the action card.
- **LLM proposes a `dangerLevel: 'high'` action AND the conversation is in
  sandbox mode**: card shows `DRY-RUN` and the typed-id confirm step is
  REPLACED with a single Approve click (since nothing real executes).
  This avoids muscle-memory confusion when operator later switches off
  sandbox.

### US5 (Sandbox)

- **Canned response missing for a proposed manifest id**: fallback
  generic `{"status":"ok","note":"dry-run"}`. Operator sees a hint
  "Sandbox response is generic — consider adding a fixture for this
  manifest entry".
- **Sandbox toggled OFF mid-conversation**: prior turns retain dry-run
  tag; subsequent tool-calls execute for real. Audit shows the toggle
  event.

### US6 (Compose reviewer)

- **Compose YAML is invalid (parser fails)**: reviewer panel shows
  "Cannot parse — fix syntax first"; no LLM call made (save tokens).
- **App's compose is huge (>50KB)**: reviewer skips with "Compose too
  large for inline review — open Save-time review only"; operator may
  click "Review anyway" to override and consume the cost.
- **Dismissed findings rehydrate when compose changes**: re-emit
  finding-hash with stable hash (text + line + finding-string); if hash
  matches a dismissed entry, suppress. Editing the file may change the
  hash → finding re-surfaces (intentional; significant edits warrant
  re-review).

### US7 (Kill switch)

- **Global kill mid-tool-call execution**: in-flight tool-call run via
  scripts-runner is NOT aborted (scripts-runner has its own lifecycle).
  Only the LLM conversation halts; the script run completes per its
  normal semantics and its result is persisted in `script_runs`. UI
  surfaces the disconnect — "AI was killed; script completed
  independently".
- **Per-server toggle changed mid-execution**: similar — execution
  finishes per scripts-runner; future proposals respect the new policy.

### US8 (Cost)

- **Provider rate-card change**: operator-configurable per provider in
  settings; historical conversations retain their `est_cost_usd` snapshot
  at time of inference (do not retroactively recompute).
- **Token counts disagree between provider response header and our
  counter**: trust provider header; mark deltas in audit if drift
  exceeds 5%.

### US9 (History)

- **Conversation soft-deleted but operator wants to recover**: settings
  → AI Copilot → "Recover archived conversation by ID" surface, requires
  conversation id and emits `ai.conversation_recovered` audit.

## Functional Requirements

### US1 — Configuration

- **FR-001**: New table `ai_provider_keys` stores provider configuration
  per-tenant (single-tenant in v1): `id`, `provider` enum (`anthropic |
  openai | ollama`), `model_default TEXT`, `endpoint_url TEXT NULL` (for
  ollama), `api_key_encrypted TEXT` (envelope-cipher blob from feature
  011), `created_at`, `rotated_at`, `is_active` flag (single active per
  provider; rotation marks old inactive but keeps for archived and
  in-flight conversations).
- **FR-002**: New singleton table `ai_settings` (CHECK `id = 1`, following
  `notification_settings` pattern): `enabled BOOLEAN DEFAULT false`,
  `default_provider TEXT NULL`, `system_prompt_content TEXT NULL`, `monthly_token_budget_in INTEGER`,
  `monthly_token_budget_out INTEGER`, `per_incident_token_cap_in INTEGER`,
  `per_incident_token_cap_out INTEGER`, `global_tool_use_enabled BOOLEAN
  DEFAULT true`, `global_kill_switch_engaged BOOLEAN DEFAULT false`,
  `default_sandbox BOOLEAN DEFAULT false`,
  `conversation_retention_days INTEGER DEFAULT 90`.
- **FR-003**: Settings page MUST render the AI Copilot section with
  controls per US1 acceptance. Provider keys MUST never round-trip to
  the client in cleartext (write-only field; UI shows `••••••••` when a
  key is set).
- **FR-004**: "Test connection" endpoint MUST issue a small probe (≤10
  tokens out) and report success/failure inline. Result NOT persisted
  except as an `audit_entries` row `ai.connection_tested` with
  `{ provider, ok, errorClass? }`.
- **FR-005**: API keys MUST be encrypted at rest via existing
  `envelope-cipher.ts` (same master-key seal as feature 011's
  `ai_provider_keys` — explicit dependency on feature 011's boot check).
- **FR-006**: `ai.provider_configured` audit fires on every save; payload
  excludes the key itself but includes provider name, model default,
  budget values, tool-use enabled flag.

### US2 — Pull-trigger Analysis

- **FR-007**: New table `ai_conversations`: `id TEXT PK`, `trigger TEXT`
  (`pull | push`), `target_kind TEXT` (`app | server | deployment |
  audit_event | cert | script_run | manual`), `target_id TEXT NULL`
  (free-form ref; app/server/deployment ids, audit event id, etc.),
  `provider_key_id REFERENCES ai_provider_keys(id)`, `model TEXT`,
  `status TEXT` (`pending | streaming | completed | error |
  cap_exhausted | aborted_by_kill_switch | provider_rate_limited`),
  `created_at`, `updated_at`, `archived_at NULL`, `prior_conversation_id
  TEXT NULL` (for "re-analyze same target" linkage),
  `tokens_in INTEGER`, `tokens_out INTEGER`, `est_cost_usd NUMERIC`.
- **FR-008**: New table `ai_messages`: `id TEXT PK`, `conversation_id`
  FK, `role TEXT` (`system | user | assistant | tool`), `seq INTEGER`
  (per-conversation order), `content_text TEXT`, `content_meta JSONB`
  (citations array, structured-output fields), `tokens_in INTEGER`,
  `tokens_out INTEGER`, `created_at`.
- **FR-009**: "Analyze with AI" button MUST appear on the surfaces listed
  in US2 acceptance ONLY when AI is enabled AND the surface has
  meaningful context (e.g., no button on a brand-new app with zero
  events).
- **FR-010**: Click MUST create an `ai_conversations` row immediately
  (status `pending`), aggregate context (FR-011 onwards), issue the LLM
  call, stream tokens back via existing WS channel, and persist each
  delta to `ai_messages` (final assistant message also persisted).
- **FR-010a**: Confidence labels use a prompt-defined rubric: `high` means
  3+ independent evidence sources with no material contradiction;
  `medium` means 1-2 strong evidence sources or minor contradictions;
  `low` means circumstantial evidence only or missing key context. The
  system prompt MUST include this rubric.
- **FR-011**: Context aggregator MUST read from existing data sources
  (no new probes, no new SSH calls beyond what existing services
  perform). Sources: `audit_entries` (last 100 for target), `app_health_history`
  (last 50 points for app targets), `script_runs` stdout/stderr (last 5
  runs for the target's app/server), `deploys` (last 5), git compose-diff
  via bootstrap-orchestrator's existing read-only API, `app_cert_events`
  (last 20), feature 006's debounce state.
- **FR-012**: Aggregator MUST mask secrets via `maskContextDocument()`
  BEFORE provider send and BEFORE persisting the context document. The
  sanitizer wraps each untrusted source in explicit delimiters (for
  example `<context-source type="logs" trusted="false">...`) and the
  system prompt instructs the model to treat source content as evidence,
  never as instructions. High-confidence unredacted secret detection
  blocks provider send, persists only the redacted context, and emits
  `ai.context_masking_warning`; lower-confidence detections emit the same
  audit warning for operator review.
- **FR-012a**: Aggregator estimates context token size after masking and
  before provider send. If the context would exceed the configured
  per-incident input cap or provider model context window, it truncates by
  documented priority (oldest logs first, then oldest audit/script/deploy
  items) and records truncation metadata in `content_meta`.
- **FR-013**: Aggregator output (the "context document" sent to the LLM)
  MUST be persisted as the conversation's first user message in
  `ai_messages` — gives operator full transparency into what the LLM
  saw.

### US3 — Push-trigger Analysis

- **FR-014**: Existing event-emitting code paths call
  `aiPushSubscriber.onEvent(eventType, context)` directly for the events
  listed in US3 acceptance. The subscriber service is initialized in
  `server/index.ts` startup phase AFTER feature 011's
  `seedNotificationPreferences` and feature 008's caddy reconciler. No
  application event bus or external queue is introduced in v1.
- **FR-015**: Push subscriber MUST check `ai_settings.enabled = true`
  AND `notification_preferences` row for the event class is `enabled =
  true` AND `ai_settings.global_kill_switch_engaged = false` before
  dispatching. Any disable short-circuits with no audit (avoid spam).
  System-initiated push dispatch also has a global rate limit (default
  30 push analyses/minute) in addition to per-target dedup.
- **FR-016**: Push subscriber creates `ai_conversations` with `trigger
  = 'push'` and runs the aggregator + inference in the background. WS
  emits a `ai.push_analysis_started` event to all connected clients so
  badges update in real time.
- **FR-017**: Push dedup uses a rolling-update window of 300 seconds
  (5 minutes), scoped by `(target_kind, target_id, event_class)` and
  measured from the FIRST event's `created_at` (NOT from most-recent —
  prevents runaway extension). Second-and-subsequent events within the
  window:
  - If the first conversation is `status IN ('pending', 'streaming')` →
    append a new `ai_messages` row (role `tool`, content =
    serialized new event payload) AND prompt the LLM to re-evaluate
    its current hypothesis given the new evidence. `tokens_in` counter
    accumulates. Audit `ai.push_event_absorbed_by_in_flight` emitted
    with `{ conversation_id, new_event_class, window_start_at }`.
  - If the first conversation is in a terminal status (`completed`,
    `error`, `cap_exhausted`, `aborted_by_kill_switch`,
    `provider_rate_limited`) → create a NEW `ai_conversations` row
    with `prior_conversation_id = <first conversation id>`. Audit
    `ai.push_event_new_conversation_post_dedup` emitted with
    `{ prior_conversation_id, window_start_at,
    time_since_window_start_ms }`.
  - After 300 seconds elapses, dedup index entry expires; the next
    matching event always creates a fresh conversation regardless of
    earlier conversation status.

  Implementation detail: an in-memory map `Map<dedupKey, { firstEventAt, conversationId }>`
  satisfies single-process semantics (sufficient for current architecture);
  server restart clears dedup state and a repeated source event may create a
  new conversation. Multi-process dedup would require shared cache (deferred
  to v2 if dashboard horizontally scales).
- **FR-018**: Per-incident token cap MUST be enforced during the push
  analysis. Cap hit → halt, mark `cap_exhausted`, surface badge.

### US4 — Tool-Call Approval and Execution

- **FR-019**: New table `ai_tool_calls`: `id TEXT PK`, `conversation_id`
  FK, `manifest_id TEXT` (e.g., `deploy/server-rollback`), `params_json
  JSONB` (after Zod validation), `target_server_id` FK NULL, `target_app_id`
  FK NULL, `status TEXT` (`proposed | approved | rejected | executing |
  completed | failed | blocked_by_policy | blocked_by_lock`), `script_run_id`
  FK NULL (linkage to `script_runs` row when executed), `dry_run BOOLEAN`,
  `created_at`, `decided_at NULL`, `executed_at NULL`, `decided_by` (operator
  user_id or NULL for auto-rejected).
- **FR-020**: LLM proposes a tool-call by emitting a structured-output
  field (LLM SDK's tool-use mechanism). Proposed call MUST pass through
  manifest's existing Zod params schema BEFORE creating an
  `ai_tool_calls` row. Invalid params → status `rejected` with reason
  in `content_meta`, fed back into LLM context for next turn.
- **FR-021**: New manifest field `reversible: boolean` MUST be added to
  `ScriptManifestEntry` type. Default `false` (conservative). Existing
  entries get explicit values:
  - `logs`, `health-check`, `view-config`, `db/backup` → `reversible: true`.
  - `deploy/server-deploy`, `deploy/project-local-deploy`,
    `deploy/server-rollback`, `deploy/deploy-docker`,
    `db/restore` → `reversible: false` (deploys modify live state).
  - `docker/cleanup` → `reversible: false` (image prune is irreversible
    without rebuild).
  - `bootstrap/hard-delete` → `reversible: false` (already
    `dangerLevel: high`; doubly tagged).
- **FR-022**: LLM system prompt MUST be informed of each tool's
  `dangerLevel` AND `reversible` flags so it can prefer safer
  alternatives. Prompt template includes guidance text.
- **FR-023**: IncidentView tool-call card MUST render: action name,
  params (editable form derived from Zod schema), target server (when
  applicable, dropdown), `dangerLevel` badge, `reversible` badge,
  Approve / Edit / Reject buttons. Approve button is disabled when:
  - Per-server policy disallows (US7), OR
  - LLM tool-use globally disabled (US1), OR
  - Sandbox forced for this server (US7).
- **FR-024**: Approve dispatch per `dangerLevel` is server-enforced:
  - `low` → execute immediately on authenticated operator approval.
  - `medium` → approval request MUST include `ackText = "approve"`.
  - `high` → approval request MUST include `typedTarget` matching the
    expected app/server name AND a server-issued `approvalChallengeId`
    whose 5-second cooldown has elapsed. Client timers alone are not a
    security control.
- **FR-025**: Execution dispatches via existing `scriptsRunner`. New
  `script_runs.initiated_by` column added: `'operator' | 'ai_proposal'`.
  When `'ai_proposal'`, `script_runs.ai_conversation_id` and `script_runs.ai_tool_call_id`
  columns ALSO populated. These linkage columns enable the audit trail
  query "show me all AI-initiated runs in last 30 days".
- **FR-026**: Post-execution, the LLM receives a tool-result message in
  the conversation: stdout (truncated to 8KB if longer), exit code,
  artifact ref (when manifest entry has `outputArtifact`). The LLM may
  reason on the result and propose further actions OR conclude.
- **FR-027**: `audit_entries` MUST capture every state transition on
  `ai_tool_calls`: `ai.tool_call_proposed`, `ai.tool_call_approved`,
  `ai.tool_call_rejected`, `ai.tool_call_executed`, `ai.tool_call_failed`,
  `ai.tool_call_blocked_by_policy`, `ai.tool_call_blocked_by_lock`.

### US5 — Sandbox

- **FR-028**: `ai_conversations.sandbox_mode BOOLEAN` column tracks
  per-conversation override. Default = `ai_settings.default_sandbox`
  (new boolean column, default `false` for the existing operator pool;
  default `true` for newly-added servers per US7).
- **FR-029**: Sandbox response library lives at
  `server/services/ai/sandbox-fixtures.ts` (new file). Exports a `Record<manifest_id, CannedResponse>`.
  Generic fallback used when no entry matches.
- **FR-030**: All tool-call audit entries record `dry_run BOOLEAN`
  alongside the status transition. Querying "real executions only"
  filters `dry_run = false`.

### US6 — Compose Reviewer

- **FR-031**: New table `ai_dismissed_findings`: `app_id` FK,
  `finding_hash TEXT`, `dismissed_at`, primary key `(app_id, finding_hash)`.
- **FR-032**: EditAppPage MUST render a "Compose Lint + AI Review"
  panel implementing the hybrid trigger model:
  - **Static lint** (synchronous, debounced 300ms on textarea change):
    parses YAML AST via existing `compose-parser.ts`, evaluates a
    curated rule catalogue at `server/lib/compose-static-lint.ts`
    (new file). Each rule emits `{ severity, line, finding, suggestion }`.
    No LLM call. Cost: zero. Initial rule catalogue:
    1. `image: latest` → warn ("pinned tag recommended for reproducibility")
    2. `ports` mapping to reserved ranges (22, 3306, 5432, 6379, 27017,
       9200, 9300, etc.) without an `expose:` alternative → warn
    3. Missing `healthcheck:` on service that ANY blue/green deploy
       depends on → warn (feature 012 cross-check)
    4. `env:` value matching common secret patterns (sk-..., ghp_...,
       AKIA..., -----BEGIN ...) → error ("use env-vars-store instead")
    5. `privileged: true` → warn ("requires explicit justification")
    6. Bind-mount to `/`, `/etc`, `/var/run/docker.sock` without
       explicit operator acknowledgement → error
    7. Service depends_on missing → info ("consider declaring startup ordering")
  - **LLM review** (on-demand, button-triggered): "Review with AI"
    button calls the reviewer endpoint. Content-hash keyed result
    cache (`ai_compose_review_cache` keyed by `(app_id, content_sha256)`)
    returns cached findings without re-spending tokens; cache entry
    expires 24h after `created_at` OR is invalidated when the app's
    saved compose content changes.
- **FR-033**: Reviewer LLM call uses a separate `ai_conversations` row
  with `target_kind = 'compose_review'`, `target_id = <app_id>`. These
  conversations are short-lived (one user message + one assistant
  message) and count toward the same budget as incident analyses.
- **FR-034**: Each finding is hashed: `sha256(line_number + finding_text +
  suggestion_text)`. Hash stable across re-runs of the same compose
  content; changes when content changes (intentional).
- **FR-035**: Dismissed findings are filtered server-side before
  returning the review payload to the client. Re-emergence on content
  change is intentional.

### US7 — Kill Switch

- **FR-036**: New columns on `servers` table: `ai_read_access BOOLEAN
  DEFAULT true`, `ai_write_access TEXT DEFAULT 'sandbox-only'`
  (`enabled | sandbox-only | disabled`).
- **FR-037**: Migration MUST set default `ai_write_access = 'enabled'`
  for servers that EXIST before this feature's migration (preserving
  status quo), and `'sandbox-only'` for servers added AFTER.
- **FR-038**: Global `ai_settings.global_kill_switch_engaged` when
  `true`: BLOCKS all new inference + all new tool-call execution. Surfaces
  a dashboard-wide red banner. Existing in-flight conversation finishes
  its current streaming chunk and halts at next turn boundary.
- **FR-039**: Per-server `ai_write_access` enforcement happens at
  tool-call dispatch time, NOT at proposal time. LLM may still propose
  against a disallowed server (it isn't aware of the policy in v1) and
  the UI surfaces "Server policy disallows execution" instead of an
  Approve button. The proposal IS persisted (for audit).
- **FR-040**: `audit_entries` `ai.kill_switch_engaged` and
  `ai.kill_switch_released` emitted on global toggle.
  `ai.server_policy_changed` emitted on per-server toggle.

### US8 — Cost

- **FR-041**: Token usage MUST be summed from provider response headers
  (or response JSON for streaming) and persisted to `ai_conversations.tokens_in`
  and `tokens_out` on completion / cap-hit / error.
- **FR-042**: Per-provider rate-card MUST be configurable (new table
  `ai_provider_rate_cards` or columns on `ai_provider_keys`); default
  rates seeded from current published prices, operator may update.
- **FR-043**: `est_cost_usd` MUST be computed at conversation completion
  (or cap-hit) using the rate-card valid AT TIME OF INFERENCE (not
  current). Stored as a snapshot.
- **FR-044**: Settings page Spend sub-section MUST render: monthly
  rolling totals (input + output + USD), today, recent conversations
  table. Monthly counter resets at midnight UTC on day 1 of each
  calendar month.
- **FR-045**: Budget enforcement: pull-trigger surfaces inline "budget
  exhausted" error; push-trigger silently skips with audit; both consult
  `ai_settings.monthly_token_budget_*` BEFORE issuing the first LLM
  call. The budget enforcer reserves a conservative token estimate before
  inference starts and reconciles against actual provider usage on
  completion/error to avoid concurrent request overspend.

### US9 — History

- **FR-046**: `/api/ai/conversations` endpoint MUST list conversations with
  filters (trigger, target_kind, status, date range, full-text search
  over hypothesis content). Pagination follows existing API conventions.
- **FR-047**: `/incidents` page renders the list with column set per US9
  acceptance. Row click opens IncidentView in history mode (no new
  inference; replay only).
- **FR-048**: Soft-delete cron MUST run daily and set `archived_at = NOW()`
  on conversations older than `ai_settings.conversation_retention_days`
  (default 90). Archived rows are filtered from the list but recoverable.
- **FR-049**: Recovery endpoint accepts a conversation id; clears
  `archived_at`; emits `ai.conversation_recovered` audit.

### Cross-cutting

- **FR-050**: All AI features respect existing `requireAuth` middleware.
  No anonymous access to any AI endpoint. AI endpoints additionally require
  role checks: `ai:admin` for provider/settings/kill-switch/rate-card
  mutations, `ai:operator` for creating analyses and approving/rejecting
  tool calls, and `ai:viewer` (or stronger) for reading conversation
  history. High-danger tool approval requires `ai:operator` plus the
  FR-024 server-side confirmation challenge.
- **FR-051**: All AI mutations emit `audit_entries` via existing
  `auditMiddleware`. Audit-coverage parity with existing dashboard
  surfaces is mandatory.
- **FR-052**: All AI features respect existing `rate-limit.ts` middleware
  pattern: per-user inference creation rate-limited (default 10/min);
  burst above limit returns 429.
- **FR-053**: AI subsystem MUST be implementable as feature-flagged off
  by default. The `ai_settings.enabled` flag gates routes, UI
  rendering, push subscribers, and migrations of read-only columns
  (the schema changes apply unconditionally for forward-compat; the
  feature is dormant until enabled).
- **FR-054**: AI errors (provider unreachable, rate-limited, malformed
  response) MUST NEVER cascade-fail other dashboard functionality.
  Existing health-poller, deploy-dispatch, caddy-reconciler, etc.,
  operate identically whether AI is up or down.
- **FR-055**: Mid-stream visibility of LLM tool-calls follows a
  **log-only in IncidentView** model. Each `ai_tool_calls` state
  transition (`proposed → approved/rejected → executing → completed/failed`)
  emits a WS event on the conversation's dedicated channel
  (`ai:<conversationId>`). The IncidentView renders these
  transitions as a real-time "Activity" timeline (chronological list of
  tool-call cards). NO global toast notification surfaces for
  `dangerLevel: low` approved executions — operators see low-danger AI
  activity ONLY when they have the IncidentView open. This minimises
  notification fatigue while preserving the v1 invariant that every tool
  execution was approved by an operator.

  EXCEPTION — destructive tool-calls (`dangerLevel ∈ {medium, high}`)
  emit a separate TG message via `ai.tool_call_executed_destructive`
  notification trigger (feature 011 catalogue, default ON). The TG
  message contains target server, manifest id, parameters summary, and
  a deep link to the IncidentView. Rationale: destructive actions
  warrant proactive visibility regardless of which page the operator
  is currently looking at.

  No dashboard-wide banner for ANY individual tool-call. Banners are
  reserved for global-state events (kill switch engaged, budget
  exhausted, conversation aborted by timeout, provider unreachable system-wide).

## Success Criteria

- **SC-001**: 80% of pull-trigger AI analyses return a hypothesis +
  evidence block within 30 seconds (P50; P95 within 60 seconds),
  measured over a 30-day rolling window post-rollout. Provider latency
  variance is the dominant factor; this metric assumes Anthropic or
  OpenAI cloud endpoints, not Ollama on a constrained host.
- **SC-002**: Operator-perceived incident resolution time reduced by
  40% from baseline (measured pre/post rollout via audit timestamps
  from `audit_entries`: `incident_start` event class → `incident_resolved`
  marker). Baseline established in the 30 days before rollout.
- **SC-003**: 100% of executed tool-calls (status = `completed` OR
  `failed`) have a corresponding `script_runs` row with `initiated_by =
  'ai_proposal'` AND an `audit_entries` `ai.tool_call_executed` row.
  Audit-trail completeness is a hard invariant.
- **SC-004**: 0 destructive tool-calls (status `completed` AND
  `dangerLevel ∈ {medium, high}`) executed without an explicit
  operator approval audit row. Defence-in-depth: enforced by FR-024
  AND verified by audit-completeness test at boot.
- **SC-005**: 95% of LLM-proposed remediations that the operator
  approved and executed resulted in incident resolution within 5
  minutes (observational quality metric, not launch gate). Denominator:
  real executions (`dry_run = false`) where the tool-call was the first
  approved remediation for that conversation and the target had an active
  incident marker. Success: health probe RED → GREEN, deploy status
  `failed` → `succeeded`, or audit `incident_resolved` within 5 minutes
  after `ai.tool_call_executed`. Follow-up tool calls in the same
  conversation are tracked separately but excluded from the primary ratio.
- **SC-006**: 100% of LLM context payloads sent to providers pass
  through `mask-secrets.ts` BEFORE leaving the dashboard host (verified
  by audit-trail test + dev-time logging). 0 known-secret patterns in
  outbound LLM payloads over a 30-day rolling window.
- **SC-007**: Global kill switch engagement halts all new inference and
  new tool-call execution within 10 seconds in 100% of attempts
  (verified by manual + chaos-injection tests).
- **SC-008**: Cost reporting accuracy within 5% of provider billing
  invoice for a 30-day window (verified by manual reconciliation
  post-rollout). Drift > 5% triggers `ai.cost_drift_alert` audit and
  optional TG dispatch.

## Key Entities

### `ai_settings` (new)

- `id INTEGER PK CHECK (id = 1)`
- `enabled BOOLEAN NOT NULL DEFAULT false`
- `default_provider TEXT NULL`
- `system_prompt_content TEXT NULL`
- `monthly_token_budget_in INTEGER NOT NULL DEFAULT 5000000`
- `monthly_token_budget_out INTEGER NOT NULL DEFAULT 1000000`
- `per_incident_token_cap_in INTEGER NOT NULL DEFAULT 100000`
- `per_incident_token_cap_out INTEGER NOT NULL DEFAULT 20000`
- `global_tool_use_enabled BOOLEAN NOT NULL DEFAULT true`
- `global_kill_switch_engaged BOOLEAN NOT NULL DEFAULT false`
- `default_sandbox BOOLEAN NOT NULL DEFAULT false`
- `conversation_retention_days INTEGER NOT NULL DEFAULT 90`
- `updated_at TEXT NOT NULL`

### `ai_provider_keys` (new)

- `id TEXT PK`
- `provider TEXT NOT NULL` — `'anthropic' | 'openai' | 'ollama'` (CHECK enum)
- `model_default TEXT NOT NULL`
- `endpoint_url TEXT NULL` (ollama only)
- `api_key_encrypted TEXT NOT NULL` (envelope-cipher sealed JSON/base64 blob)
- `created_at TEXT NOT NULL`
- `rotated_at TEXT NULL`
- `is_active BOOLEAN NOT NULL DEFAULT true` (one active per provider)
- Unique constraint: `(provider) WHERE is_active = true`

### `ai_conversations` (new)

- `id TEXT PK`
- `trigger TEXT NOT NULL` — `'pull' | 'push'`
- `target_kind TEXT NOT NULL` — `'app' | 'server' | 'deployment' | 'audit_event' | 'cert' | 'script_run' | 'manual' | 'compose_review'`
- `target_id TEXT NULL`
- `provider_key_id TEXT REFERENCES ai_provider_keys(id) NOT NULL`
- `model TEXT NOT NULL` (snapshot at creation; provider rotation does not retroactively change)
- `status TEXT NOT NULL` — `'pending' | 'streaming' | 'completed' | 'error' | 'cap_exhausted' | 'aborted_by_kill_switch' | 'provider_rate_limited'`
- `sandbox_mode BOOLEAN NOT NULL DEFAULT false`
- `prior_conversation_id TEXT NULL REFERENCES ai_conversations(id)` (for re-analysis linkage)
- `tokens_in INTEGER NOT NULL DEFAULT 0`
- `tokens_out INTEGER NOT NULL DEFAULT 0`
- `est_cost_usd NUMERIC NOT NULL DEFAULT 0`
- `created_at`, `updated_at`, `archived_at NULL`

### `ai_messages` (new)

- `id TEXT PK`
- `conversation_id TEXT REFERENCES ai_conversations(id) NOT NULL`
- `role TEXT NOT NULL` — `'system' | 'user' | 'assistant' | 'tool'`
- `seq INTEGER NOT NULL` (per-conversation order)
- `content_text TEXT NOT NULL`
- `content_meta JSONB` (citations array, structured-output, tool-call refs)
- `tokens_in INTEGER NOT NULL DEFAULT 0`
- `tokens_out INTEGER NOT NULL DEFAULT 0`
- `created_at`
- Unique constraint: `(conversation_id, seq)`

### `ai_tool_calls` (new)

- `id TEXT PK`
- `conversation_id TEXT REFERENCES ai_conversations(id) NOT NULL`
- `manifest_id TEXT NOT NULL` — e.g., `'deploy/server-rollback'`
- `params_json JSONB NOT NULL` (after Zod validation)
- `target_server_id TEXT NULL REFERENCES servers(id)`
- `target_app_id TEXT NULL REFERENCES applications(id)`
- `status TEXT NOT NULL` — `'proposed' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed' | 'blocked_by_policy' | 'blocked_by_lock'`
- `script_run_id TEXT NULL REFERENCES script_runs(id)` (linkage when executed)
- `dry_run BOOLEAN NOT NULL DEFAULT false`
- `decided_by TEXT NULL` (operator who approved/rejected)
- `created_at`, `decided_at NULL`, `executed_at NULL`

### `ai_dismissed_findings` (new)

- `app_id TEXT NOT NULL REFERENCES applications(id)`
- `finding_hash TEXT NOT NULL` (sha256 of line + text + suggestion)
- `dismissed_at TEXT NOT NULL`
- Primary key: `(app_id, finding_hash)`

### `servers` (modified — 2 new columns)

- `ai_read_access BOOLEAN NOT NULL DEFAULT true`
- `ai_write_access TEXT NOT NULL DEFAULT 'sandbox-only'` — `'enabled' | 'sandbox-only' | 'disabled'`
  (Migration sets `'enabled'` for pre-existing servers; default applies to new.)

### `script_runs` (modified — 3 new columns)

- `initiated_by TEXT NOT NULL DEFAULT 'operator'` — `'operator' | 'ai_proposal'`
- `ai_conversation_id TEXT NULL REFERENCES ai_conversations(id)`
- `ai_tool_call_id TEXT NULL REFERENCES ai_tool_calls(id)`

### `audit_entries` (existing — new event types)

- `ai.provider_configured`, `ai.provider_key_rotated`, `ai.connection_tested`
- `ai.provider_configure_failed`
- `ai.analysis_started`, `ai.analysis_completed`, `ai.analysis_failed`
- `ai.push_analysis_started`, `ai.push_analysis_skipped`
- `ai.budget_exhausted_skipped_push`
- `ai.tool_call_proposed`, `ai.tool_call_approved`, `ai.tool_call_rejected`,
  `ai.tool_call_executed`, `ai.tool_call_failed`, `ai.tool_call_blocked_by_policy`,
  `ai.tool_call_blocked_by_lock`
- `ai.context_masking_warning`, `ai.cost_drift_alert`
- `ai.kill_switch_engaged`, `ai.kill_switch_released`, `ai.server_policy_changed`
- `ai.conversation_recovered`

### `ScriptManifestEntry` (modified type — 1 new field)

- `reversible: boolean` (default `false` if omitted). LLM system prompt
  surfaces this; UI badge reflects it on tool-call cards.

## Assumptions

- **A-001**: Single-operator-pool model from existing dashboard — no
  multi-tenant LLM context isolation needed in v1. (Multi-tenant future
  would add `tenant_id` columns to all AI tables.)
- **A-002**: Operators bring their own provider API keys; dashboard is
  not a SaaS LLM proxy and does not bundle credits.
- **A-003**: LLM behaviour is non-deterministic. Safety relies on
  tool-tier gating (`dangerLevel` + `reversible`) and operator-in-loop
  approval, NOT on model alignment alone.
- **A-004**: ssh-pool, audit, deploy_lock, scripts-runner, envelope-cipher,
  mask-secrets, notification-gate, and source event-emitting subsystems are
  stable enough for AI subsystem to call from without broad reshaping.
  Any reshape of those subsystems would require AI adapter updates.
- **A-005**: Compose YAML reviewer (US6) is best-effort static analysis
  via LLM; it does NOT replace structural linting (`compose-parser.ts`
  validation) which remains the source of truth for "compose is
  invalid".
- **A-006**: Push triggers are direct in-process calls from existing
  event-emitting code paths; no external message queue is added.
  Reliability is "best-effort same process" — server restart between event
  emission and AI analysis loses that analysis (operator can pull-trigger
  after restart). After restart, in-memory push dedup state is empty, so a
  repeated source event can create a new conversation.
- **A-007**: Vercel AI SDK is the provider abstraction. Anthropic, OpenAI,
  and Ollama/OpenAI-compatible model support is gated by the SDK version
  pinned in `package.json`; provider-specific tool-use gaps are surfaced as
  `ai.analysis_failed` rather than hidden behind a custom interface.
- **A-008**: Provider rate-card USD pricing changes are slow enough that
  manual operator updates (US8 settings table) are acceptable. No
  automatic price-feed in v1.
- **A-009**: 90-day conversation retention is sufficient for forensic
  audit; older incidents that need review are recoverable via direct
  DB query (and `ai.conversation_recovered` audit).

## Dependencies

- **Feature 005** (universal-script-runner): manifest is the tool
  registry source. This feature ADDS `reversible: boolean` to
  `ScriptManifestEntry` and LIFTS the "no LLM-driven dispatch" scope-out
  from spec 005. Manifest validation (existing `validateManifestLenient`)
  is the first line of safety.
- **Feature 006** (app-health-monitoring): provides `app.health_red`,
  `app.health_recovered` events to the push subscriber. Notification
  dispatch path reused for "AI analysis completed" optional TG.
- **Feature 008** (application-domain-and-tls): provides
  `app.cert_expiring_soon` and `app.cert_renewal_failed` events. Caddy
  admin client read access used for cert-related context aggregation.
- **Feature 009** (bootstrap-deploy-from-repo): provides git compose-diff
  via bootstrap-orchestrator's existing read-only API; used in context
  aggregation.
- **Feature 010** (operational-maturity): FailureCard state vocabulary
  extended with `ai_analysis_in_progress`, `ai_proposed_remediation`.
  Hooks (`pre_deploy`, `post_deploy`, `on_fail`) MAY emit events the
  push subscriber listens to (operator-configurable).
- **Feature 011** (zero-touch-onboarding): provides envelope-cipher
  master-key seal + boot check pattern for `ai_provider_keys` storage.
  `notification_preferences` catalogue extended with AI event classes.
- **Feature 012** (blue-green-deploy): push subscriber listens to
  `deploy.candidate_failed_rollback` and `deploy.caddy_admin_failure_post_switch`
  among other failure phases. No coupling beyond event subscription.

## Out of Scope

- **Automatic remediation execution without operator approval** (any
  `dangerLevel`). Even `low` actions go through a proposal flow in v1.
  Auto-low-execution is a v2 feature with a separate explicit operator
  consent flow.
- **Provider failover** (if Anthropic 5xx, fall back to OpenAI). v2.
  v1 retries transient failures on the selected provider only.
- **Multi-tenant LLM context isolation** — single-tenant only in v1.
- **Custom-model fine-tuning** on this org's historical incidents.
  Out-of-scope; v3 candidate if data accumulates enough.
- **Predictive alerts** ("LLM predicts your cert will expire in 6 days").
  Pre-existing cert-expiry-alerter handles this; LLM is reactive only.
- **App store / one-click installs powered by LLM recommendations**.
  Separate future feature.
- **Cross-conversation memory** ("the LLM remembers across incidents").
  Each conversation is fresh-context; persistent memory is operator's
  job via the history view (US9).
- **Multi-LLM ensemble** (run both Anthropic and OpenAI, compare). v2.
- **Speech-to-text / voice input** to start an incident analysis. Out of mission.
- **In-conversation LLM evaluation** ("rate this answer 1–5 stars") with
  fine-tuning loop. v3.
- **Auto-fixing compose YAML** (LLM writes a patch and applies). v1
  is read-only review; operator manually applies suggestions.
- **LLM-authored playbooks / runbooks**. Out of mission — runbooks
  remain operator-authored (`docs/runbooks/`).

## Related

- Spec 005 `/specs/005-universal-script-runner/spec.md`: explicitly
  declared "no LLM-driven dispatch". This feature lifts that. Cross-reference
  this spec from 005's Out of Scope when this ships.
- Spec 006 `/specs/006-app-health-monitoring/spec.md`: push trigger source.
- Spec 008 `/specs/008-application-domain-and-tls/spec.md`: push trigger source.
- Spec 009 `/specs/009-bootstrap-deploy-from-repo/spec.md`: context source (compose-diff).
- Spec 010 `/specs/010-operational-maturity/spec.md`: FailureCard
  vocabulary extension; hook events as push triggers.
- Spec 011 `/specs/011-zero-touch-onboarding/spec.md`: envelope-cipher
  + notification_preferences catalogue. This feature reserves
  migration 0013 (011 reserves 0010, 010 reserves 0011, 012 reserves 0012).
- Spec 012 `/specs/012-blue-green-deploy/spec.md`: push trigger source.
- Brainstorm session (2026-05-18): origin of "AI overlay on existing
  engine, not fork of competitor". Decisions: pluggable LLM, hybrid
  push/pull, max-rights + 8-layer safety, feature 013 as single spec.

## Open Questions

- ~~**OQ-001 (US3)**~~: **RESOLVED** in Session 2026-05-18 (Q1) —
  rolling-update window 5 minutes per `(target_kind, target_id,
  event_class)`; in-flight conversation absorbs subsequent events,
  terminal conversations spawn linked successor. See FR-017.
- ~~**OQ-002 (US6)**~~: **RESOLVED** in Session 2026-05-18 (Q2) —
  hybrid: static lint on keystroke (zero LLM cost), LLM review on
  explicit button click with 24h content-hash cache. See FR-032.
- ~~**OQ-003 (US4)**~~: **RESOLVED** in Session 2026-05-18 (Q3) —
  log-only in IncidentView Activity timeline; no global toast for
  `dangerLevel: low`; TG message for `dangerLevel ≥ medium` only.
  See FR-055.
- **OQ-004 (US7)**: Per-environment kill switch (`production`,
  `staging`, etc.) instead of per-server only — defer to v2 if
  servers grow categories.
- ~~**OQ-005 (US2)**~~: **RESOLVED** in research.md R-009 — dedicated
  `/incidents/:id` route, opened from inline "Analyze with AI" buttons.
- **OQ-006 (Cross-cutting)**: Conversation export format for offline
  review (JSON, markdown, both). Defer to v2.

## Notification triggers (feature 011 catalogue extension)

This feature adds new entries to the notification event catalogue
(feature 011 `notification_preferences`). Each fires a TG message when
the event type is enabled in operator preferences:

- `ai.analysis_completed_high_severity` — success-class, default OFF
  (operator opts in if they want a TG ping when AI finishes analyzing a
  high-severity push event)
- `ai.tool_call_executed_destructive` — security-class, default ON
  (every `dangerLevel ≥ medium` AI-initiated run pings TG so operators
  know what AI is doing on their behalf)
- `ai.budget_exhausted` — operational-class, default ON
- `ai.kill_switch_engaged` — security-class, default ON
  (critical — global state change)
- `ai.cost_drift_alert` — operational-class, default ON
- `ai.context_masking_warning` — security-class, default ON
  (PII redaction quality is a security concern)
