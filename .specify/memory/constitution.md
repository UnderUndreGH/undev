# SpecKit Constitution

This repository uses CLAUDE.md Standing Orders and AGCG coding guardrails as
the binding project constitution for SpecKit gates.

## Principles

### I. Operator safety first

No destructive operation may run without explicit operator consent matching
the risk level. Do not bypass confirmations or safety gates.

### II. Secrets never leak

API keys, passwords, tokens, SSH keys, and other secrets must never be written
to code, commits, logs, audit payloads, or provider-bound context in cleartext.

### III. Reviewable database changes

Database changes are generated as SQL artifacts for review. Do not execute
migrations directly as part of planning, review, or implementation.

### IV. Typed boundaries

External inputs must be validated with typed schemas before use. Avoid `any`,
raw unstructured errors, and unvalidated request-body field access.

### V. Feature flags and rollback posture

Risky features must be dormant by default and isolated from unrelated runtime
paths so failures do not cascade into existing dashboard functionality.

### VI. Independent review gate

Before implementation, SpecKit features require `/speckit.analyze` PASS and at
least two independent reviewer PASS verdicts, or an explicit
`--override-gate <reason>` recorded by the operator.

### VII. Snapshot stages

When snapshot tooling exists, each major SpecKit stage should tag a durable
review point. Missing snapshot tooling must be reported rather than silently
ignored.

## Source of truth

This file summarizes the active constitution for SpecKit automation. Detailed
standing orders and coding guardrails remain in `CLAUDE.md`.
