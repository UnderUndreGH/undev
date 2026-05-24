# Feature Specification: VPN/Server Unification

**Feature Branch**: `021-vpn-server-unification`  
**Created**: 2025-05-24  
**Status**: Draft  
**Input**: Collapse two routers + two React Query caches into one unified API. Builds on top of Feature 017 (vpn-tab-deserialize-fix, assumed shipped).

## Context

The current codebase has two separate API routers for servers: `server/routes/servers.ts` (general servers) and `server/routes/servers-vpn.ts` (VPN-flagged servers). On the client side, two independent React Query cache hooks fetch from these separate endpoints (`client/lib/vpn-api.ts` for VPN, separate hooks for general servers). The underlying storage is unified — a single `servers` table with VPN columns added via ALTER TABLE (Feature 016) — but the API and client layers are not.

This duplication causes data drift: a server updated through one path may not reflect in the other cache. Adding a third server type (e.g., k8s, proxmox) would require yet another router + cache pair.

This spec unifies the API surface and client caching into a single pattern with kind-based filtering.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View All Servers in Unified List (Priority: P1)

A user navigates to the Servers page and sees all servers — general, VPN, and any future types — in a single unified list. They can filter by kind using a dropdown or tab.

**Why this priority**: The unified list is the foundation. Without it, every other feature builds on fragmented infrastructure.

**Independent Test**: Create servers of different kinds (general, VPN), navigate to the unified servers page, verify all appear and kind filter works.

**Acceptance Scenarios**:

1. **Given** servers of multiple kinds exist (general, VPN), **When** the user navigates to the Servers page, **Then** all servers appear in a single list with a kind indicator.
2. **Given** the unified server list is displayed, **When** the user selects "VPN" from the kind filter, **Then** only VPN-flagged servers are shown.
3. **Given** the unified server list is displayed, **When** the user selects "All" from the kind filter, **Then** all servers regardless of kind are shown.
4. **Given** a server's kind changes (e.g., VPN is installed on a general server), **When** the user refreshes the server list, **Then** the server appears under the updated kind.

---

### User Story 2 - Add/Edit Server via Unified Form (Priority: P2)

A user adds or edits a server using a single form component that adapts its fields based on the server kind. Adding a general server shows basic fields (name, IP, SSH credentials). Adding a VPN server additionally shows VPN-specific fields.

**Why this priority**: The form is the primary user interaction. Unified form reduces maintenance burden and ensures consistent UX.

**Independent Test**: Open the add-server form, verify it shows appropriate fields for each kind. Edit an existing server, verify kind-specific fields persist.

**Acceptance Scenarios**:

1. **Given** the user opens the "Add Server" form, **When** they select "General" as kind, **Then** basic server fields are shown (name, IP, SSH credentials, tags).
2. **Given** the user opens the "Add Server" form, **When** they select "VPN" as kind, **Then** VPN-specific fields are additionally shown alongside basic fields.
3. **Given** an existing VPN server is being edited, **When** the form loads, **Then** all VPN fields are pre-populated with current values.
4. **Given** the user submits the unified form, **When** the save completes, **Then** the server list reflects the changes without a full page reload.

---

### User Story 3 - VPN Tab Works as Filtered View (Priority: P2)

A user navigating to the VPN tab sees the same unified server list filtered to VPN-kind servers. The behavior is identical to applying the "VPN" filter on the main servers page — same data, same React Query cache, same response format.

**Why this priority**: Parity with existing VPN tab behavior. Must not regress the user experience.

**Independent Test**: Navigate to VPN tab, verify it shows the same data as filtering the main list by "VPN". Navigate to main list, verify VPN servers appear there too.

**Acceptance Scenarios**:

1. **Given** VPN servers exist, **When** the user navigates to the VPN tab, **Then** the same servers appear as when filtering the main list by "VPN".
2. **Given** a new VPN server is added from the main servers page, **When** the user navigates to the VPN tab, **Then** the new server appears without page refresh.
3. **Given** a VPN server's status changes, **When** the user views it from either the VPN tab or the main list, **Then** the status is consistent across both views.

---

### User Story 4 - Extensible for Future Server Types (Priority: P3)

A developer can add a new server type (e.g., k8s, proxmox) by updating a schema enum and adding a conditional form section — without creating new API routes, new React Query hooks, or new cache layers.

**Why this priority**: Architectural extensibility. This is the whole point of unification — preventing N*M sprawl.

**Independent Test**: Add a hypothetical "proxmox" kind to the enum, add a conditional form section, verify it appears in the unified list and kind filter without any new API routes or hooks.

**Acceptance Scenarios**:

