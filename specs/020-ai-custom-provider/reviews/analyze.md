# SpecKit Analyze Report: 020-ai-custom-provider

**Reviewer**: analyze
**Date**: 2026-05-24
**Branch**: 020-ai-custom-provider
**Artifacts reviewed**: spec.md, plan.md, tasks.md

---

## Detection Passes

### 1. Duplication Detection

No significant duplication. spec §Assumptions and plan §Research Decisions overlap on `@ai-sdk/openai` baseURL support, but plan adds actionable detail (which SDK method, which constructor option).

### 2. Ambiguity Detection

**Finding A001** [MEDIUM]: spec FR-002 says "allow empty/optional API keys for OpenAI-Compatible providers" but plan and tasks don't specify how this interacts with existing encryption. If API key is empty, does the `api_key_encrypted` field stay null? Is the encryption code path skipped? T002 mentions Zod validation but doesn't specify optional API key handling.

**Finding A002** [LOW]: spec mentions "Ollama" as existing provider but doesn't mention whether Ollama should also support custom baseURL. Edge case notes say "hidden for Ollama" in T007, which implies Ollama is excluded. This is reasonable (Ollama has its own local discovery) but not explicitly stated in spec FR.

### 3. Underspecification Detection

**Finding U001** [MEDIUM]: Azure OpenAI has a distinctly different URL pattern (`/openai/deployments/{deployment}/`) compared to standard OpenAI (`/v1/`). spec §Assumptions acknowledges this but defers to SDK handling. plan notes "may need special handling in the factory (document for user)" but no task implements or documents this. If users try Azure OpenAI and it doesn't work out of the box, this will be a support burden.

**Finding U002** [LOW]: Test connectivity (T006) sends "minimal chat completion request" — but what model name is used? Custom providers may not support all models. Should the test use the model configured in the provider record? This is implied but not explicit.

**Finding U003** [LOW]: Missing optional docs (research.md, data-model.md, contracts/) — same pattern as 018/019.

### 4. Constitution Alignment

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Operator safety first | PASS | Test connectivity before save; no destructive ops |
| II. Secrets never leak | PASS | API keys encrypted at rest via existing pattern |
| III. Reviewable database changes | PASS | T001 generates .sql migration |
| IV. Typed boundaries | PASS | Zod validation; provider type enum |
| V. Feature flags and rollback posture | PASS | Additive feature; existing providers unaffected |
| VI. Independent review gate | DEFERRED | This analyze report |
| VII. Snapshot stages | N/A | No snapshot tooling |

### 5. Coverage Gaps

- FR-001 (openai-compatible type) → T002 + T004 + T008 ✓
- FR-002 (optional API key) → T002 (partial — validation) ⚠ (see A001)
- FR-003 (URL validation) → T005 ✓
- FR-004 (Anthropic custom URL) → T004 ✓
- FR-005 (test connectivity) → T006 + T009 ✓
- FR-006 (encryption) → existing pattern ✓
- FR-007 (endpoint URL UI field) → T007 ✓
- FR-008 (pass URL at invocation) → T004 ✓
- SC-001 through SC-004 → T011-T014 ✓

### 6. Inconsistency Detection

**Finding I001** [LOW]: spec says 3 user stories but plan §Scale/Scope says "2 user stories". Spec has US1 (local LLM), US2 (cloud proxy), US3 (Anthropic custom URL). Plan counts US1+US2 as combined and US3 as extension, which explains the count. Minor but inconsistent.

**Finding I002** [LOW]: T007 description says "shown when type is `openai-compatible` (required) or `openai`/`anthropic` (optional); hidden for `ollama`" — but spec FR-007 says "custom Endpoint URL field when OpenAI-Compatible or custom-base-URL Anthropic is selected". Spec doesn't mention showing the field for built-in `openai` type. T007 extends beyond spec scope (showing URL field for built-in OpenAI is not requested).

### 7. Agent Routing Validation

All tags correct:
- T001, T003 [DB] ✓
- T002, T004-T006 [BE] ✓
- T007-T010 [FE] ✓
- T011-T014 verification split [BE]/[FE] appropriately ✓

---

## Findings Summary

| ID | Severity | Category | Summary |
|----|----------|----------|---------|
| A001 | MEDIUM | Ambiguity | Empty API key handling for local endpoints — encryption code path unclear |
| A002 | LOW | Ambiguity | Ollama custom URL exclusion not in spec FR |
| U001 | MEDIUM | Underspecification | Azure OpenAI URL pattern may need special handling — deferred to "document for user" |
| U002 | LOW | Underspecification | Test connectivity model selection implicit |
| U003 | LOW | Underspecification | Optional docs not created |
| I001 | LOW | Inconsistency | Spec says 3 user stories, plan says 2 |
| I002 | LOW | Inconsistency | T007 extends URL field to built-in OpenAI — beyond spec scope |

**Counts**: CRITICAL: 0 | HIGH: 0 | MEDIUM: 2 | LOW: 5

---

## Cross-Artifact Consistency

- spec → plan: Well aligned. Minor count discrepancy (I001).
- plan → tasks: Aligned.
- spec → tasks: Aligned with T007 extending beyond spec (I002).
- Dependency graph: Valid. No cycles, no orphans.

---

## VERDICT

```yaml
verdict: PASS
reviewer: analyze
reviewed_at: "2026-05-24T00:00:00Z"
commit: HEAD
```

**Rationale**: No CRITICAL or HIGH findings. Two MEDIUM findings are addressable during implementation: (1) empty API key encryption path — document the skip logic clearly, (2) Azure OpenAI URL handling — at minimum add a note in the UI about Azure URL format. The feature is well-scoped, extends existing patterns, and has clear rollback posture.
