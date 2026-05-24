# Feature Specification: VPN Tab Deserialize Fix

**Feature Branch**: `017-vpn-tab-deserialize-fix`  
**Created**: 2025-05-24  
**Status**: Draft  
**Input**: Fix VPN tab data deserialization — server returns `{ servers: rows }` but client expects array

## Context

The VPN server list endpoint (`GET /api/servers/vpn`) wraps the result set in an object (`{ servers: rows }`), but the client-side VPN API module expects a bare array. This mismatch causes the VPN tab to show no servers even when VPN-flagged servers exist in the database.

**Root cause**: `server/routes/servers-vpn.ts:227` returns `res.json({ servers: rows })` while `client/lib/vpn-api.ts:28` treats the response as an array directly.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View VPN Servers in Dashboard (Priority: P1)

A user who has one or more servers with VPN features enabled navigates to the VPN tab in the dashboard. They expect to see their VPN-flagged servers listed with status, IP, and other metadata.

**Why this priority**: This is the primary user-facing value — without this fix, the VPN tab is completely non-functional.

**Independent Test**: Can be fully tested by creating a server with VPN enabled, navigating to the VPN tab, and verifying the server appears in the list.

**Acceptance Scenarios**:

1. **Given** at least one server with `vpnStatus` set to a non-null value exists in the database, **When** the user navigates to the VPN tab, **Then** the server list displays all VPN-flagged servers with correct metadata.
2. **Given** no VPN-flagged servers exist, **When** the user navigates to the VPN tab, **Then** an empty state is shown (no errors, no spinner).
3. **Given** multiple VPN-flagged servers exist, **When** the VPN tab loads, **Then** all servers appear in the list with accurate status indicators.

---

### Edge Cases

- What happens when the VPN endpoint returns an empty array? — Client should render empty state gracefully.
- What happens if the response shape changes in the future? — Consider whether client should defensively handle both `{ servers: [] }` and `[]` during transition.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The VPN server list endpoint MUST return data in the format the client expects (array).
- **FR-002**: Existing VPN server list functionality (filtering by VPN status) MUST continue to work after the fix.
- **FR-003**: No other endpoints or data shapes MUST be affected by this change.

### Key Entities

- **VPN Server**: A server record with VPN-related fields (`vpnStatus`, `vpnConfig`, etc.) — already exists in the `servers` table.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: VPN tab displays all existing VPN-flagged servers within 2 seconds of navigation.
- **SC-002**: Zero JavaScript console errors when loading the VPN tab.
- **SC-003**: The fix touches exactly one line in one file — no collateral changes.

## Assumptions

- This is a trivial one-line fix: change `res.json({ servers: rows })` to `res.json(rows)` in the VPN server list endpoint.
- No migration or schema changes required.
- Client code (`vpn-api.ts`) is correct in expecting an array — the server is the source of the mismatch.
- **API Design Decision (Array-at-Root vs Envelope)**: We chose array-at-root (vs `{ servers: [] }` envelope) because (a) existing client code already expects array, (b) pagination is not needed at current scale (<1000 servers per user), (c) if pagination needed later, can wrap in envelope as breaking version bump `/api/v2/servers/vpn`.
