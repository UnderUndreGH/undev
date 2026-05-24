# SpecKit Review: 019-server-soft-delete

**Reviewer**: antigravity
**Reviewed at**: 2026-05-24T08:16:40Z
**Commit**: HEAD
**Artifacts reviewed**: spec.md, plan.md, tasks.md, data-model.md

## Summary

The soft-delete mechanism is comprehensive and correctly addresses the risks of cascading deletes. However, it overlooks potential database constraint conflicts (like unique IP addresses) that may prevent users from re-adding a rebuilt server during the 30-day grace period.

## Findings

| ID | Severity | Area | Finding | Recommendation |
|---|---|---|---|---|
| F1 | HIGH | Edge case | If the `servers` table has a unique constraint on `ip` or `name`, soft-deleting a server does not free up that value. If a user soft-deletes a server and immediately tries to re-add it (e.g., after OS reinstall), it will fail with a unique constraint violation. | Modify unique constraints to account for `deletedAt` (e.g., unique index on `ip` WHERE `deletedAt IS NULL`), or explicitly note how to handle re-adding the same IP. |
| F2 | HIGH | Logical Consistency | The plan states "All existing queries get `WHERE deletedAt IS NULL` filter". This only covers direct queries. Relational queries (e.g., fetching an App with its Server) might still return soft-deleted servers unless explicitly filtered or using Drizzle's relational queries with `with: { server: ... }` filters. | Ensure Drizzle relational queries and joins are also updated to exclude soft-deleted servers, or decide if related entities should still resolve soft-deleted parents. |
| F3 | MEDIUM | Performance / Schema | The migration creates a partial index `WHERE "deletedAt" IS NOT NULL`. This accelerates the archived view, but does not help the default active list query (`WHERE deletedAt IS NULL`), which is the hottest path. | If the table is very large, consider indexing the active state or relying on other indexes, but note that the partial index only benefits the rare "archived" query. |
| F4 | LOW | Hidden Assumption | The finalization worker (T010) mentions "cascade-delete in transaction". If the DB foreign keys are defined as `ON DELETE CASCADE`, then the finalization worker only needs to delete the server. If they are not, the worker must manually delete related records in correct order. | Explicitly verify/document whether the database schema natively supports `ON DELETE CASCADE` for the 6 related tables. |

## Alternative approaches considered

Instead of a grace period, perform an immediate backup of the server's state (dumping to an S3 bucket or blob storage) before executing a hard delete, allowing restore without keeping ghost rows in the active database tables.

## VERDICT

```yaml
verdict: HIGH
reviewer: antigravity
reviewed_at: 2026-05-24T08:16:40Z
commit: HEAD
critical_count: 0
high_count: 2
medium_count: 1
low_count: 1
```
