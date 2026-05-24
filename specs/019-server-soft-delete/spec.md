# Feature Specification: Server Soft-Delete with Grace Period

**Feature Branch**: `019-server-soft-delete`  
**Created**: 2025-05-24  
**Status**: Draft  
**Input**: Add soft-delete for servers with 30-day grace period, confirmation modal, archived servers view, and cascade finalization

## Context

Server deletion backend exists at `DELETE /api/servers/:id` but lacks UI and audit-entry. Direct CASCADE deletion is dangerous — servers have related records across 6 tables (apps, deploys, backups, certs, health checks, locks). A soft-delete approach with a grace period allows recovery and gives operators time to verify before permanent data loss.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Delete a Server with Confirmation (Priority: P1)

A user who no longer needs a server wants to remove it from the dashboard. They click "Delete Server", see a confirmation modal requiring them to type the server name, confirm, and the server disappears from the main list but remains recoverable for 30 days.

**Why this priority**: Safety-critical operation. Must work correctly before any other deletion features.

**Independent Test**: Create a test server, trigger delete, confirm by typing name, verify server disappears from main list and appears in archived view.

**Acceptance Scenarios**:

1. **Given** a server exists in the dashboard, **When** the user clicks "Delete Server", **Then** a confirmation modal appears requiring the user to type the exact server name.
2. **Given** the confirmation modal is shown, **When** the user types an incorrect server name, **Then** the delete button remains disabled.
3. **Given** the confirmation modal is shown, **When** the user types the correct server name and confirms, **Then** the server disappears from the main server list.
4. **Given** the server was soft-deleted, **When** any user queries the server list, **Then** the deleted server does not appear in the active list.

---

### User Story 2 - Restore an Accidentally Deleted Server (Priority: P2)

A user who accidentally deleted a server (or changed their mind) can restore it within the 30-day grace period from the archived servers panel.

**Why this priority**: Accidental deletion is the primary risk this feature mitigates. Restore must be intuitive and immediate.

**Independent Test**: Delete a server, navigate to archived view, click restore, verify server returns to main list.

**Acceptance Scenarios**:

1. **Given** a server was soft-deleted less than 30 days ago, **When** the user navigates to the archived servers panel, **Then** the server appears with a "Restore" action.
2. **Given** a server in the archived panel, **When** the user clicks "Restore", **Then** the server immediately returns to the active server list with all its data intact.
3. **Given** a server was restored, **When** the user views the server detail, **Then** all related data (apps, deploys, backups) is intact and accessible.

---

### User Story 3 - View Archived Servers (Priority: P2)

A user can access an "Archived Servers" panel showing all soft-deleted servers with their deletion date, remaining days before permanent deletion, and options to restore or view details.

**Why this priority**: Discoverability. Users need to know deleted servers exist and are recoverable.

**Independent Test**: Delete multiple servers, navigate to archived panel, verify all appear with correct metadata.

**Acceptance Scenarios**:

1. **Given** one or more servers have been soft-deleted, **When** the user navigates to the archived servers panel, **Then** all soft-deleted servers are listed with deletion date and days remaining.
2. **Given** no servers have been soft-deleted, **When** the user navigates to the archived servers panel, **Then** an empty state is shown with a helpful message.
3. **Given** a server is approaching its 30-day deadline (e.g., 3 days remaining), **When** viewed in the archived panel, **Then** the remaining time is highlighted as a warning.

---

### User Story 4 - Automatic Permanent Deletion After Grace Period (Priority: P3)

After 30 days, soft-deleted servers are permanently removed via a background process that cascades through all related tables.

**Why this priority**: Data hygiene. Prevents indefinite accumulation of deleted records.

**Independent Test**: Set a server's `deletedAt` to 31 days ago, trigger the finalization process, verify all records are removed.

**Acceptance Scenarios**:

1. **Given** a server has been soft-deleted for more than 30 days, **When** the finalization process runs, **Then** the server and all related records (apps, deploys, backups, certs, health checks, locks) are permanently deleted.
2. **Given** the finalization process runs, **When** a cascade deletion occurs, **Then** an audit entry is created recording the permanent deletion event with timestamp.

