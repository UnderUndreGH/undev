# SpecKit Analyze: 013-ai-incident-copilot

**Reviewer**: analyze (Claude self-consistency)
**Reviewed at**: 2026-05-19T14:30:00Z
**Commit**: ffcd8431f856857d159bf6c19dc87c3c12634f3b
**Artifacts**: spec.md, plan.md, tasks.md, data-model.md, contracts/api.md, contracts/llm-provider.md, research.md, quickstart.md

## Findings

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| C1 | Coverage | MEDIUM | spec.md:FR-009 L599, tasks.md:T036-T039 | FR-009 lists "AuditPage rows with `severity = high`" as an AnalyzeButton surface. No task explicitly mounts the button on AuditPage. Tasks T038/T039 cover AppPage and RunDetail only. | Add T038b [FE] [US2] to mount AnalyzeButton on AuditPage for high-severity rows |
| C2 | Coverage | MEDIUM | spec.md:FR-009 L185, tasks.md:T036 | FR-009 lists ServerPage and cert-expiring banner as AnalyzeButton surfaces. T036 description mentions them but no dedicated mount tasks exist (only T038 for AppPage, T039 for RunDetail). | Add T038c [FE] [US2] for ServerPage mount and T038d [FE] [US2] for cert-banner mount, or clarify T036 description implies all mounts in one task |
| F1 | Inconsistency | MEDIUM | spec.md:L910 "api_key_encrypted BYTEA", data-model.md:L38 "api_key_encrypted TEXT" | Spec Key Entities describes `api_key_encrypted` as `BYTEA` but data-model uses `TEXT`. Project convention stores envelope-cipher JSON blobs (`{ct,iv,tag}` base64 strings) as TEXT. Data-model is correct for the project. | Accept TEXT as correct. Spec Key Entities section is aspirational; data-model.md is the binding design artifact |
| F2 | Inconsistency | LOW | spec.md:FR-002 "New columns on `settings`", plan.md "new `ai_settings` singleton table" | Spec describes adding columns to an existing `settings` table. Plan creates a new `ai_settings` table because no single-row `settings` table exists — only `app_settings` (KV) and `notification_settings` (singleton). Correct design decision documented in research.md R-002. | No action needed. Research.md documents the rationale. UX and data semantics are identical. |
| B1 | Ambiguity | LOW | spec.md:OQ-005 L1132 | OQ-005 (IncidentView placement) says "defer to /speckit.plan UI design phase" but was resolved in research.md R-009 (dedicated route `/incidents/:id`). Not marked RESOLVED in spec. | Mark OQ-005 as RESOLVED in spec.md with back-reference to research.md R-009 (low priority, informational only) |

## Coverage Summary

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|
| FR-001 (ai_provider_keys) | Yes | T002, T003 | |
| FR-002 (settings columns) | Yes | T002, T003 | Implemented as ai_settings table |
| FR-003 (Settings UI) | Yes | T024, T025 | |
| FR-004 (Test connection) | Yes | T023 | |
| FR-005 (Envelope cipher) | Yes | T023 | |
| FR-006 (Audit on save) | Yes | T014, T022 | |
| FR-007 (ai_conversations) | Yes | T002, T003 | |
| FR-008 (ai_messages) | Yes | T002, T003 | |
| FR-009 (Analyze button) | Partial | T036, T038, T039 | Missing AuditPage, ServerPage, cert-banner mounts |
| FR-010 (Click creates conv) | Yes | T031, T013 | |
| FR-011 (Context aggregator) | Yes | T011 | |
| FR-012 (Mask secrets) | Yes | T007 | |
| FR-013 (Persist context) | Yes | T013 | |
| FR-014 (Push subscriber) | Yes | T041 | |
| FR-015 (Push checks) | Yes | T041 | |
| FR-016 (Push creates conv) | Yes | T041 | |
| FR-017 (Dedup 5-min) | Yes | T041 | |
| FR-018 (Per-incident cap) | Yes | T010, T041 | |
| FR-019 (ai_tool_calls) | Yes | T002, T003 | |
| FR-020 (Zod validation) | Yes | T046 | |
| FR-021 (reversible field) | Yes | T005 | |
| FR-022 (System prompt) | Yes | T009 | |
| FR-023 (IncidentView card) | Yes | T049 | |
| FR-024 (Approve per danger) | Yes | T047, T050 | |
| FR-025 (scriptsRunner) | Yes | T048 | |
| FR-026 (Post-exec result) | Yes | T046 | |
| FR-027 (Audit tool-call) | Yes | T014, T046 | |
| FR-028 (sandbox_mode) | Yes | T002 | |
| FR-029 (Sandbox fixtures) | Yes | T012 | |
| FR-030 (Audit dry_run) | Yes | T055 | |
| FR-031 (dismissed_findings) | Yes | T002 | |
| FR-032 (Hybrid lint) | Yes | T016, T059, T061, T062, T064 | |
| FR-033 (Compose conv) | Yes | T060 | |
| FR-034 (Finding hash) | Yes | T059 | |
| FR-035 (Server-side dismiss) | Yes | T059 | |
| FR-036 (servers AI cols) | Yes | T002, T003 | |
| FR-037 (Migration defaults) | Yes | T002 | |
| FR-038 (Kill switch) | Yes | T022 | |
| FR-039 (Per-server policy) | Yes | T046 | |
| FR-040 (Kill switch audit) | Yes | T014 | |
| FR-041 (Token usage) | Yes | T013 | |
| FR-042 (Rate card) | Yes | T002, T023 | |
| FR-043 (est_cost_usd) | Yes | T013 | |
| FR-044 (Spend UI) | Yes | T069, T070 | |
| FR-045 (Budget enforce) | Yes | T010 | |
| FR-046 (Incidents API) | Yes | T031 | |
| FR-047 (Incidents page) | Yes | T073 | |
| FR-048 (Soft-delete cron) | Yes | T074 | |
| FR-049 (Recovery endpoint) | Yes | T031 | |
| FR-050 (requireAuth) | Yes | T076 | |
| FR-051 (Audit all mutations) | Yes | T014 | |
| FR-052 (Rate-limit) | Yes | T079 | |
| FR-053 (Feature-flagged) | Yes | T076 | |
| FR-054 (No cascade fail) | Yes | T013 | |
| FR-055 (Mid-stream vis) | Yes | T051, T015 | |

## Constitution Alignment Issues

No `.specify/memory/constitution.md` exists. CLAUDE.md Standing Orders + AGCG used as proxy (consistent with features 010-012).

All Standing Orders verified in plan.md constitution check table: PASS. No violations detected.

## Unmapped Tasks

All tasks map to at least one FR or cross-cutting concern. No orphan tasks.

## Metrics

- Total Requirements: 55 (FR-001 through FR-055)
- Total Tasks: 81
- Coverage % (requirements with ≥1 task): 98.2% (54/55 — FR-009 partial)
- Ambiguity count: 1
- Duplication count: 0
- CRITICAL count: 0
- HIGH count: 0
- MEDIUM count: 3
- LOW count: 2

## VERDICT

```yaml
verdict: PASS
reviewer: analyze
reviewed_at: 2026-05-19T14:30:00Z
commit: ffcd8431f856857d159bf6c19dc87c3c12634f3b
critical_count: 0
high_count: 0
medium_count: 3
low_count: 2
```