1. **Given** the unified system is in place, **When** a developer adds a new kind value to the server kind enum, **Then** the kind filter automatically includes the new option.
2. **Given** a new kind is added, **When** a conditional form section is defined for it, **Then** the add/edit form displays those fields when that kind is selected.
3. **Given** the unified API `GET /api/servers?kind=<new-kind>` is called, **Then** it returns servers of the new kind without any route registration changes.

---

### Edge Cases

- What happens if a server has no kind set (pre-existing data)? — Treat as "general". Migration should set `kind = 'general'` for all existing servers where kind is null.
- What happens during the transition period when both old and new endpoints exist? — Deploy new unified endpoint first, update client to use it, then retire old VPN-specific endpoint. Old endpoint returns a deprecation header during transition.
- What happens if the kind filter receives an invalid value? — Return all servers (ignore invalid filter) or return 400 with clear error message.
- What happens if two caches briefly coexist during migration? — Client hard-cutover: remove old hooks in the same commit that adds new unified hooks. No dual-cache period.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST expose a single unified server list endpoint: `GET /api/servers` with optional `?kind=vpn|general|all` query parameter.
- **FR-002**: System MUST store an explicit `kind` enum column on the `servers` table. Kind synchronization rules: (1) When VPN is installed on a server (vpnStatus transitions from NULL to non-NULL), `kind` MUST auto-update to `vpn`. (2) When VPN is removed from a server (vpnStatus transitions from non-NULL to NULL), `kind` MUST revert to `general`. (3) For future types (k8s, proxmox), the install/remove lifecycle for each type must similarly update `kind`. The `kind` column is the source of truth for server classification; `vpnStatus` is the source of truth for VPN operational state. Both must stay consistent via application-level guards on every write that modifies `vpnStatus` or equivalent type-specific columns.
- **FR-002a (Kind Transition Rules)**: Kind transitions are controlled:
  - `standard → vpn`: Requires initiating VPN install flow (sets `vpnStatus='installing'`, all VPN fields optional but expected to populate during install).
  - `vpn → standard`: Requires explicit user confirmation modal — "This will clear all VPN credentials and config. Continue?" — backend transaction sets `vpnStatus=NULL` and `UPDATE servers SET vpnConfig=NULL, vpnPubkey=NULL, vpnEndpoint=NULL, vpnInstalledAt=NULL WHERE id=?`. NO silent drop — kind change is an explicit destructive action when downgrading.
  - Direct manual kind changes via API/DB are NOT allowed. Kind is always derived from the install/remove lifecycle.
- **FR-003**: System MUST retire the separate `GET /api/servers/vpn` endpoint (merge into unified endpoint).
- **FR-004**: Client MUST use a single React Query cache with filter-aware key: `["servers", { kind }]`.
- **FR-005**: Client MUST retire duplicate React Query hooks from `client/lib/vpn-api.ts` (merge into unified hook).
- **FR-006**: System MUST merge `AddServerForm` and VPN `ServerForm` into one component with conditional fields based on kind.
- **FR-007**: VPN tab MUST function as a filtered view of the unified server list (same data, same cache).
- **FR-008**: System MUST support adding new server types in the future via schema enum update + conditional form section only — no new routes or hooks.
- **FR-009**: All existing server CRUD operations MUST continue to work through the unified API without regression.
- **FR-010**: Migration MUST assign `kind = 'general'` to all existing servers that have no kind set.

### Key Entities

- **Server (extended)**: May gain an explicit `kind` column (enum: general, vpn, k8s, proxmox, etc.) or use computed kind from `vpnStatus`. Decision deferred to planning phase.
- **Unified Server Query**: A single parameterized query supporting kind filter, replacing the two separate query paths.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Exactly one API router handles all server list queries (zero duplicate routes).
- **SC-002**: Exactly one React Query cache key pattern handles all server queries on the client.
- **SC-003**: VPN tab functionality is identical before and after unification (zero regressions).
- **SC-004**: Adding a new server type requires changes to at most 3 files: schema enum, conditional form section, and optionally a migration.
- **SC-005**: No data drift between views — a server updated in one view is immediately reflected in all others.

## Assumptions

- Feature 017 (vpn-tab-deserialize-fix) is already shipped — this spec builds on a working VPN tab.
- The `servers` table already has VPN columns from Feature 016; no additional schema changes are strictly required for this spec (though an explicit `kind` column may be added during planning).
- Retiring `server/routes/servers-vpn.ts` is acceptable — all its functionality will be absorbed into the unified router.
- The client uses React Query; the unified cache pattern is standard React Query best practice with query key parameterization.

## Dependencies

- **Feature 017** (vpn-tab-deserialize-fix): MUST be shipped first. VPN tab must be functional before unification.