---

### User Story 5 - Audit Trail for Deletion Events (Priority: P3)

All delete and restore actions are logged in an audit trail visible to administrators, including who performed the action, when, and on which server.

**Why this priority**: Compliance and accountability. Essential for multi-user environments.

**Independent Test**: Delete a server, check audit log, verify entry exists with correct actor, timestamp, and server identity.

**Acceptance Scenarios**:

1. **Given** a user deletes a server, **When** the deletion completes, **Then** an audit entry is created with: actor, timestamp, server ID, server name, action type ("soft-delete").
2. **Given** a user restores a server, **When** the restore completes, **Then** an audit entry is created with: actor, timestamp, server ID, action type ("restore").
3. **Given** the finalization process permanently deletes a server, **When** the cascade completes, **Then** an audit entry is created with: system actor, timestamp, server ID, action type ("permanent-delete"), related records count.

---

### Edge Cases

- What happens if two users try to delete the same server simultaneously? — First write wins; second user sees "server already deleted" or the server has disappeared.
- What happens if the server is involved in an active deployment when deletion is attempted? — Block deletion and show a warning: "Cannot delete server with active deployments. Stop all deployments first."
- What happens if the finalization cron fails mid-cascade? — Implement transactional cascade; partial deletions roll back; retry on next cron run.
- What happens if a restored server's name conflicts with a new server created after deletion? — Allow duplicate names (name is not unique constraint); or show warning during restore.
- What happens if a user soft-deletes a server and wants to re-add a server with the same IP/name (e.g., after OS reinstall)? — Partial unique indexes (`WHERE deletedAt IS NULL`) allow re-adding the same IP/name. The soft-deleted row coexists with the new active row. This is the intended behavior.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support soft-deletion of servers by setting a deletion timestamp rather than removing the record.
- **FR-002**: System MUST exclude soft-deleted servers from all default server list queries and views.
- **FR-003**: System MUST require the user to type the server name to confirm deletion (prevent accidental clicks).
- **FR-004**: System MUST provide an archived servers panel showing all soft-deleted servers with metadata.
- **FR-005**: System MUST support restoring a soft-deleted server within the grace period.
- **FR-006**: System MUST automatically permanently delete servers after a 30-day grace period.
- **FR-007**: System MUST cascade permanent deletion across all related tables (apps, deploys, backups, certs, health checks, locks).
- **FR-008**: System MUST log all delete and restore events in an audit trail.
- **FR-009**: System MUST block deletion of servers with active deployments.
- **FR-010**: System MUST show the remaining days before permanent deletion in the archived panel.
- **FR-011**: System MUST highlight servers approaching their deletion deadline (within 3 days).
- **FR-012**: Admin finalization endpoint (`POST /api/admin/finalize-deleted`) MUST require admin role authentication. Every invocation MUST create an audit entry recording the admin actor, timestamp, and count of finalized servers.

### Key Entities

- **Server (extended)**: Gains a `deletedAt` timestamp field. When null, server is active; when set, server is soft-deleted and in grace period.
- **Audit Entry**: Records deletion lifecycle events — soft-delete, restore, permanent-delete — with actor, timestamp, server identity, and action type.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Soft-delete completes within 2 seconds from user confirmation.
- **SC-002**: Restore completes within 2 seconds.
- **SC-003**: Finalization cascade handles servers with up to 100 related records without timeout.
- **SC-004**: Zero accidental permanent deletions — all require 30-day wait + explicit confirmation.
- **SC-005**: Audit trail captures 100% of delete and restore events with no data loss.

## Assumptions

- 30-day grace period is a reasonable default. Could be made configurable in the future.
- The 6 related tables (apps, deploys, backups, certs, health, locks) have foreign key relationships that support CASCADE deletion.
- The finalization process runs as a scheduled background job (cron/worker).
- The confirmation modal follows the GitHub-style pattern: type the resource name to confirm destructive action.
