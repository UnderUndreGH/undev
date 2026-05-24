# SpecKit Analyze Report: 018-amnezia-install-completion

**Reviewer**: analyze
**Date**: 2026-05-24
**Branch**: specs/017-022
**Artifacts reviewed**: spec.md, plan.md, tasks.md, data-model.md, contracts/vpn-install.md

---

## Detection Passes

### 1. Duplication Detection

Scanned all artifacts for near-duplicate requirements.

- **FR-002 vs FR-007**: FR-002 covers stage-based progress reporting; FR-007 covers `vpnStatus` lifecycle transitions. Complementary (FR-002 = granular stages within FR-007's "installing" state), not duplicates.
- **T007 vs T009 vs T013**: T007 (vpn-config.ts) handles config decryption + format detection. T009 drops server-side QR endpoint. T013 implements client-side QR. No overlap — clean separation after remediation.
- **T015 API methods**: `triggerInstall()`, `getInstallStatus()`, `downloadConfig()` — no stale `getConfigQR()` reference. Clean.

No duplication findings.

### 2. Ambiguity Detection

- **`$GENERATED_CONFIG` / `$GENERATED_WG_CONFIG` in T002**: Shell variables referenced in copy commands but not defined in the script skeleton. The assumption is Amnezia installer outputs to known paths, but the variable assignment is unspecified. LOW — implementation detail resolvable during T002 implementation.
- **"In-memory map for active installs"** (plan.md): Not persisted. If the server restarts mid-install, the install_id mapping is lost. No recovery strategy specified. LOW — acceptable for MVP; install can be re-triggered.

### 3. Underspecification Detection

- **SC-003 (progress updates within 5 seconds)**: No task explicitly verifies or implements this latency requirement. Polling mechanism described but polling interval unspecified. LOW — frontend polling interval is an implementation detail.
- **SC-004 (error message within 10 seconds)**: No task covers this measurable outcome. T019 verifies error handling exists but not the 10-second latency bound. LOW — error propagation is near-instant via the worker event system.
- **Encryption verification**: FR-004 (encrypted at rest) covered by T001 and T007, but no task verifies stored value is actually ciphertext (not plaintext). LOW — assumes correct implementation of AES-256-GCM pattern.

### 4. Constitution Alignment

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Operator safety first | PASS | Install is non-destructive; retry on failure; reinstall confirmation prompt |
| II. Secrets never leak | PASS | VPN config encrypted at rest (AES-256-GCM); decrypted only at delivery time; QR generated client-side |
| III. Reviewable database changes | PASS | Migration .sql in T001 |
| IV. Typed boundaries | PASS | VpnInstallStage enum in data-model.md; Zod validation mentioned in plan.md |
| V. Feature flags and rollback posture | PASS | vpnStatus field exists; failure sets "error" without cascade |
| VI. Independent review gate | DEFERRED | Noted in plan.md |
| VII. Snapshot stages | N/A | No snapshot tooling |

No constitution MUST violations detected.

### 5. Coverage Gaps

**FR-to-Task mapping** (all FRs covered):

| FR | Tasks | Coverage |
|----|-------|----------|
| FR-001 | T002, T004, T005 | OK |
| FR-001b | T004, T005, T006, T006a | OK |
| FR-002 | T004, T006 | OK |
| FR-003 | T002, T004 | OK |
| FR-004 | T001, T007 | OK |
| FR-005 | T008, T012 | OK |
| FR-006 | T003, T009, T013 | OK |
| FR-007 | T004, T005 | OK |
| FR-008 | T005, T019 | OK |
| FR-009 | T010, T020 | OK |

**Orphan tasks** (no direct FR): T011, T014, T015 — integration/glue tasks serving multiple FRs. Acceptable.

**Missing task coverage for Success Criteria**: SC-003 and SC-004 have no verification tasks measuring their specific latency bounds. LOW — functional coverage exists; specific latency bounds are NFR territory.

### 6. Inconsistency Detection

- **API URLs — RESOLVED**: `contracts/vpn-install.md` now defines `POST /api/servers/:id/vpn/install` returning `install_id` (line 20) and `GET /api/servers/:id/vpn/install-status/:install_id` (line 43). These match FR-001b, T005, and T006 exactly. Previous HIGH finding (A01) is FIXED.
- **QR endpoint — RESOLVED**: `contracts/vpn-install.md` no longer contains any QR endpoint. Clean — only has install trigger, install-status poll, and config download. Previous finding (A04) is FIXED.
- **Stage name drift**: FR-002 lists human-facing labels (connecting, installing, configuring, extracting, complete). T002/data-model define machine-parseable tokens (installing_deps, configuring_server, generating_config, extracting_config, done). Mapping is implicit but consistent — FR-002 labels correspond to T002 stages in order. LOW — no functional conflict.
- **T002 lane assignment**: T002 (shell script) grouped under Lane 2 `[FE][SETUP]` alongside T003. T002 should be [BE] or [SETUP]. LOW — does not block implementation.

### 7. Agent Routing Validation

- **Tags**: T001 [DB], T003 [FE][SETUP], T004-T009 [BE], T010-T015 [FE], T016-T020 (verification). T002 has no explicit tag — minor.
- **Dependency graph**: Validated — no circular dependencies, all task IDs exist, no orphans. Fan-in uses `+`, fan-out uses `,`. Mermaid diagram matches text description. Self-validation checklist all checked.
- **Critical path**: T001 → T004 → T005 → T010 → T011 → T016 (6 tasks). Correctly stated.
- **T008→T013 dependency**: Confirmed T008 → T013 exists in dep graph (line 80: `T008 → T012, T013`). Previous graph error (T009→T013) is FIXED.

---

## Findings Summary

| ID | Severity | Category | Summary |
|----|----------|----------|---------|
| A02 | LOW | Inconsistency | Stage name drift: FR-002 uses human labels, T002 uses machine tokens. Implicit mapping, no explicit table. |
| A03 | LOW | Agent Routing | T002 (bash script) in [FE][SETUP] lane. Should be [BE] or untagged setup. |
| A06 | LOW | Underspecification | `$GENERATED_CONFIG` / `$GENERATED_WG_CONFIG` in T002 never defined. |
| A07 | LOW | Underspecification | No task verifies SC-003 (5s progress) or SC-004 (10s error) latency bounds. |

**Counts**: CRITICAL: 0 | HIGH: 0 | MEDIUM: 0 | LOW: 4

---

## Remediation History

| Original ID | Severity | Resolution |
|-------------|----------|------------|
| F1 (antigravity) | HIGH | Async SSH with keep-alive — FR-001b added, plan.md Async Architecture section added, T004/T006a specify keep-alive params and timeout. Verified consistent. |
| F2 (antigravity) | MEDIUM | Client-side QR — FR-006 updated, T003/T009/T013 aligned. Contracts and task descriptions fully updated. |
| F3 (antigravity) | MEDIUM | Deterministic SCP paths — T002 specifies `cp -f` to `/tmp/amnezia-export.vpn` and `/tmp/amnezia-wg.conf`. Verified consistent. |
| F4 (antigravity) | LOW | Stage marker format — T002 specifies `[STAGE: <stage_name>]` with regex and valid stage list. Verified consistent. |
| A01 (analyze v1) | HIGH | API URL mismatch — contracts/vpn-install.md now matches spec/tasks: POST returns `install_id`, status endpoint is `GET /api/servers/:id/vpn/install-status/:install_id`. FIXED. |
| A04 (analyze v1) | MEDIUM | Contracts QR endpoint — removed. contracts/vpn-install.md no longer has any QR endpoint. FIXED. |
| A05 (analyze v1) | LOW | T007 QR reference + T015 `getConfigQR()` — T007 now says "config decryption helper, format detection"; T015 now lists `triggerInstall()`, `getInstallStatus()`, `downloadConfig()`. FIXED. |

---

## VERDICT

```yaml
verdict: PASS
reviewer: analyze
reviewed_at: "2026-05-24T15:00:00Z"
commit: 7324438
critical_count: 0
high_count: 0
medium_count: 0
low_count: 4
notes: >
  All previous HIGH and MEDIUM findings resolved. Spec is internally consistent.
  Four LOW findings remain (stage name drift, lane assignment, undefined shell
  variables, unmeasured latency SCs) — none blocking. Ready for implementation.
```
