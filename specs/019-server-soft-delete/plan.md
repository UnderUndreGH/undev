# Implementation Plan: Server Soft-Delete with Grace Period

**Branch**: `019-server-soft-delete` | **Date**: 2025-05-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/019-server-soft-delete/spec.md`

## Summary

Add soft-delete for servers with a 30-day grace period. Replace the current hard-delete `DELETE /api/servers/:id` with a soft-delete that sets a `deletedAt` timestamp, excludes soft-deleted servers from default queries, provides an archived servers view with restore capability, and implements a background finalization process for permanent deletion after the grace period. Includes a GitHub-style confirmation modal requiring the user to type the server name.

## Technical Context

**Language/Version**: TypeScript (Node.js)
**Primary Dependencies**: Express (server), React Query (client), Drizzle ORM (DB), Zod (validation)
**Storage**: PostgreSQL — `servers` table gains `deletedAt` column; new `audit_entries` table
**Testing**: Integration tests for soft-delete/restore; finalization tested via time-travel
**Target Platform**: Web dashboard
**Project Type**: Web application (monorepo: `server/`, `client/`)
**Performance Goals**: Soft-delete <2s; restore <2s; finalization handles 100+ related records without timeout
**Constraints**: Must not break existing server list, detail, or CRUD operations
**Scale/Scope**: 5 user stories, ~15-20 files touched, new migration + audit system

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Operator safety first | PASS | Confirmation modal requires typing server name; 30-day grace period |
| II. Secrets never leak | PASS | Audit entries contain server metadata, not credentials |
| III. Reviewable database changes | PASS | Migration generated as .sql file |
| IV. Typed boundaries | PASS | Zod schema for delete/restore requests; audit entry typed |
| V. Feature flags and rollback posture | PASS | Soft-delete is additive; existing hard-delete path can be restored |
| VI. Independent review gate | DEFERRED | Required before implement |
| VII. Snapshot stages | N/A | No snapshot tooling |

## Project Structure

### Documentation (this feature)

```text
specs/019-server-soft-delete/
├── plan.md              # This file
├── research.md          # Soft-delete patterns, cascade analysis
├── data-model.md        # Schema changes + audit entity
├── quickstart.md        # How to test delete/restore/finalize
├── contracts/           # API specs
│   ├── server-delete.md
│   └── server-archive.md
└── tasks.md             # Task breakdown
```

### Source Code (repository root)

```text
server/
├── db/
│   └── migrations/
│       ├── 019-add-deleted-at.sql          # deletedAt column
│       └── 019-create-audit-entries.sql    # audit_entries table
├── routes/
│   └── servers.ts                          # Soft-delete + restore endpoints
├── services/
│   └── server-deletion.ts                  # Soft-delete logic, finalization, cascade
├── workers/
│   └── server-finalizer.ts                 # Background job for grace-period expiry
├── middleware/
│   └── audit-logger.ts                     # Audit trail middleware
└── lib/
    └── audit.ts                            # Audit entry creation utility

client/
├── lib/
│   └── servers-api.ts                      # Delete, restore, archived list hooks
└── components/
    └── servers/
        ├── DeleteConfirmModal.tsx           # Name-typing confirmation modal
        ├── ArchivedServersList.tsx          # Archived servers panel
        └── RestoreButton.tsx               # Restore action
```

**Structure Decision**: Existing web app monorepo. New service layer for deletion logic. New audit infrastructure.

## Research Decisions

### Soft-Delete Strategy
- Add `deletedAt TIMESTAMPTZ NULL` to `servers` table
- All existing queries get `WHERE deletedAt IS NULL` filter (via Drizzle query modifier)
- Archived queries use `WHERE deletedAt IS NOT NULL`

### Query Layer — Relational and Join Audit
All Drizzle relational queries (`db.query.<entity>.findMany({ with: { server: ... } })`) and explicit joins (`.innerJoin/leftJoin(servers, ...)`) MUST be audited for soft-delete awareness.

**Policy**: Related entities (e.g., App, Deploy, Backup) whose parent server is soft-deleted SHOULD be hidden from non-admin queries. For each relation:
- If the relation includes `with: { server: ... }`, add `where: isNull(servers.deletedAt)` to the nested `with:` clause
- If the relation uses `.innerJoin(servers, ...)`, add `andWhere(isNull(servers.deletedAt))` to the join condition
- Admin endpoints and audit queries are exempt from this filter

This ensures soft-deleted servers don't leak through relational queries.

### Cascade Analysis (6 related tables)
1. `apps` — CASCADE on server delete
2. `deploys` — CASCADE on app delete (transitive)
3. `backups` — CASCADE on server delete
4. `certs` — CASCADE on server delete
5. `health_checks` — CASCADE on server delete
6. `locks` — CASCADE on server delete

All have FK relationships. Finalization will use a transactional cascade.

### Finalization Process
- Background job runs daily (cron/worker)
- Selects servers where `deletedAt < NOW() - INTERVAL '30 days'`
- Runs cascade in a transaction
- Creates audit entry for permanent deletion
- If transaction fails, rollback + retry next run

### Confirmation Modal Pattern
- GitHub-style: user must type exact server name
- Client-side validation enables/disables confirm button
- Server-side also validates name match (belt and suspenders)

## Rollback Strategy

Soft-delete is an additive feature, but T006 modifies ALL existing server queries. Rollback posture:

1. **Separate commits required**: Migration commits (T001-T003) and query-modification commits (T006a-T006i) MUST be in separate commits, NOT squashed together. This enables independent revert.
2. **Query rollback**: If query filters cause issues, revert the T006 commit en bloc. This restores original query behavior (soft-deleted servers visible — acceptable degradation vs broken functionality).
3. **Migration rollback**: Run `019-add-deleted-at.sql` DOWN migration to drop `deletedAt` column. This is safe because the column is nullable and only contains data for soft-deleted servers.
4. **Data safety**: Soft-deleted server data is preserved in the database even after rollback — no data loss from reverting the query filter.
5. **Feature flag consideration**: If risk tolerance is low, wrap the `deletedAt IS NULL` filter behind a config flag `SOFT_DELETE_ENABLED` (default: true). When false, queries return all servers including soft-deleted ones, allowing instant rollback without code deployment.

## Complexity Tracking

No constitution violations. Medium-large feature (~300-400 LOC). New audit system is the main addition.
