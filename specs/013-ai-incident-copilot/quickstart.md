# Quickstart: AI Incident Copilot

**Feature**: 013 | **Date**: 2026-05-19

## Prerequisites

- Dashboard running with features 005-012 deployed
- An API key for Anthropic, OpenAI, or a running Ollama instance
- `DASHBOARD_MASTER_KEY` configured (feature 011 envelope-cipher)

## Step 1: Configure AI Provider (US1)

1. Navigate to **Settings → AI Copilot**
2. Toggle **Enable AI Copilot** → ON
3. Click **Add Provider**:
   - Select provider (e.g., `anthropic`)
   - Enter model (e.g., `claude-sonnet-4-20250514`)
   - Paste API key (stored encrypted, never shown again)
   - Optionally set rate card ($/M tokens) for cost tracking
4. Click **Test Connection** — expect "Connected, 342ms"
5. Set budget limits:
   - Monthly: 5M input / 1M output tokens (default)
   - Per-incident: 100K input / 20K output tokens (default)
6. Click **Save**

**Smoke check**: Settings page shows provider status "Active". Audit log shows `ai.provider_configured`.

## Step 2: Pull-trigger Analysis (US2)

1. Navigate to an app with health status RED (or a failed deployment)
2. Click **"Analyze with AI"** button
3. You're redirected to `/incidents/<id>` — the IncidentView:
   - **Context summary** shows what data was aggregated (e.g., "87 log lines, 12 audit events, 5 health points, 1 compose diff")
   - **Hypothesis** streams in real-time: "Container OOM-killed due to 256MB memory limit; Java heap set to 512MB in compose env..."
   - **Confidence**: `high`
   - **Evidence**: bulleted citations with log line references and audit event IDs

**Smoke check** (SC-001): First token appears within 3 seconds. Full hypothesis within 30 seconds.

## Step 3: Review AI-Proposed Remediation (US4)

If the AI proposes a remediation:
1. A **tool-call card** appears in the Activity timeline:
   - Action: `deploy/server-rollback`
   - Params: `{ appId: "...", targetTag: "v1.2.3" }`
   - Danger badge: amber (`medium`)
   - Reversible badge: red (not reversible)
2. Review the params — you can **edit** them before approving
3. Click **Approve**:
    - For `medium` danger: type "approve" in the confirmation modal
    - For `high` danger: the server issues an approval challenge; type the
      app/server name + wait until the server-side 5-second cooldown elapses
4. Execution dispatches via `scriptsRunner` — same as clicking "Run" in the UI
5. Result streams back to the AI; it may propose follow-up actions or conclude

**Smoke check** (SC-003): `script_runs` row has `initiated_by = 'ai_proposal'`. Audit shows `ai.tool_call_approved` + `ai.tool_call_executed`.

## Step 4: Enable Push Triggers (US3)

1. Navigate to **Settings → Notifications**
2. Under AI event types, enable the push triggers you want:
   - `app.health_red` → auto-analyze on health RED
   - `deploy.failed` → auto-analyze on deploy failure
   - `app.cert_expiring_soon` → auto-analyze cert issues
3. When a matching event fires, AI analysis starts automatically
4. A badge appears on the relevant dashboard surface: "AI analyzed — click to view"
5. Optional: enable TG notification for `ai.tool_call_executed_destructive`

**Smoke check**: Trigger a health RED → check `/incidents` for a push-triggered conversation.

## Step 5: Sandbox Mode (US5)

1. Navigate to **Settings → AI Copilot**
2. Toggle **Default to Sandbox** → ON
3. New conversations run in dry-run mode:
   - AI proposes tool calls as normal
   - Execution returns canned responses instead of real SSH commands
   - All cards labelled "DRY-RUN"
   - Audit entries tagged `dry_run = true`
4. Per-server override: **Server Settings → AI Copilot Access → Write Access → Sandbox Only**

**Smoke check**: Run an analysis → approve a tool call → verify no real execution (audit shows `dry_run = true`).

## Step 6: Compose Reviewer (US6)

1. Navigate to **Apps → [app] → Edit**
2. Edit the compose YAML — static lint fires on keystroke:
   - `image: latest` → amber inline warning
   - `privileged: true` → red inline warning
3. Click **"Review with AI"** for deeper semantic analysis
4. Review findings list — dismiss false positives with "Dismiss"
5. Dismissed findings persist per app; won't re-surface until compose changes

## Step 7: Per-Server Policy & Kill Switch (US7)

**Per-server**:
1. **Server Settings → AI Copilot Access**
2. Set Write Access: `enabled | sandbox-only | disabled`
3. New servers default to `sandbox-only`

**Global kill switch**:
1. **Settings → AI Copilot → Kill Switch → Engage**
2. Red banner appears across dashboard
3. All new inference blocked; in-flight conversations finish current chunk and halt
4. To release: toggle OFF → `ai.kill_switch_released` audit emitted

## Step 8: Monitor Costs (US8)

1. **Settings → AI Copilot → Spend**
2. View: this month's tokens (in/out), estimated USD, conversation count
3. Per-conversation breakdown table below
4. When budget exhausts: pull-trigger shows "Budget exhausted" inline; push-trigger silently skips

## Verification Checklist

| SC | What to verify | How |
|---|---|---|
| SC-001 | Hypothesis within 30s | Time from click to full response |
| SC-003 | Audit trail complete | Query `audit_entries WHERE action LIKE 'ai.%'` |
| SC-004 | No unapproved destructive executions | Query `ai_tool_calls WHERE status='completed' AND dry_run=false` — all must have `decided_by IS NOT NULL`; direct API approve without required ack/challenge returns 428 |
| SC-006 | Secrets masked | Check `ai_messages` first user message — no `sk-`, `ghp_`, `AKIA` patterns; untrusted logs/compose/audit are wrapped in source delimiters |
| SC-007 | Kill switch halts within 10s | Engage kill switch → time until in-flight conversation halts |
