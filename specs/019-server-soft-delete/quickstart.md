# Quickstart: Server Soft-Delete

**Date**: 2025-05-24
**Spec**: 019-server-soft-delete

## Testing the Flow

### 1. Soft-Delete a Server

1. Navigate to Servers page
2. Click the delete action on any server
3. Confirmation modal appears — type the server name exactly
4. Confirm button enables — click it
5. Server disappears from main list

### 2. View Archived Servers

1. Navigate to the "Archived Servers" panel (accessible from sidebar or servers page)
2. See all soft-deleted servers with deletion date and remaining days
3. Servers approaching deadline (≤3 days) are highlighted

### 3. Restore a Server

1. From the Archived Servers panel, click "Restore" on any server
2. Server immediately reappears in the main server list
3. All related data (apps, deploys, backups) is intact

### 4. Test Finalization (Development)

1. Manually set a server's `deletedAt` to 31+ days ago:
   ```sql
   UPDATE servers SET "deletedAt" = NOW() - INTERVAL '31 days' WHERE id = <test-id>;
   ```
2. Trigger finalization endpoint: `POST /api/admin/finalize-deleted`
3. Verify server and all related records are permanently deleted
4. Check audit log for permanent-delete entry

## Edge Case Testing

- Try deleting with wrong name → button stays disabled
- Try deleting server with active deployments → error message
- Try restoring from main list (not archived) → not found
- Two users delete same server → first wins, second sees "already deleted"
